import { randomUUID } from 'node:crypto';
import { readCodexContextUsed } from './codex-context-usage.js';
import { getCodexConnection } from './codex-rpc.js';
import { appendFilesInputTag, buildCodexInputItems, normalizeImageDescriptors,
  createCompleteMessage, createNormalizedMessage } from '../../../../shared/index.js';
import { notifyRunFailed, notifyRunStopped } from '../../../notifications/index.js';

const runs = new Map();
const pending = new Map();

/** App Server item -> existing transcript normalization contract. */
export function transformAppServerItem(item) {
  const base = { type: 'item', itemId: item.id };
  switch (item.type) {
    case 'agentMessage': return {...base, itemType: 'agent_message',
      message: {role: 'assistant', content: item.text}, questions: item.questions, delivery: item.delivery};
    case 'reasoning': return {...base, itemType: 'reasoning', message: {role: 'assistant',
      content: [...(item.summary || []), ...(item.content || [])].join('\n'), isReasoning: true}, isReasoning: true};
    case 'commandExecution': return {...base, itemType: 'command_execution', command: item.command,
      output: item.aggregatedOutput, exitCode: item.exitCode,
      status: item.status === 'inProgress' ? 'in_progress' : item.status};
    case 'fileChange': return {...base, itemType: 'file_change', changes: (item.changes || []).map(change => ({
      path: change.path, kind: typeof change.kind === 'string' ? change.kind : change.kind?.type,
    })), status: item.status};
    case 'mcpToolCall': return {...base, itemType: 'mcp_tool_call', server: item.server, tool: item.tool,
      arguments: item.arguments, result: item.result, error: item.error,
      status: item.status === 'inProgress' ? 'in_progress' : item.status};
    case 'webSearch': return {...base, itemType: 'web_search', query: item.query};
    case 'plan': return {...base, itemType: 'agent_message', message: {role: 'assistant', content: `<proposed_plan>\n${item.text}\n</proposed_plan>`}};
    default: return {...base, itemType: item.type, item};
  }
}

function permissionOptions(mode) {
  // Always set the reviewer when selecting a mode: resumed threads retain it.
  if (mode === 'bypassPermissions') return {sandbox: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user'};
  return {sandbox: 'workspace-write', approvalPolicy: mode === 'acceptEdits' ? 'never' : 'on-request',
    approvalsReviewer: mode === 'approveForMe' ? 'auto_review' : 'user'};
}

function settlePermission(entry, decision) {
  if (!pending.has(entry.requestId)) return;
  let result;
  if (entry.method === 'item/tool/requestUserInput') {
    const supplied = decision.updatedInput?.answers || {};
    result = {answers: Object.fromEntries((entry.params.questions || []).map(question => {
      const value = supplied[question.id] ?? supplied[question.question];
      return [question.id, {answers: Array.isArray(value) ? value : typeof value === 'string' ? [value] : []}];
    }))};
  } else if (entry.method === 'item/permissions/requestApproval') {
    result = {permissions: decision.allow ? entry.params.permissions : {}, scope: 'turn'};
  } else result = {decision: decision.allow ? 'accept' : 'decline'};
  entry.rpc.send({jsonrpc: '2.0', id: entry.rpcId, result});
  pending.delete(entry.requestId);
  entry.send({kind: 'permission_resolved', requestId: entry.requestId});
}

async function run(command, options = {}, writer, context, connect = getCodexConnection) {
  let threadId = context.resolveProviderSessionId(options.sessionId);
  let rpc, runState, onMessage, onClosed;
  const send = fields => {
    const value = fields.id && fields.provider ? fields : createNormalizedMessage({
      ...fields, sessionId: threadId || options.sessionId || '', provider: 'codex',
    });
    try { writer.send(writer.isWebSocketWriter ? value : JSON.stringify(value)); }
    catch (error) { console.warn('[Codex] Unable to forward event:', error.message); }
  };
  try {
    rpc = await connect();
    const catalog = await context.getProviderModels();
    // A long-lived daemon may have an older startup default than the CLI's
    // current catalog. New browser threads must use the model the UI shows.
    const model = await context.resolveResumeModel(options.sessionId, options.model)
      || (!threadId ? catalog.DEFAULT : undefined);
    const cwd = options.cwd || options.projectPath || process.cwd();
    const threadResult = threadId
      ? await rpc.call('thread/resume', {threadId, excludeTurns: true,
        ...(options.permissionMode ? permissionOptions(options.permissionMode) : {})})
      : await rpc.call('thread/start', {cwd, model, ...permissionOptions(options.permissionMode), experimentalRawEvents: true});
    const isNew = !threadId;
    threadId = threadResult.thread.id;
    if (isNew) {
      writer.setSessionId?.(threadId);
      send({kind: 'session_created', newSessionId: threadId});
    }
    const key = options.sessionId || threadId;
    runState = {rpc, threadId, turnId: null, aborted: false, key};
    runs.set(key, runState);
    const earlyCompletions = [];
    const earlyItems = [];
    const firstSeen = new Map();
    let parentUserMessageId;
    let originalUserSeen = false;
    const emitItem = (item, turnId, streaming = false) => {
      if (!firstSeen.has(item.id)) firstSeen.set(item.id, new Date().toISOString());
      const raw = {...transformAppServerItem(item), timestamp: firstSeen.get(item.id)};
      for (const normalized of context.normalizeMessage(raw, threadId)) send({...normalized,
        turnId: turnId || runState.turnId, parentUserMessageId, isStreaming: streaming});
    };
    const liveItems = new Map();
    let errorSurfaced = false;
    let resolveDone, rejectDone;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    done.catch(() => {}); // A disconnect can arrive while turn/start is awaiting its acknowledgement.
    // Attach before turn/start: the first items can arrive before its RPC ack.
    onClosed = error => rejectDone(error);
    onMessage = message => {
      const p = message.params;
      if (p?.threadId !== threadId) return;
      // A delayed question reply may start a different turn on this same thread.
      // It must never update the writer/completion belonging to this run.
      const eventTurnId = p.turnId || p.turn?.id;
      if (eventTurnId && runState.turnId && eventTurnId !== runState.turnId) return;
      if (p.turnId && !runState.turnId && message.id == null) { earlyItems.push(message); return; }
      if (message.id != null) {
        if (message.method === 'currentTime/read') {
          rpc.send({jsonrpc: '2.0', id: message.id, result: {currentTimeAt: Math.floor(Date.now() / 1000)}}); return;
        }
        const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
          'item/permissions/requestApproval', 'item/tool/requestUserInput'];
        if (!supported.includes(message.method)) {
          rpc.send({jsonrpc: '2.0', id: message.id, error: {code: -32601, message: `Unsupported CloudCLI request: ${message.method}`}}); return;
        }
        const requestId = `codex-${randomUUID()}`;
        const isQuestion = message.method === 'item/tool/requestUserInput';
        const input = isQuestion ? {questions: p.questions.map(q => ({...q, header: q.header || 'Codex', multiSelect: false}))}
          : {command: p.command, cwd: p.cwd, reason: p.reason, ...p};
        const toolName = isQuestion ? 'AskUserQuestion' : message.method.includes('fileChange') ? 'Edit' : message.method.includes('permissions') ? 'CodexPermissions' : 'Bash';
        const entry = {requestId, rpcId: message.id, rpc, method: message.method, params: p,
          sessionId: key, input, toolName, send};
        pending.set(requestId, entry);
        send({kind: 'permission_request', requestId, toolName, input});
        return;
      }
      if (message.method === 'item/started' || message.method === 'item/completed') {
        const item = p.item;
        if (!item) return;
        if (item.type === 'userMessage') {
          if (message.method !== 'item/completed') return;
          const clientMessageId = item.clientId || item.client_id || (!originalUserSeen ? options.clientMessageId : undefined);
          originalUserSeen = true;
          parentUserMessageId = item.id;
          const text = (item.content || []).map(part => part.text || '').join('\n');
          for (const normalized of context.normalizeMessage({type: 'user', itemId: item.id,
            codexTurnId: p.turnId || runState.turnId, turnId: p.turnId || runState.turnId,
            clientMessageId, message: {role: 'user', content: text}, images: options.images}, threadId)) send(normalized);
          return;
        }
        liveItems.set(item.id, item);
        if (message.method === 'item/started' && !['commandExecution', 'mcpToolCall'].includes(item.type)) return;
        emitItem(item, p.turnId);
        return;
      }
      if (message.method === 'item/agentMessage/delta') {
        const item = liveItems.get(p.itemId) || {id: p.itemId, type: 'agentMessage', text: ''};
        item.text = (item.text || '') + (p.delta || '');
        liveItems.set(item.id, item);
        emitItem(item, p.turnId, true);
        return;
      }
      if (message.method === 'item/commandExecution/outputDelta') {
        const item = liveItems.get(p.itemId);
        if (item) {
          item.aggregatedOutput = (item.aggregatedOutput || '') + p.delta;
          emitItem(item, p.turnId);
        }
      }
      if (message.method === 'turn/plan/updated') {
        for (const normalized of context.normalizeMessage({type: 'item', itemType: 'todo_list', itemId: `plan-${p.turnId}`,
          items: (p.plan || []).map(task => ({text: task.step, completed: task.status === 'completed'}))}, threadId)) send(normalized);
      }
      if (message.method === 'thread/tokenUsage/updated') {
        const usage = p.tokenUsage;
        send({kind: 'status', text: 'token_budget', tokenBudget: {used: usage.total.totalTokens,
          total: usage.modelContextWindow || 200000, contextUsed: readCodexContextUsed(usage.last), inputTokens: usage.total.inputTokens, outputTokens: usage.total.outputTokens}});
      }
      if (message.method === 'error' && !p.willRetry) {
        errorSurfaced = true; send({kind: 'error', id: `codex-turn:${p.turnId || runState.turnId}:error`,
          turnId: p.turnId || runState.turnId, content: p.error?.message || 'Codex error'});
      }
      if (message.method === 'serverRequest/resolved') {
        for (const [id, entry] of pending) if (entry.rpcId === p.requestId) {
          pending.delete(id); send({kind: 'permission_resolved', requestId: id});
        }
      }
      if (message.method === 'turn/completed') {
        if (!runState.turnId) earlyCompletions.push(p.turn);
        else if (p.turn.id === runState.turnId) resolveDone(p.turn);
      }
    };
    rpc.on('message', onMessage);
    rpc.on('closed', onClosed);
    let text = appendFilesInputTag(command, options.files);
    const images = normalizeImageDescriptors(options.images);
    if (!text.trim() && images.length) text = 'Please analyze the attached image(s).';
    const input = buildCodexInputItems(text, images, cwd).map(item => item.type === 'local_image' ? {...item, type: 'localImage'} : item);
    // Pin the turn's reviewer too, including when another client resumed it.
    const turnPermissions = options.permissionMode ? permissionOptions(options.permissionMode) : null;
    const turnParams = {threadId, input, ...(model ? {model} : {}),
      ...(turnPermissions ? {approvalPolicy: turnPermissions.approvalPolicy, approvalsReviewer: turnPermissions.approvalsReviewer} : {}),
      ...(typeof options.clientMessageId === 'string' ? {clientUserMessageId: options.clientMessageId} : {})};
    if (options.effort && options.effort !== 'default') {
      if (catalog.OPTIONS.find(option => option.value === model)?.effort?.values?.some(value => value.value === options.effort)) turnParams.effort = options.effort;
    }
    let turn;
    try { turn = await rpc.call('turn/start', turnParams); }
    catch (error) { resolveDone(null); throw error; }
    runState.turnId = turn.turn.id;
    for (const message of earlyItems) onMessage(message);
    const earlyCompletion = earlyCompletions.find(completed => completed.id === runState.turnId);
    if (earlyCompletion) resolveDone(earlyCompletion);
    if (runState.aborted) await rpc.call('turn/interrupt', {threadId, turnId: runState.turnId});
    const completed = await done;
    if (runState.aborted) send({kind: 'task_notification', id: `codex-turn:${runState.turnId}:interrupted`,
      turnId: runState.turnId, summary: 'Turn interrupted', status: 'info'});
    if (!runState.aborted) {
      const failure = completed?.error || (completed?.status === 'failed' ? {message: 'Codex turn failed'} : null);
      if (failure && !errorSurfaced) send({kind: 'error', id: `codex-turn:${runState.turnId}:error`,
        turnId: runState.turnId, content: failure.message});
      const interrupted = completed?.status === 'interrupted';
      if (interrupted) send({kind: 'task_notification', id: `codex-turn:${runState.turnId}:interrupted`,
        turnId: runState.turnId, summary: 'Turn interrupted', status: 'info'});
      send(createCompleteMessage({provider: 'codex', sessionId: threadId, actualSessionId: threadId, exitCode: failure ? 1 : 0, aborted: interrupted}));
      const notice = {userId: writer.userId || null, provider: 'codex', sessionId: options.sessionId || threadId, sessionName: options.sessionSummary};
      if (failure) notifyRunFailed({...notice, error: failure});
      else notifyRunStopped({...notice, stopReason: 'completed'});
    }
  } catch (error) {
    if (!runState?.aborted) {
      send({kind: 'error', content: error.message});
      send(createCompleteMessage({provider: 'codex', sessionId: threadId || options.sessionId, exitCode: 1}));
    }
  } finally {
    if (onMessage) rpc.off('message', onMessage);
    if (onClosed) rpc.off('closed', onClosed);
    if (runState && runs.get(runState.key) === runState) runs.delete(runState.key);
    for (const [id, entry] of pending) if (entry.params.threadId === threadId) {
      pending.delete(id); send({kind: 'permission_cancelled', requestId: id, reason: 'turn_ended'});
    }
  }
}

export function createCodexInteractiveRuntime(connect = getCodexConnection) { return {
  run: (command, options, writer, context) => run(command, options, writer, context, connect),
  async abort(sessionId) {
    const state = runs.get(sessionId);
    if (!state) return false;
    state.aborted = true;
    if (state.turnId) await state.rpc.call('turn/interrupt', {threadId: state.threadId, turnId: state.turnId});
    return true;
  },
  permissions: {
    resolve(requestId, decision) { const entry = pending.get(requestId); if (entry) settlePermission(entry, decision); },
    listPending(sessionId) { return [...pending.values()].filter(p => p.sessionId === sessionId).map(p => ({
      requestId: p.requestId, toolName: p.toolName, input: p.input,
    })); },
  },
}; }
export const codexInteractiveRuntime = createCodexInteractiveRuntime();

import { createHash } from 'node:crypto';
import { sessionsDb } from '../../../modules/database/index.js';
import { chatRunRegistry } from '../../../modules/websocket/index.js';
import { createNormalizedMessage } from '../../../shared/index.js';

import { CodexRpc } from '../list/codex/codex-rpc.js';























const methods = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval', 'item/tool/requestUserInput', 'execCommandApproval', 'applyPatchApproval']);

/** Consumed by the chat gateway to observe terminal-owned approvals and return
 * explicit browser decisions. Subscribing never starts a turn, changes policy,
 * starts a daemon, or sends an approval. The native daemon keeps the writer.
 */
export function createCodexApprovalService({
  createRpc = () => new CodexRpc(), getSession = id => sessionsDb.getSessionById(id),
  isLocallyOwned = (id, turnId) => {
    const run = chatRunRegistry.getRun(id);
    // Async replies can start another turn on the same thread. Suppress only
    // requests belonging to the local writer's turn, not the entire session.
    return Boolean(run?.status === 'running' && (!turnId || run.events.some(event => (event             ).turnId === turnId)));
  },
}               = {}) {
  const watches = new Map                      ();
  const publish = (watch              , fields                                                                                                                                        ) => {
    const event = JSON.stringify(createNormalizedMessage({provider: 'codex', sessionId: watch.sessionId, ...fields}));
    for (const connection of watch.connections) {
      if (connection.readyState !== 1) continue;
      try { connection.send(event); } catch { /* Socket cleanup follows its close event. */ }
    }
  };
  const retract = (watch              , entry                 , kind                                                 = 'permission_resolved') => {
    watch.requests.delete(entry.requestId);
    publish(watch, {kind, requestId: entry.requestId});
  };
  const cancelAll = (watch              ) => {
    for (const entry of [...watch.requests.values()]) retract(watch, entry, 'permission_cancelled');
  };
  const isCurrent = (watch              , rpc             ) => watches.get(watch.sessionId) === watch && watch.rpc === rpc;
  const handleMessage = (watch              , rpc             , message               ) => {
    if (!isCurrent(watch, rpc)) return;
    const p = message.params || {};
    if ((p.threadId || p.conversationId) !== watch.threadId) return;
    if (message.method === 'serverRequest/resolved') {
      for (const entry of [...watch.requests.values()]) {
        if (entry.rpcId === p.requestId) retract(watch, entry);
      }
      return;
    }
    if (message.method === 'turn/completed') {
      const turnId = p.turn?.id || p.turnId;
      for (const entry of [...watch.requests.values()]) {
        if (turnId && entry.params.turnId === turnId) retract(watch, entry, 'permission_cancelled');
      }
      return;
    }
    // The normal runtime already owns and forwards requests for browser runs.
    // A passive observer must not answer other server requests (time, tools, etc.).
    if (message.id == null || !methods.has(message.method) || isLocallyOwned(watch.sessionId, p.turnId)) return;
    const requestId = 'codex-external-' + createHash('sha256')
      .update(JSON.stringify([watch.threadId, message.id])).digest('hex').slice(0, 32);
    if (watch.requests.has(requestId)) return;
    const isQuestion = message.method === 'item/tool/requestUserInput';
    const entry                  = {requestId, rpcId: message.id, method: message.method, params: p,
      toolName: isQuestion ? 'AskUserQuestion' : /fileChange|applyPatch/.test(message.method) ? 'Edit'
        : /permissions/.test(message.method) ? 'CodexPermissions' : 'Bash',
      input: isQuestion ? {questions: (p.questions || []).map((q           ) => ({...q, header: q.header || 'Codex', multiSelect: false}))}
        : {...p, command: p.command, cwd: p.cwd, reason: p.reason}, submitting: false};
    watch.requests.set(requestId, entry);
    publish(watch, {kind: 'permission_request', requestId, toolName: entry.toolName, input: entry.input});
  };
  const scheduleRetry = (watch              ) => {
    if (watch.retry || watches.get(watch.sessionId) !== watch || !watch.connections.size) return;
    watch.retry = setTimeout(() => { watch.retry = null; void connect(watch); }, 5000);
    watch.retry.unref?.();
  };
  const connect = async (watch              )                => {
    if (watch.ready) return watch.ready;
    if (watch.rpc || !watch.connections.size) return;
    const rpc = createRpc();
    watch.rpc = rpc;
    rpc.on('message', message => handleMessage(watch, rpc, message));
    rpc.on('closed', () => {
      if (!isCurrent(watch, rpc)) return;
      watch.rpc = null;
      cancelAll(watch);
      scheduleRetry(watch);
    });
    watch.ready = (async () => {
      try {
        await rpc.initialize();
        if (!isCurrent(watch, rpc)) return;
        // Resume with NO overrides merely attaches this observer and replays
        // outstanding callbacks; it does not start a new exec writer.
        await rpc.call('thread/resume', {threadId: watch.threadId, excludeTurns: true}, 5000);
      } catch (error) {
        if (isCurrent(watch, rpc)) {
          watch.rpc = null;
          cancelAll(watch);
          rpc.close();
          scheduleRetry(watch);
          console.warn('[Codex approvals] Unable to attach observer:', error instanceof Error ? error.message : String(error));
        }
      }
    })();
    try { await watch.ready; } finally { watch.ready = null; }
  };
  return {
    async watchSession(sessionId        , connection                          )                {
      const session = getSession(sessionId);
      if (session?.provider !== 'codex' || !session.provider_session_id || connection.readyState !== 1) return;
      let watch = watches.get(sessionId);
      if (watch && watch.threadId !== session.provider_session_id) {
        watches.delete(sessionId); cancelAll(watch); watch.rpc?.close();
        if (watch.retry) clearTimeout(watch.retry);
        watch = undefined;
      }
      if (!watch) {
        watch = {sessionId, threadId: session.provider_session_id, connections: new Set(), requests: new Map(), rpc: null, ready: null, retry: null};
        watches.set(sessionId, watch);
      }
      watch.connections.add(connection);
      await connect(watch);
    },
    listPending(sessionId        ) {
      return [...(watches.get(sessionId)?.requests.values() || [])].map(({requestId, toolName, input}) => ({requestId, toolName, input}));
    },
    resolve(requestId        , decision                            )          {
      for (const watch of watches.values()) {
        const entry = watch.requests.get(requestId);
        if (!entry) continue;
        if (entry.submitting) return true;
        if (!watch.rpc) throw new Error('Codex 审核连接已断开，请稍后重试。');
        let result           ;
        if (entry.method === 'item/tool/requestUserInput') {
          const answers = (decision.updatedInput                         )?.answers || {};
          result = {answers: Object.fromEntries((entry.params.questions || []).map((q           ) => {
            const answer = answers[q.id] ?? answers[q.question];
            return [q.id, {answers: Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : []}];
          }))};
        } else if (entry.method === 'item/permissions/requestApproval') {
          result = {permissions: decision.allow ? entry.params.permissions : {}, scope: 'turn'};
        } else if (['execCommandApproval', 'applyPatchApproval'].includes(entry.method)) {
          result = {decision: decision.allow ? 'approved' : {denied: {rejection: decision.message || '用户拒绝了此操作。'}}};
        } else result = {decision: decision.allow ? 'accept' : 'decline'};
        // Keep the card pending until the daemon confirms serverRequest/resolved.
        entry.submitting = true;
        try { watch.rpc.send({jsonrpc: '2.0', id: entry.rpcId, result}); }
        catch (error) { entry.submitting = false; throw error; }
        return true;
      }
      return false;
    },
    unwatchConnection(connection                          )       {
      for (const [sessionId, watch] of watches) {
        watch.connections.delete(connection);
        if (watch.connections.size) continue;
        watches.delete(sessionId);
        if (watch.retry) clearTimeout(watch.retry);
        watch.requests.clear();
        watch.rpc?.close();
      }
    },
  };
}

/** Chat websocket subscriptions, snapshots and decision routing use this bridge. */
export const codexApprovalService = createCodexApprovalService();

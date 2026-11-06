import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import {readCodexArtifactLines, resolveCodexRolloutPath} from './codex-rollout-files.js';
import { sessionsDb } from '../../../database/repositories/sessions.db.js';
import { AppError } from '../../../../shared/utils.js';
import { getCodexConnection } from './codex-rpc.js';

const suffix = /(?:^|\.)request_user_input_async$/;
const states = new Map();
const submissions = new Map();
const deliveries = new Map();

export function createQuestionState() {
  return { calls: new Map(), requests: new Map(), answers: new Map() };
}

function readQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) return null;
  if (questions.some(q => typeof q?.title !== 'string' || !q.title.trim()
    || (q.options != null && (!Array.isArray(q.options) || q.options.some(o => typeof o !== 'string'))))) return null;
  return questions.map(q => ({ title: q.title, options: q.options || [] }));
}

/** Keep the call id AND index: titles and even option labels need not be unique. */
export function consumeQuestionRecord(state, entry) {
  const p = entry?.payload;
  if (!p) return;
  if (entry.type === 'response_item' && p.type === 'function_call' && suffix.test(p.name || '')) {
    try {
      const questions = readQuestions(JSON.parse(p.arguments).questions);
      if (questions) state.calls.set(p.call_id, { tool: p.name, questions });
      const request = state.requests.get(p.call_id);
      if (request) request.tool = p.name;
    } catch { /* An incomplete tool call is not an interactive question. */ }
  }
  const item = entry.type === 'event_msg' && p.type === 'item_completed' ? p.item : null;
  if (item && ['AgentMessage', 'agentMessage'].includes(item.type)) {
    const questions = readQuestions(item.questions);
    if (questions && item.id) state.requests.set(item.id, {
      id: item.id, tool: state.calls.get(item.id)?.tool || 'request_user_input_async',
      questions, timestamp: entry.timestamp,
    });
  }
  // Some exec/older clients persist the call and accepted output, but omit
  // AgentMessage metadata. Only promote a call after the tool accepts it.
  if (entry.type === 'response_item' && p.type === 'function_call_output' && state.calls.has(p.call_id)) {
    try {
      if (JSON.parse(p.output)?.accepted === true && !state.requests.has(p.call_id)) {
        state.requests.set(p.call_id, { id: p.call_id, ...state.calls.get(p.call_id), timestamp: entry.timestamp });
      }
    } catch { /* A failed tool result must not create a card. */ }
  }
  const texts = [];
  if (entry.type === 'response_item' && p.type === 'message' && p.role === 'user') {
    texts.push(...(p.content || []).map(c => c.text || ''));
  }
  if (entry.type === 'event_msg' && p.type === 'user_message') texts.push(p.message || '');
  if (item && ['UserMessage', 'userMessage'].includes(item.type)) {
    texts.push(...(item.content || []).map(c => c.text || ''));
  }
  for (const text of texts) {
    for (const match of text.matchAll(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/g)) {
      try {
        const answers = JSON.parse(match[1]);
        if (!Array.isArray(answers)) continue;
        for (const answer of answers) {
          if (typeof answer.questionItemId !== 'string' || typeof answer.answer !== 'string') continue;
          const [tool, callId, index] = JSON.parse(answer.questionItemId);
          if (suffix.test(tool) && typeof callId === 'string' && Number.isInteger(index)) {
            state.answers.set(JSON.stringify([callId, index]), answer.answer);
          }
        }
      } catch { /* Ordinary user text is not a question reply. */ }
    }
  }
}

export function questionRequests(state) {
  return [...state.requests.values()].map(request => {
    const questions = request.questions.map((q, index) => ({
      ...q, id: JSON.stringify([request.tool, request.id, index]),
      answer: state.answers.get(JSON.stringify([request.id, index])) ?? null,
    }));
    return { id: request.id, timestamp: request.timestamp, questions,
      status: questions.every(q => q.answer !== null) ? 'answered' : 'pending' };
  });
}

function sessionRow(sessionId) {
  const row = sessionsDb.getSessionById(sessionId);
  if (!row || row.provider !== 'codex' || !row.provider_session_id) {
    throw new AppError('Codex 会话不存在或尚未建立。', { statusCode: 404, code: 'CODEX_SESSION_NOT_FOUND' });
  }
  return row;
}

async function readState(row) {
  // The transcript path is resolved exclusively from the authenticated session
  // database, never from a client-supplied file path or thread id.
  if (!row.jsonl_path) return { state: createQuestionState(), revision: '0' };
  try { row = {...row, jsonl_path: await resolveCodexRolloutPath(row.jsonl_path)}; }
  catch (error) { if (error.code === 'ENOENT') return {state: createQuestionState(), revision: '0'}; throw error; }
  if (row.jsonl_path.endsWith('.zst')) {
    const stat = await fs.stat(row.jsonl_path);
    const revision = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    let cached = states.get(row.session_id);
    if (cached?.path === row.jsonl_path && cached.revision === revision) {
      if (cached.reading) await cached.reading;
      return cached;
    }
    cached = {state: createQuestionState(), path: row.jsonl_path, revision};
    cached.reading = (async () => {
      for await (const line of readCodexArtifactLines(row.jsonl_path)) {
        try {consumeQuestionRecord(cached.state, JSON.parse(line));} catch { /* Ignore malformed rows. */ }
      }
    })();
    states.set(row.session_id, cached);
    if (states.size > 32) states.delete(states.keys().next().value);
    try {await cached.reading;} catch (error) {states.delete(row.session_id);throw error;}
    finally {cached.reading = null;}
    return cached;
  }

  let stat;
  try { stat = await fs.stat(row.jsonl_path); }
  catch (error) { if (error.code === 'ENOENT') return { state: createQuestionState(), revision: '0' }; throw error; }
  let cached = states.get(row.session_id);
  if (!cached || cached.path !== row.jsonl_path || cached.ino !== stat.ino || stat.size < cached.offset) {
    cached = { state: createQuestionState(), offset: 0, path: row.jsonl_path, ino: stat.ino, revision: '' };
    states.set(row.session_id, cached);
    if (states.size > 32) states.delete(states.keys().next().value);
  }
  // Serialize reads so simultaneous tabs cannot consume the same tail twice.
  if (cached.reading) { await cached.reading; return readState(row); }
  if (stat.size > cached.offset) {
    cached.reading = (async () => {
      const stream = createReadStream(row.jsonl_path, { start: cached.offset, end: stat.size - 1 });
      const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let consumed = 0;
      for await (const line of reader) {
        // Rollouts append whole JSON lines. If the final line is partial, leave
        // it unread for the next poll instead of losing a question or answer.
        const bytes = Buffer.byteLength(line) + 1;
        if (cached.offset + consumed + bytes > stat.size) break;
        try { consumeQuestionRecord(cached.state, JSON.parse(line)); } catch { /* Ignore malformed rows. */ }
        consumed += bytes;
      }
      cached.offset += consumed;
      cached.revision = `${stat.ino}:${cached.offset}`;
    })();
    try { await cached.reading; } finally { cached.reading = null; }
  }
  return cached;
}

export async function listCodexQuestions(sessionId) {
  const row = sessionRow(sessionId);
  const { state, revision } = await readState(row);
  const requests = questionRequests(state);
  // A daemon acknowledgement precedes transcript fsync. Keep a delivery
  // receipt until the persisted user envelope catches up.
  for (const request of requests) {
    const receipt = deliveries.get(`${sessionId}:${request.id}`);
    if (receipt) {
      for (const question of request.questions) question.answer ??= receipt.answers.get(question.id) ?? null;
      request.status = 'answered';
    }
  }
  return { sessionId, providerSessionId: row.provider_session_id, revision,
    requests: [...requests.filter(r => r.status === 'answered').slice(-3), ...requests.filter(r => r.status === 'pending')] };
}

export function buildQuestionReply(request, input) {
  if (!Array.isArray(input) || input.length !== request.questions.length) {
    throw new AppError('请回答全部问题。', { statusCode: 400, code: 'INVALID_QUESTION_ANSWERS' });
  }
  const answers = new Map();
  for (const answer of input) {
    if (typeof answer?.questionItemId !== 'string' || typeof answer.answer !== 'string'
      || !answer.answer.trim() || answer.answer.length > 32000 || answers.has(answer.questionItemId)
      || !request.questions.some(q => q.id === answer.questionItemId)) {
      throw new AppError('问题 ID 或答案无效，请刷新后重试。', { statusCode: 400, code: 'INVALID_QUESTION_ANSWERS' });
    }
    answers.set(answer.questionItemId, answer.answer.trim());
  }
  const reply = request.questions.map(q => ({ answer: answers.get(q.id), question: q.title, questionItemId: q.id }));
  return { answers, text: `<send_user_message_question_reply>\n${JSON.stringify(reply).replace(/</g, '\\u003c')}\n</send_user_message_question_reply>` };
}

export async function submitCodexAnswers(sessionId, requestId, input) {
  const key = `${sessionId}:${requestId}`;
  if (submissions.has(key)) throw new AppError('答案正在提交，请稍候。', { statusCode: 409, code: 'ANSWER_IN_PROGRESS' });
  submissions.set(key, true);
  let rpc;
  try {
    const listing = await listCodexQuestions(sessionId);
    const request = listing.requests.find(r => r.id === requestId);
    if (!request) throw new AppError('问题不存在。', { statusCode: 404, code: 'QUESTION_NOT_FOUND' });
    if (request.status === 'answered') return { delivered: true, alreadyAnswered: true, providerSessionId: listing.providerSessionId };
    const reply = buildQuestionReply(request, input);
    rpc = await getCodexConnection();
    // Attach to the daemon that owns the original terminal/UI thread. Starting
    // another codex exec writer here causes the active-writer conflict.
    await rpc.call('thread/resume', { threadId: listing.providerSessionId, excludeTurns: true });
    const result = await rpc.call('turn/start', {
      threadId: listing.providerSessionId, clientUserMessageId: `cloudcli-question:${request.id}`,
      input: [{ type: 'text', text: reply.text }],
    });
    deliveries.set(key, { answers: reply.answers, turnId: result.turn.id });
    if (deliveries.size > 256) deliveries.delete(deliveries.keys().next().value);
    return { delivered: true, providerSessionId: listing.providerSessionId, turnId: result.turn.id };
  } finally { submissions.delete(key); }
}

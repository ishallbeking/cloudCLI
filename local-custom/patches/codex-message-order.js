// Used in the compiled client and imported directly by regression tests.
export function cloudcliIsCodexHistory(server, realtime) {
  const all = [...server, ...realtime];
  return all.length > 0 && all.every(message => message.provider === 'codex');
}

export function cloudcliCodexUpsert(slot, message) {
  // Capture a durable insertion anchor before the optimistic message is shown.
  // Browser wall time is display-only and must never decide its position.
  if (message.id.startsWith('local_') && message.role === 'user') {
    message = {...message, _cloudcliAfterId: slot.merged.at(-1)?.id ?? null};
  }
  const previous = slot.realtimeMessages.find(item => item.id === message.id);
  const next = previous ? {...previous, ...message, timestamp: previous.timestamp} : message;
  return [...slot.realtimeMessages.filter(item => item.id !== message.id), next];
}

export function cloudcliCodexPending(server, realtime) {
  const persisted = new Set(server.map(item => item.id));
  const authoritative = [...server, ...realtime.filter(item => !item.id.startsWith('local_'))];
  const acknowledged = new Set(authoritative.map(item => item.clientMessageId).filter(Boolean));
  return [...new Map(realtime.map(item => [item.id, item])).values()].filter(item =>
    !persisted.has(item.id) && !(item.id.startsWith('local_') && acknowledged.has(item.id)));
}

export function cloudcliMergeCodexMessages(server, realtime) {
  const pending = cloudcliCodexPending(server, realtime);
  const rows = [...server, ...pending.filter(item => !item.id.startsWith('local_'))];
  // Every nonoptimistic timestamp is now from the server. Native item IDs are
  // the sole deduplication key; identical replies on different turns are valid.
  rows.sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0));
  const unique = [...new Map(rows.map(item => [item.id, item])).values()];
  const tails = new Map();
  for (const local of pending.filter(item => item.id.startsWith('local_'))) {
    const anchor = tails.get(local._cloudcliAfterId) || local._cloudcliAfterId;
    const index = unique.findIndex(item => item.id === anchor);
    unique.splice(index < 0 ? unique.length : index + 1, 0, local);
    tails.set(local._cloudcliAfterId, local.id);
  }
  return unique;
}

// Session + run, never just a session-scoped 'latest stream'. The run start
// timestamp prevents delayed events from a previous run replacing the new one.
const cloudcliCodexRuns = new Map();
export function cloudcliAcceptRunEvent(message) {
  if (!message.sessionId || !message.runId) return true;
  const previous = cloudcliCodexRuns.get(message.sessionId);
  if (previous && previous.id !== message.runId && previous.startedAt > message.runStartedAt) return false;
  if (!previous || previous.id !== message.runId) {
    cloudcliCodexRuns.set(message.sessionId, {id: message.runId, startedAt: message.runStartedAt, seq: 0});
  }
  const current = cloudcliCodexRuns.get(message.sessionId);
  if (typeof message.seq !== 'number') return true;
  if (message.seq <= current.seq) return false;
  current.seq = message.seq;
  return true;
}

export function cloudcliRunCursor(sessionId, fallback = 0) {
  const current = cloudcliCodexRuns.get(sessionId);
  return {runId: current?.id, lastSeq: current ? current.seq : fallback};
}

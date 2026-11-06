import { CodexRpc } from '../list/codex/codex-rpc.js';

type LiveSession = { providerSessionId: string; startedAt: number; statusText: string };
type Rpc = {
  initialize(): Promise<unknown>;
  call(method: string, params: Record<string, unknown>, timeout?: number): Promise<any>;
  close(): void;
};

/** Used by sessionsService to restore activity after reload or WebUI restart.
 * Reads metadata only; never resumes, interrupts, starts a daemon or claims a writer.
 * A short shared cache coalesces sidebar polls from multiple browser tabs.
 */
export function createCodexLivenessReader(createRpc: () => Rpc = () => new CodexRpc()) {
  let snapshot: LiveSession[] = [];
  let expiresAt = 0;
  let pending: Promise<LiveSession[]> | null = null;
  return async (): Promise<LiveSession[]> => {
    if (pending) return pending;
    if (Date.now() < expiresAt) return snapshot;
    pending = (async () => {
      const rpc = createRpc();
      try {
        await rpc.initialize();
        const ids = new Set<string>();
        let cursor: string | undefined;
        const seenCursors = new Set<string>();
        do {
          const page = await rpc.call('thread/loaded/list', {limit: 100, ...(cursor ? {cursor} : {})}, 3000);
          for (const id of page.data ?? []) if (typeof id === 'string') ids.add(id);
          cursor = page.nextCursor || undefined;
          if (cursor && seenCursors.has(cursor)) throw new Error('Repeated Codex pagination cursor');
          if (cursor) seenCursors.add(cursor);
        } while (cursor);
        const result: LiveSession[] = [];
        const remaining = [...ids];
        // Bound concurrent metadata requests; excludeTurns avoids materializing transcripts.
        await Promise.all(Array.from({length: Math.min(4, remaining.length)}, async () => {
          for (let id = remaining.pop(); id; id = remaining.pop()) {
            try {
              const {thread} = await rpc.call('thread/read', {threadId: id, includeTurns: false}, 3000);
              if (thread?.status?.type !== 'active') continue;
              const updatedAt = Number(thread.updatedAt) * 1000;
              result.push({providerSessionId: id,
                startedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
                statusText: 'Thinking · Codex'});
            } catch { /* A loaded thread can be unloaded between these two reads. */ }
          }
        }));
        return result;
      } catch {
        // A disconnected daemon must not leave a stale Thinking badge forever.
        return [];
      } finally { rpc.close(); }
    })();
    try {
      snapshot = await pending;
      expiresAt = Date.now() + 1000;
      return snapshot;
    } finally { pending = null; }
  };
}

/** Status-only Codex observer consumed by the providers sessions service. */
export const listBusyCodexSessions = createCodexLivenessReader();

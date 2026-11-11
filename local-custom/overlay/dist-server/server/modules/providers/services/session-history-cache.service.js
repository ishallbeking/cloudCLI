import fsp from 'node:fs/promises';
/**
 * Disk and normalized-payload budgets are both strict. A compressed or forked
 * transcript can expand far beyond its own file size. Oversized results are
 * returned to this request but never retained in the cache.
 */
const MAX_CACHED_TRANSCRIPT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;
export function createSessionHistoryCache(maxTotalFileBytes = MAX_CACHED_TRANSCRIPT_FILE_BYTES, maxEntries = MAX_CACHE_ENTRIES, maxHeapBytes = 64 * 1024 * 1024) {
    const entries = new Map();
    const pendingLoads = new Map();
    function evictOverBudget() {
        let totalBytes = 0;
        let heapBytes = 0;
        for (const entry of entries.values()) {
            totalBytes += entry.size;
            heapBytes += entry.heapCost;
        }
        for (const key of entries.keys()) {
            if (totalBytes <= maxTotalFileBytes && heapBytes <= maxHeapBytes && entries.size <= maxEntries) {
                break;
            }
            totalBytes -= entries.get(key).size;
            heapBytes -= entries.get(key).heapCost;
            entries.delete(key);
        }
    }
    return {
        /**
         * Returns the session's full transcript through the cache, or null when
         * the session is not cacheable (no transcript path, or the file cannot be
         * stat'ed) — the caller then falls back to a plain provider read.
         */
        async getFullHistory({ sessionId, transcriptPath, loadFull }) {
            if (!transcriptPath) {
                return null;
            }
            let stat;
            try {
                stat = await fsp.stat(transcriptPath);
            }
            catch {
                entries.delete(sessionId);
                return null;
            }
            if (!stat.isFile()) {
                entries.delete(sessionId);
                return null;
            }
            const cached = entries.get(sessionId);
            if (cached
                && cached.transcriptPath === transcriptPath
                && cached.mtimeMs === stat.mtimeMs
                && cached.size === stat.size) {
                // Re-insert to mark as most recently used.
                entries.delete(sessionId);
                entries.set(sessionId, cached);
                return cached.full;
            }
            // Concurrent requests for the same session share one parse. The file may
            // gain rows while the load runs; the pre-load stat is what the entry is
            // keyed by, so the next request would see a changed stat and re-read.
            const pending = pendingLoads.get(sessionId);
            if (pending) {
                return pending;
            }
            // Release stale content before parsing its replacement. A compressed
            // or inherited transcript can normalize far beyond its on-disk size.
            entries.delete(sessionId);
            const load = loadFull().then((full) => {
                const heapCost = 2 * Buffer.byteLength(JSON.stringify(full), 'utf8') + full.messages.length * 512;
                entries.delete(sessionId);
                entries.set(sessionId, {
                    transcriptPath,
                    mtimeMs: stat.mtimeMs,
                    size: stat.size,
                    heapCost,
                    full,
                });
                evictOverBudget();
                return full;
            });
            pendingLoads.set(sessionId, load);
            try {
                return await load;
            }
            finally {
                pendingLoads.delete(sessionId);
            }
        },
        /** Forgets a session's entry so the next read re-parses its transcript. */
        invalidate(sessionId) {
            entries.delete(sessionId);
        },
    };
}
export const sessionHistoryCache = createSessionHistoryCache();

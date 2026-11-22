import fsp from 'node:fs/promises';

import type { FetchHistoryResult } from '@/shared/types.js';

/**
 * Full-transcript cache for session history reads.
 *
 * Every provider history reader materializes the complete normalized
 * transcript and then slices out the requested page, so serving a 20-row page
 * of a large session re-read and re-parsed the whole transcript file on every
 * request — opening a session, each older page while scrolling up, and every
 * post-turn refresh. For a multi-megabyte JSONL that is most of a second of
 * CPU per request.
 *
 * Entries are keyed by app session id and validated with one `stat` per
 * request against the transcript file's identity (path + mtime + size), so
 * only the first read after the file changes pays the parse. Anything that
 * rewrites history (a new turn, an edit, a rewind, a fork) touches the file
 * and invalidates naturally.
 *
 * One thing the file cannot tell: whether the CLI process behind the session
 * is still running. Claude's history reader answers a background agent's
 * status from that, so a session's entry is also dropped explicitly when its
 * process starts or ends (`invalidate`) — otherwise a page read while the
 * process was up would keep reporting `running` after it had gone, until the
 * next row happened to land in the file.
 *
 * Only history readers that read `jsonl_path` itself may use this cache —
 * callers pass `transcriptPath: null` for providers whose messages live
 * elsewhere (Cursor's store.db, OpenCode's shared SQLite), which bypasses
 * caching entirely.
 */

type CacheEntry = {
  transcriptPath: string;
  mtimeMs: number;
  /** Original file size, used only to validate the transcript identity. */
  size: number;
  heapCost: number;
  full: FetchHistoryResult;
};

type GetFullHistoryArgs = {
  sessionId: string;
  /** Path of the file the provider's history reader actually parses, or null to bypass. */
  transcriptPath: string | null | undefined;
  /** Loads the complete transcript (`limit: null, offset: 0`) from the provider. */
  loadFull: () => Promise<FetchHistoryResult>;
};

/**
 * Only normalized messages are retained, never the original JSONL. Charge
 * the smaller of source size and normalized heap cost against the source
 * budget: large rollouts often consist mainly of duplicated provider events
 * and compressed snapshots. Their small normalized histories should not miss
 * the cache on every page. The separate heap budget remains strict even when
 * a tiny fork expands into a much larger normalized transcript.
 */
const MAX_CACHED_TRANSCRIPT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;

export function createSessionHistoryCache(
  maxTotalFileBytes = MAX_CACHED_TRANSCRIPT_FILE_BYTES,
  maxEntries = MAX_CACHE_ENTRIES,
  maxHeapBytes = 64 * 1024 * 1024,
) {
  const entries = new Map<string, CacheEntry>();
  const pendingLoads = new Map<string, Promise<FetchHistoryResult>>();

  function evictOverBudget(): void {
    let totalBytes = 0;
    let heapBytes = 0;
    for (const entry of entries.values()) {
      totalBytes += Math.min(entry.size, entry.heapCost);
      heapBytes += entry.heapCost;
    }
    for (const key of entries.keys()) {
      if (totalBytes <= maxTotalFileBytes && heapBytes <= maxHeapBytes && entries.size <= maxEntries) {
        break;
      }
      totalBytes -= Math.min(entries.get(key)!.size, entries.get(key)!.heapCost);
      heapBytes -= entries.get(key)!.heapCost;
      entries.delete(key);
    }
  }

  return {
    /**
     * Returns the session's full transcript through the cache, or null when
     * the session is not cacheable (no transcript path, or the file cannot be
     * stat'ed) — the caller then falls back to a plain provider read.
     */
    async getFullHistory({ sessionId, transcriptPath, loadFull }: GetFullHistoryArgs): Promise<FetchHistoryResult | null> {
      if (!transcriptPath) {
        return null;
      }

      let stat;
      try {
        stat = await fsp.stat(transcriptPath);
      } catch {
        entries.delete(sessionId);
        return null;
      }
      if (!stat.isFile()) {
        entries.delete(sessionId);
        return null;
      }

      const cached = entries.get(sessionId);
      if (
        cached
        && cached.transcriptPath === transcriptPath
        && cached.mtimeMs === stat.mtimeMs
        && cached.size === stat.size
      ) {
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
      } finally {
        pendingLoads.delete(sessionId);
      }
    },

    /** Forgets a session's entry so the next read re-parses its transcript. */
    invalidate(sessionId: string): void {
      entries.delete(sessionId);
    },
  };
}

export const sessionHistoryCache = createSessionHistoryCache();

import os from 'node:os';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {sessionsDb} from '../../../../modules/database/index.js';
import {normalizeSessionName} from '../../../../shared/utils.js';
import {findCodexRolloutFiles, readCodexArtifactLines, readCodexSessionNames, resolveCodexRolloutPath} from './codex-rollout-files.js';

const UNTITLED = 'Untitled Codex Session';

/** Index native plain/compressed rollouts without materializing copies. */
export class CodexSessionSynchronizer {
  provider = 'codex';
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  metadataCache = new Map();

  async metadata(filePath) {
    const fileStat = await stat(filePath);
    const fingerprint = `${fileStat.ino}:${fileStat.size}:${fileStat.mtimeMs}`;
    const cached = this.metadataCache.get(filePath);
    if (cached?.fingerprint === fingerprint) return {...cached, fileStat};
    let metadata = null;
    for await (const line of readCodexArtifactLines(filePath)) {
      let row; try {row = JSON.parse(line);} catch {continue;}
      const payload = row.payload;
      if (row.type !== 'session_meta' || typeof payload?.id !== 'string' || typeof payload.cwd !== 'string') continue;
      const subagent = payload.thread_source === 'subagent'
        || (payload.source && typeof payload.source === 'object' && 'subagent' in payload.source);
      metadata = subagent ? null : {sessionId: payload.id, projectPath: payload.cwd, timestamp: row.timestamp};
      break;
    }
    const result = {fingerprint, metadata};
    this.metadataCache.set(filePath, result);
    if (this.metadataCache.size > 4096) this.metadataCache.delete(this.metadataCache.keys().next().value);
    return {...result, fileStat};
  }

  async upsert(filePath, info, names) {
    const parsed = info.metadata;
    if (!parsed || sessionsDb.isProviderSessionSuperseded(parsed.sessionId, this.provider)) return null;
    const existing = sessionsDb.getSessionByProviderSessionId(parsed.sessionId) ?? sessionsDb.getSessionById(parsed.sessionId);
    // An expanded live rollout always wins over an older compressed snapshot.
    if (filePath.endsWith('.zst') && existing?.jsonl_path && !existing.jsonl_path.endsWith('.zst')) {
      try {if ((await stat(existing.jsonl_path)).isFile()) return null;} catch { /* It was compressed in place. */ }
    }
    const indexed = names.get(parsed.sessionId);
    const existingName = existing?.custom_name;
    let name = existingName && existingName !== UNTITLED ? existingName : undefined;
    if (indexed && (!name || (existing?.session_id === parsed.sessionId && [...indexed.priorNames].some(prior => normalizeSessionName(prior, UNTITLED) === name)))) name = indexed.name;
    if (!name) {
      // Cache this fallback: old unnamed archives should not be decompressed
      // again for every project refresh. No transcript content is cached.
      if (!Object.hasOwn(info, 'fallbackName')) {
        let last;
        for await (const line of readCodexArtifactLines(filePath)) {
          try {const row = JSON.parse(line);if (row.type === 'event_msg' && row.payload?.type === 'task_complete' && row.payload.last_agent_message?.trim()) last = row.payload.last_agent_message;} catch { /* Partial row. */ }
        }
        info.fallbackName = normalizeSessionName(last, UNTITLED);
        this.metadataCache.set(filePath, {...info, fileStat: undefined});
      }
      name = info.fallbackName;
    }
    // Metadata records the original creation date; compression time does not.
    const created = Date.parse(parsed.timestamp) ? new Date(parsed.timestamp).toISOString() : info.fileStat.birthtime.toISOString();
    const normalizedName = normalizeSessionName(name, UNTITLED);
    if (existing?.jsonl_path === filePath && existing.custom_name === normalizedName
      && existing.project_path === parsed.projectPath
      && Date.parse(existing.updated_at) === Date.parse(info.fileStat.mtime.toISOString())) return existing.session_id;
    const id = sessionsDb.createSession(parsed.sessionId, this.provider, parsed.projectPath,
      normalizedName, created, info.fileStat.mtime.toISOString(), filePath);
    if (filePath.split(path.sep).includes('archived_sessions') && (!existing || existing.jsonl_path !== filePath)) sessionsDb.updateSessionIsArchived(id, true);
    return id;
  }

  async synchronize(_since) {
    const names = await readCodexSessionNames(path.join(this.codexHome, 'session_index.jsonl'));
    const files = [...await findCodexRolloutFiles(path.join(this.codexHome, 'sessions')),
      ...await findCodexRolloutFiles(path.join(this.codexHome, 'archived_sessions'))];
    const selected = new Map();
    for (const filePath of files) {
      let info;
      try {info = await this.metadata(filePath);}
      catch (error) {console.warn('[Codex] Cannot index rollout', filePath, error.message);continue;}
      if (!info.metadata) continue;
      const old = selected.get(info.metadata.sessionId);
      const plain = !filePath.endsWith('.zst');
      if (!old || (plain && old.filePath.endsWith('.zst')) || (plain === !old.filePath.endsWith('.zst') && info.fileStat.mtimeMs > old.info.fileStat.mtimeMs)) selected.set(info.metadata.sessionId, {filePath, info});
    }
    let count = 0;
    for (const {filePath, info} of selected.values()) if (await this.upsert(filePath, info, names)) count++;
    return count;
  }

  async synchronizeFile(filePath) {
    if (!/\.jsonl(?:\.zst)?$/.test(filePath)) return null;
    try {filePath = await resolveCodexRolloutPath(filePath);} catch (error) {if (error.code === 'ENOENT') return null;throw error;}
    const names = await readCodexSessionNames(path.join(this.codexHome, 'session_index.jsonl'));
    return this.upsert(filePath, await this.metadata(filePath), names);
  }
}

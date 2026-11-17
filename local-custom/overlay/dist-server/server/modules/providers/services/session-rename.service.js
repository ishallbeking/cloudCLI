import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { sessionsDb } from './../../database/index.js';
import { broadcastSessionUpserted } from './../../websocket/index.js';
import { AppError } from './../../../shared/index.js';
import { CodexRpc } from '../list/codex/codex-rpc.js';
/** Used by sessionsService and its regression tests to synchronize UI renames
 * with native CLI titles. Serializes each session and commits the UI title only
 * after native persistence succeeds; never resumes a thread or edits messages.
 */
export function createSessionRenameService(createRpc = () => new CodexRpc()) {
    const pending = new Map();
    async function rename(sessionId, summary) {
        const session = sessionsDb.getSessionById(sessionId);
        if (!session) {
            throw new AppError(`Session "${sessionId}" was not found.`, { code: 'SESSION_NOT_FOUND', statusCode: 404 });
        }
        const nativeId = session.provider_session_id;
        try {
            // An unsent app session has no native history to rename yet.
            if (nativeId && session.provider === 'codex') {
                const rpc = createRpc();
                try {
                    await rpc.initialize();
                    await rpc.call('thread/name/set', { threadId: nativeId, name: summary }, 10000);
                }
                finally {
                    rpc.close();
                }
            }
            else if (nativeId && session.provider === 'claude') {
                if (!session.jsonl_path)
                    throw new Error('Claude transcript path is unavailable.');
                // O_APPEND preserves concurrent CLI writes. Omitting O_CREAT prevents a
                // stale path from silently creating a disconnected, empty transcript.
                const file = await open(session.jsonl_path, constants.O_WRONLY | constants.O_APPEND);
                try {
                    if (!(await file.stat()).isFile())
                        throw new Error('Claude transcript is not a regular file.');
                    await file.writeFile('\n' + JSON.stringify({ type: 'custom-title', customTitle: summary, sessionId: nativeId }) + '\n');
                    await file.sync();
                }
                finally {
                    await file.close();
                }
            }
        }
        catch (error) {
            throw new AppError('Unable to synchronize the session name with the CLI. Please retry.', {
                code: 'SESSION_RENAME_SYNC_FAILED', statusCode: 502,
                details: error instanceof Error ? error.message : String(error),
            });
        }
        sessionsDb.updateSessionCustomName(sessionId, summary);
        // Persistence has succeeded; a disconnected browser must not turn a
        // completed rename into an HTTP failure.
        await broadcastSessionUpserted(sessionId).catch(error => console.warn('[Session rename] Broadcast failed:', error));
        return { sessionId, summary };
    }
    return {
        renameSessionById(sessionId, summary) {
            const operation = (pending.get(sessionId) ?? Promise.resolve()).catch(() => { }).then(() => rename(sessionId, summary));
            pending.set(sessionId, operation);
            const cleanup = () => { if (pending.get(sessionId) === operation)
                pending.delete(sessionId); };
            operation.then(cleanup, cleanup);
            return operation;
        },
    };
}
/** Shared rename coordinator used by sessionsService for the HTTP rename route. */
export const sessionRenameService = createSessionRenameService();

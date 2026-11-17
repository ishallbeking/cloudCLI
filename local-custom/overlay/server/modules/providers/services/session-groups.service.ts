import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sessionGroupsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/index.js';

function requireGroup(userId: number, id: string) {
  if (!sessionGroupsDb.get(userId, id)) throw new AppError('组不存在。', {code: 'GROUP_NOT_FOUND', statusCode: 404});
}
function titleError(error: unknown): never {
  if ((error as {code?: string}).code?.startsWith('SQLITE_CONSTRAINT')) {
    throw new AppError('已有同名的组，请换一个名称。', {code: 'GROUP_NAME_EXISTS', statusCode: 409});
  }
  throw error;
}
function present(row: ReturnType<typeof sessionGroupsDb.candidates>['rows'][number]) {
  return {...row, projectDisplayName: row.projectName?.trim() || (row.projectPath ? path.basename(row.projectPath) || row.projectPath : '无项目')};
}

/** Used by the Providers group routes to organize sessions without changing native histories. */
export const sessionGroupsService = {
  list(userId: number) {
    const members = sessionGroupsDb.members(userId);
    const grouped = new Map<string, ReturnType<typeof present>[]>();
    for (const {groupId, ...row} of members) {
      const list = grouped.get(groupId) ?? [];
      list.push(present(row)); grouped.set(groupId, list);
    }
    return {groups: sessionGroupsDb.list(userId).map(group => ({...group, sessions: grouped.get(group.id) ?? []}))};
  },
  create(userId: number, name: string) {
    const id = randomUUID();
    try { sessionGroupsDb.create(userId, id, name); } catch (error) { titleError(error); }
    return {id, name};
  },
  rename(userId: number, id: string, name: string) {
    requireGroup(userId, id);
    try { sessionGroupsDb.rename(userId, id, name); } catch (error) { titleError(error); }
    return {id, name};
  },
  remove(userId: number, id: string) {
    requireGroup(userId, id); sessionGroupsDb.remove(userId, id);
    return {id};
  },
  add(userId: number, id: string, sessionIds: string[]) {
    requireGroup(userId, id);
    if (!sessionGroupsDb.add(userId, id, sessionIds)) {
      throw new AppError('部分对话已不存在，请刷新后重试。', {code: 'GROUP_SESSION_NOT_FOUND', statusCode: 404});
    }
    return {id};
  },
  removeMember(userId: number, id: string, sessionId: string) {
    requireGroup(userId, id); sessionGroupsDb.removeMember(userId, id, sessionId);
    return {id, sessionId};
  },
  candidates(query: string, limit: number, offset: number) {
    const {rows, total} = sessionGroupsDb.candidates(query, limit, offset);
    return {conversations: rows.map(present), total, hasMore: offset + rows.length < total};
  },
};

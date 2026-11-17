import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { createSessionRenameService } from '../services/session-rename.service.js';
import { sessionsService } from '../services/sessions.service.js';

async function isolated(run: (directory: string) => Promise<void>) {
  const oldPath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-rename-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try { await run(directory); }
  finally {
    closeConnection();
    if (oldPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldPath;
    await rm(directory, {recursive: true, force: true});
  }
}

test('Codex rename persists through the native ID and waits for native acknowledgement', async () => isolated(async () => {
  sessionsDb.createAppSession('app-id', 'codex', '/tmp/project', 'Original');
  sessionsDb.assignProviderSessionId('app-id', 'native-id');
  let closed = false;
  const service = createSessionRenameService(() => ({
    initialize: async () => {},
    call: async (method, params) => {
      assert.equal(method, 'thread/name/set');
      assert.deepEqual(params, {threadId: 'native-id', name: '新名称'});
      assert.equal(sessionsDb.getSessionById('app-id')?.custom_name, 'Original');
    },
    close: () => { closed = true; },
  }));
  assert.deepEqual(await service.renameSessionById('app-id', '新名称'), {sessionId: 'app-id', summary: '新名称'});
  assert.equal(sessionsDb.getSessionById('app-id')?.custom_name, '新名称');
  assert.equal(closed, true);
}));

test('Codex failure keeps original title, releases the connection, and allows retry', async () => isolated(async () => {
  sessionsDb.createSession('native-id', 'codex', '/tmp/project', 'Original');
  let fail = true;
  let closes = 0;
  const service = createSessionRenameService(() => ({
    initialize: async () => {}, call: async () => { if (fail) throw new Error('Disconnected'); },
    close: () => { closes++; },
  }));
  await assert.rejects(service.renameSessionById('native-id', 'Lost'), {code: 'SESSION_RENAME_SYNC_FAILED', statusCode: 502});
  assert.equal(sessionsDb.getSessionById('native-id')?.custom_name, 'Original');
  fail = false;
  await service.renameSessionById('native-id', 'Retried');
  assert.equal(sessionsDb.getSessionById('native-id')?.custom_name, 'Retried');
  assert.equal(closes, 2);
}));

test('overlapping renames retain the same final order in native history and the UI', async () => isolated(async () => {
  sessionsDb.createSession('native-id', 'codex', '/tmp/project', 'Original');
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const names: unknown[] = [];
  const service = createSessionRenameService(() => ({
    initialize: async () => {}, call: async (_method, params) => {
      names.push(params.name);
      if (params.name === 'First') await gate;
    }, close: () => {},
  }));
  const first = service.renameSessionById('native-id', 'First');
  const second = service.renameSessionById('native-id', 'Second');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(names, ['First']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(names, ['First', 'Second']);
  assert.equal(sessionsDb.getSessionById('native-id')?.custom_name, 'Second');
}));

test('Claude rename appends native custom-title metadata without changing conversation bytes', async () => isolated(async directory => {
  const file = path.join(directory, 'claude.jsonl');
  const original = JSON.stringify({type: 'user', sessionId: 'native-claude', message: {content: 'keep me'}});
  await writeFile(file, original); // A missing final newline must not corrupt the title row.
  sessionsDb.createSession('native-claude', 'claude', '/tmp/project', 'Original', undefined, undefined, file);
  const service = createSessionRenameService(() => { throw new Error('Must not connect to Codex'); });
  await service.renameSessionById('native-claude', '中文 "标题"\n第二行');
  await appendFile(file, JSON.stringify({type: 'assistant', message: {content: 'still here'}}) + '\n');
  const content = await readFile(file, 'utf8');
  assert.equal(content.startsWith(original), true);
  const rows = content.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows[1], {type: 'custom-title', customTitle: '中文 "标题"\n第二行', sessionId: 'native-claude'});
  assert.equal(rows[2].message.content, 'still here');
}));

test('missing Claude history returns an error and never creates a replacement transcript', async () => isolated(async directory => {
  const file = path.join(directory, 'missing.jsonl');
  sessionsDb.createSession('native-claude', 'claude', '/tmp/project', 'Original', undefined, undefined, file);
  await assert.rejects(sessionsService.renameSessionById('native-claude', 'New'), {code: 'SESSION_RENAME_SYNC_FAILED'});
  await assert.rejects(readFile(file), {code: 'ENOENT'});
  assert.equal(sessionsDb.getSessionById('native-claude')?.custom_name, 'Original');
}));

test('unsent sessions can be renamed locally and missing sessions return 404', async () => isolated(async () => {
  sessionsDb.createAppSession('pending', 'codex', '/tmp/project', 'Original');
  const service = createSessionRenameService(() => { throw new Error('No native thread exists'); });
  await service.renameSessionById('pending', 'Pending title');
  assert.equal(sessionsDb.getSessionById('pending')?.custom_name, 'Pending title');
  await assert.rejects(service.renameSessionById('absent', 'New'), {code: 'SESSION_NOT_FOUND', statusCode: 404});
}));

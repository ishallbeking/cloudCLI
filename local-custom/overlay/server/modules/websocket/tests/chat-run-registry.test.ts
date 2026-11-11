import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * Minimal stand-in for a websocket connection: collects every JSON frame the
 * gateway writer forwards so assertions can inspect the outbound protocol.
 */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-run-registry-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('live events are remapped to the app session id and sequenced', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-1', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-1',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: 'user-1',
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'provider-id-9', content: 'hello' });
    run.writer.send({ kind: 'text', provider: 'claude', sessionId: 'provider-id-9', content: 'hello world' });

    assert.equal(connection.frames.length, 2);
    assert.equal(connection.frames[0]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[0]?.seq, 1);
    assert.equal(connection.frames[1]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[1]?.seq, 2);
  });
});

test('session_created is swallowed and persisted as the provider-id mapping', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-run-2', 'cursor', '/workspace/demo');
    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-2',
      provider: 'cursor',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({
      kind: 'session_created',
      provider: 'cursor',
      sessionId: 'cursor-native-7',
      newSessionId: 'cursor-native-7',
    });

    // The upsert is broadcast without blocking the run: resolving the owning
    // project's display name is async, so let that settle before asserting.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // The provider-native event itself is never forwarded...
    const sessionUpserts = connection.frames.filter((frame) => frame.kind === 'session_upserted');
    assert.equal(sessionUpserts.length, 1);
    assert.equal(sessionUpserts[0]?.sessionId, 'app-run-2');
    assert.equal(sessionUpserts[0]?.providerSessionId, 'cursor-native-7');
    // ...but the canonical mapping is recorded and persisted in the database.
    assert.equal(run.providerSessionId, 'cursor-native-7');
    assert.equal(sessionsDb.getSessionById('app-run-2')?.provider_session_id, 'cursor-native-7');
  });
});

test('complete marks the run finished and duplicate completes are dropped', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-3', 'codex', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-3',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 0 });
    // Late duplicate from a killed runtime's exit handler.
    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 1 });

    const completes = connection.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.actualSessionId, 'app-run-3');
    assert.equal(chatRunRegistry.isProcessing('app-run-3'), false);

    // completeRun is also a no-op once the run already completed.
    chatRunRegistry.completeRun('app-run-3', { exitCode: 1 });
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 1);
  });
});

test('a finished run\'s safety net cannot complete the session\'s next run', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-9', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const firstRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-9',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(firstRun);
    firstRun.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-9', exitCode: 0 });

    // A queued message starts the next run before the first run's runtime
    // promise settles (the chat handler's `finally` hasn't executed yet).
    const secondRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-9',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(secondRun);

    // First run's safety net fires late: it must not touch the new run.
    chatRunRegistry.completeRunIfCurrent(firstRun, { exitCode: 1 });
    assert.equal(chatRunRegistry.isProcessing('app-run-9'), true);
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 1);

    // The second run's own safety net still works while it is current.
    chatRunRegistry.completeRunIfCurrent(secondRun, { exitCode: 1 });
    assert.equal(chatRunRegistry.isProcessing('app-run-9'), false);
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 2);
  });
});

test('listRunningRuns returns only currently running app sessions', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-7', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('app-run-8', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const completedRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-7',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(completedRun);

    const runningRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-8',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(runningRun);

    chatRunRegistry.completeRun('app-run-7', { exitCode: 0 });

    const runningSessions = chatRunRegistry.listRunningRuns();
    assert.deepEqual(runningSessions.map((session) => session.sessionId), ['app-run-8']);
    assert.equal(runningSessions[0]?.provider, 'codex');
  });
});

test('replayEvents returns only events after the requested seq', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-4', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-4',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'a' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'b' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'c' });

    const replayed = chatRunRegistry.replayEvents('app-run-4', 1);
    assert.deepEqual(replayed.map((event) => event.content), ['b', 'c']);
    assert.deepEqual(replayed.map((event) => event.seq), [2, 3]);
  });
});

test('attachConnection adds a socket without cutting off the ones already watching', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-5', 'opencode', '/workspace/demo');
    const firstConnection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-5',
      provider: 'opencode',
      providerSessionId: null,
      connection: firstConnection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'before' });

    // A second tab on the same session subscribes mid-run.
    const secondConnection = new FakeConnection();
    assert.equal(chatRunRegistry.attachConnection('app-run-5', secondConnection), true);
    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'after' });

    assert.deepEqual(firstConnection.frames.map((frame) => frame.content), ['before', 'after']);
    assert.deepEqual(secondConnection.frames.map((frame) => frame.content), ['after']);
  });
});

test('a refreshed tab stops receiving once its old socket is closed', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-5b', 'opencode', '/workspace/demo');
    const staleConnection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-5b',
      provider: 'opencode',
      providerSessionId: null,
      connection: staleConnection,
      userId: null,
    });
    assert.ok(run);

    // The page reloads: the original socket closes and the fresh one subscribes.
    staleConnection.readyState = 3;
    const reloadedConnection = new FakeConnection();
    assert.equal(chatRunRegistry.attachConnection('app-run-5b', reloadedConnection), true);

    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'after' });
    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'later' });

    assert.deepEqual(staleConnection.frames, []);
    assert.deepEqual(reloadedConnection.frames.map((frame) => frame.content), ['after', 'later']);
  });
});

test('startRun rejects a second concurrent run for the same session', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-6', 'opencode', '/workspace/demo');
    const connection = new FakeConnection();
    const first = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(first);

    const second = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.equal(second, null);

    // After the run finishes a new one is allowed again.
    chatRunRegistry.completeRun('app-run-6', { exitCode: 0 });
    const third = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(third);
  });
});

test('Codex cumulative snapshots retain only the latest version and replay in sequence order', () => {
  chatRunRegistry.clearAll();
  const run = chatRunRegistry.startRun({appSessionId: 'memory-snapshots', provider: 'codex', providerSessionId: null, connection: null, userId: null})!;
  for (let i = 1; i <= 800; i++) run.writer.send({id: 'same-item', kind: 'text', provider: 'codex', role: 'assistant', content: 'x'.repeat(i * 1024), turnId: 'owned-turn'});
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].content?.length, 800 * 1024);
  assert.equal(run.events[0].seq, 800);
  assert.equal(run.replayDroppedThroughSeq, 0, 'superseded complete snapshots lose no content');
  assert.ok(run.turnIds.has('owned-turn'));
  assert.ok(run.bufferedBytes < 2 * 1024 * 1024);
  run.writer.send({id: 'different-item', kind: 'text', provider: 'codex', content: 'other'});
  run.writer.send({id: 'same-item', kind: 'text', provider: 'codex', content: 'final'});
  assert.deepEqual(chatRunRegistry.replayEvents(run.appSessionId, 0).map(event => event.seq), [801, 802]);
  chatRunRegistry.clearAll();
});

test('replay bytes are bounded for distinct items and oversized events are live only', () => {
  chatRunRegistry.clearAll();
  const run = chatRunRegistry.startRun({appSessionId: 'memory-bytes', provider: 'codex', providerSessionId: null, connection: null, userId: null})!;
  for (let i = 0; i < 50; i++) run.writer.send({id: `item-${i}`, kind: 'text', provider: 'codex', content: 'x'.repeat(256 * 1024), turnId: 'owned-turn'});
  assert.ok(run.bufferedBytes <= 8 * 1024 * 1024);
  assert.ok(run.replayDroppedThroughSeq > 0);
  assert.ok(run.turnIds.has('owned-turn'), 'ownership survives truncated replay');
  assert.equal(run.events.at(-1)?.id, 'item-49');
  const tab = new FakeConnection();
  chatRunRegistry.attachConnection(run.appSessionId, tab);
  run.writer.send({id: 'oversized', kind: 'text', provider: 'codex', content: 'x'.repeat(5 * 1024 * 1024)});
  assert.equal(tab.frames.at(-1)?.id, 'oversized', 'live content must not be truncated');
  assert.equal(run.bufferedBytes, 0);
  assert.equal(run.replayDroppedThroughSeq, run.lastSeq);
  chatRunRegistry.clearAll();
});

test('the shared replay budget bounds many active sessions without ending their runs', () => {
  chatRunRegistry.clearAll();
  const all = Array.from({length: 16}, (_, i) => chatRunRegistry.startRun({appSessionId: `global-memory-${i}`, provider: 'codex', providerSessionId: null, connection: null, userId: null})!);
  for (const run of all) for (let i = 0; i < 5; i++) run.writer.send({id: `item-${i}`, kind: 'text', provider: 'codex', content: 'x'.repeat(512 * 1024)});
  assert.ok(all.reduce((sum, run) => sum + run.bufferedBytes, 0) <= 64 * 1024 * 1024);
  assert.ok(all.some(run => run.replayDroppedThroughSeq > 0));
  assert.ok(all.every(run => run.status === 'running'));
  chatRunRegistry.clearAll();
});

test('deltas are not coalesced and replaced runs release replay, audience and retention timers', () => {
  chatRunRegistry.clearAll();
  const tab = new FakeConnection();
  const input = {appSessionId: 'memory-replace', provider: 'claude' as const, providerSessionId: null, connection: tab, userId: null};
  const first = chatRunRegistry.startRun(input)!;
  for (let i = 0; i < 3; i++) first.writer.send({id: 'delta', kind: 'stream_delta', provider: 'claude', content: String(i)});
  assert.equal(first.events.length, 3);
  first.writer.sendComplete({exitCode: 0});
  assert.ok(first.evictionTimer);
  const second = chatRunRegistry.startRun({...input, connection: null})!;
  assert.equal(first.evictionTimer, null);
  assert.equal(first.bufferedBytes, 0);
  assert.equal(first.events.length, 0);
  second.writer.send({kind: 'status', provider: 'claude', text: 'hello'});
  assert.equal(tab.frames.at(-1)?.text, 'hello');
  chatRunRegistry.detachConnection(tab);
  const before = tab.frames.length;
  second.writer.send({kind: 'status', provider: 'claude', text: 'detached'});
  assert.equal(tab.frames.length, before);
  chatRunRegistry.clearAll();
});


test('a stalled browser cannot accumulate an unbounded websocket send queue', () => {
  chatRunRegistry.clearAll();
  let terminated = false;
  const stalled = {readyState: 1, bufferedAmount: 9 * 1024 * 1024, send() { throw new Error('must not queue'); }, terminate() { terminated = true; }};
  const healthy = new FakeConnection();
  const run = chatRunRegistry.startRun({appSessionId: 'slow-browser', provider: 'codex', providerSessionId: null, connection: stalled, userId: null})!;
  chatRunRegistry.attachConnection(run.appSessionId, healthy);
  run.writer.send({id: 'message', kind: 'text', provider: 'codex', content: 'still generating'});
  assert.equal(terminated, true);
  assert.equal(healthy.frames.length, 1);
  assert.equal(run.status, 'running');
  assert.equal(chatRunRegistry.replayEvents(run.appSessionId, 0).length, 1);
  chatRunRegistry.clearAll();
});

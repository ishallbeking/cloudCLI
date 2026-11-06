import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { createCodexApprovalService } from '../services/codex-approval.service.js';

class Rpc extends EventEmitter {
  sent: any[] = []; calls: any[] = []; closed = false;
  async initialize() {}
  async call(method: string, params: any) { this.calls.push([method, params]); }
  send(message: any) { this.sent.push(message); }
  close() { this.closed = true; this.emit('closed'); }
  request(id: string | number = 7, threadId = 'native-1', turnId = 'turn-1', method = 'item/commandExecution/requestApproval') {
    this.emit('message', {id, method, params: {threadId, turnId, command: 'pwd', reason: '只读审核原因', cwd: '/tmp'}});
  }
}
const socket = () => ({readyState: 1, frames: [] as any[], send(text: string) {this.frames.push(JSON.parse(text));}});
function fixture() {
  const rpcs: Rpc[] = []; let local = false;
  const service = createCodexApprovalService({createRpc: () => {const rpc = new Rpc(); rpcs.push(rpc); return rpc;},
    getSession: id => ({provider: 'codex', provider_session_id: id === 'app-2' ? 'native-2' : 'native-1'}), isLocallyOwned: () => local});
  return {rpcs, service, setLocal: (value: boolean) => {local = value;}};
}
test('terminal approvals use stable app session id, reason and snapshot; watching sends no decisions', async () => {
  const {service, rpcs} = fixture(), tab = socket();
  await service.watchSession('app-1', tab);
  assert.deepEqual(rpcs[0].calls, [['thread/resume', {threadId: 'native-1', excludeTurns: true}]]);
  rpcs[0].request();rpcs[0].request();
  assert.equal(tab.frames.length, 1);assert.equal(tab.frames[0].sessionId, 'app-1');assert.equal(tab.frames[0].input.reason, '只读审核原因');
  assert.equal(service.listPending('app-1').length, 1);assert.deepEqual(rpcs[0].sent, []);
  service.unwatchConnection(tab);assert.equal(rpcs[0].closed, true);
});
test('browser decision uses exact native request id once and waits for native confirmation', async () => {
  const {service, rpcs} = fixture(), tab = socket();await service.watchSession('app-1', tab);rpcs[0].request('native-request');
  const id = service.listPending('app-1')[0].requestId;
  assert.equal(service.resolve(id, {allow: true}), true);service.resolve(id, {allow: false});
  assert.deepEqual(rpcs[0].sent, [{jsonrpc: '2.0', id: 'native-request', result: {decision: 'accept'}}]);
  assert.equal(service.listPending('app-1').length, 1);
  rpcs[0].emit('message', {method: 'serverRequest/resolved', params: {threadId: 'native-1', requestId: 'native-request'}});
  assert.deepEqual(service.listPending('app-1'), []);assert.equal(tab.frames.at(-1).kind, 'permission_resolved');
  service.unwatchConnection(tab);
});
test('terminal decision retracts cards in all browsers without sending another decision', async () => {
  const {service, rpcs} = fixture(), a = socket(), b = socket();await service.watchSession('app-1', a);await service.watchSession('app-1', b);
  rpcs[0].request();rpcs[0].emit('message', {method: 'serverRequest/resolved', params: {threadId: 'native-1', requestId: 7}});
  assert.equal(a.frames.at(-1).kind, 'permission_resolved');assert.equal(b.frames.at(-1).kind, 'permission_resolved');assert.deepEqual(rpcs[0].sent, []);
  service.unwatchConnection(a);assert.equal(rpcs[0].closed, false);service.unwatchConnection(b);assert.equal(rpcs[0].closed, true);
});
test('local browser runtime and other threads are not duplicated or answered', async () => {
  const f = fixture(), tab = socket();await f.service.watchSession('app-1', tab);f.setLocal(true);f.rpcs[0].request();f.setLocal(false);
  f.rpcs[0].request(8, 'native-2');f.rpcs[0].request(9, 'native-1', 'turn-1', 'item/tool/call');
  assert.deepEqual(tab.frames, []);assert.deepEqual(f.rpcs[0].sent, []);f.service.unwatchConnection(tab);
});
test('request ids cannot cross sessions and completion only cancels its own turn', async () => {
  const {service, rpcs} = fixture(), a = socket(), b = socket();await service.watchSession('app-1', a);await service.watchSession('app-2', b);
  rpcs[0].request();rpcs[0].request(8, 'native-1', 'turn-2');rpcs[1].request(7, 'native-2');
  assert.notEqual(service.listPending('app-1')[0].requestId, service.listPending('app-2')[0].requestId);
  rpcs[0].emit('message', {method: 'turn/completed', params: {threadId: 'native-1', turn: {id: 'turn-1'}}});
  assert.equal(service.listPending('app-1').length, 1);assert.equal(service.listPending('app-2').length, 1);
  service.resolve(service.listPending('app-2')[0].requestId, {allow: false});assert.deepEqual(rpcs[1].sent[0].result, {decision: 'decline'});assert.deepEqual(rpcs[0].sent, []);
  service.unwatchConnection(a);service.unwatchConnection(b);
});
test('disconnect cancels stale cards; refresh reconnects with the same approval identity', async () => {
  const {service, rpcs} = fixture(), a = socket();await service.watchSession('app-1', a);rpcs[0].request();const old = service.listPending('app-1')[0].requestId;
  rpcs[0].emit('closed');assert.equal(a.frames.at(-1).kind, 'permission_cancelled');assert.deepEqual(service.listPending('app-1'), []);
  service.unwatchConnection(a);const b = socket();await service.watchSession('app-1', b);rpcs[1].request();assert.equal(service.listPending('app-1')[0].requestId, old);
  service.unwatchConnection(b);
});

test('a different native turn on a locally active session still gets its own approval card', async () => {
  const rpc = new Rpc(), tab = socket();
  const service = createCodexApprovalService({createRpc: () => rpc,
    getSession: () => ({provider: 'codex', provider_session_id: 'native-1'}),
    isLocallyOwned: (_id, turnId) => turnId === 'local-turn'});
  await service.watchSession('app-1', tab);
  rpc.request(1, 'native-1', 'local-turn');rpc.request(2, 'native-1', 'external-turn');
  assert.equal(tab.frames.length, 1);assert.equal(service.listPending('app-1').length, 1);
  service.resolve(service.listPending('app-1')[0].requestId, {allow: false});assert.equal(rpc.sent[0].id, 2);
  service.unwatchConnection(tab);
});

test('default ownership guard checks the active turn rather than just a busy session', async () => {
  const rpc = new Rpc(), tab = socket();
  const run = chatRunRegistry.startRun({appSessionId: 'native-ownership-unit', provider: 'codex', providerSessionId: 'native-1', connection: tab, userId: 1});
  assert.ok(run);run.events.push({turnId: 'local-turn'} as never);
  const service = createCodexApprovalService({createRpc: () => rpc, getSession: () => ({provider: 'codex', provider_session_id: 'native-1'})});
  try {
    await service.watchSession('native-ownership-unit', tab);
    rpc.request(1, 'native-1', 'local-turn');rpc.request(2, 'native-1', 'external-turn');
    assert.equal(tab.frames.length, 1);assert.equal(service.listPending('native-ownership-unit').length, 1);
  } finally {service.unwatchConnection(tab);chatRunRegistry.clearAll();}
});

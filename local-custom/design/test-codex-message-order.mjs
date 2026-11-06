import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudcliMergeCodexMessages as merge,cloudcliCodexPending as pending,cloudcliCodexUpsert as upsert,cloudcliAcceptRunEvent as accept,cloudcliRunCursor as cursor} from '../patches/codex-message-order.js';
const message=(id,role,seconds,extra={})=>({id,role,provider:'codex',kind:'text',sessionId:'test',timestamp:new Date(1793870557000+seconds*1000).toISOString(),content:'ok',...extra});
test('client clocks ahead or behind cannot reorder optimistic user messages and repeated ok replies',()=>{
 for(const skew of [433,-433,360000]){
  const history=[message('old-user','user',0),message('old-assistant','assistant',1)];
  const slot={merged:history,realtimeMessages:[]};slot.realtimeMessages=upsert(slot,message('local_new','user',skew));
  const ack=message('new-user','user',2,{clientMessageId:'local_new',turnId:'new-turn'}),reply=message('new-assistant','assistant',3,{turnId:'new-turn'});
  assert.deepEqual(merge(history,slot.realtimeMessages).map(m=>m.id),['old-user','old-assistant','local_new']);
  assert.deepEqual(merge(history,[...slot.realtimeMessages,ack,reply]).map(m=>m.id),['old-user','old-assistant','new-user','new-assistant']);
  assert.deepEqual(merge([...history,ack,reply],[...slot.realtimeMessages,ack,reply]).map(m=>m.id),['old-user','old-assistant','new-user','new-assistant']);
 }
});
test('stream revisions upsert by item id without moving timestamp; repeated content in other turns survives',()=>{
 const slot={merged:[],realtimeMessages:[]};slot.realtimeMessages=upsert(slot,message('a','assistant',0,{content:'part',isStreaming:true}));
 slot.realtimeMessages=upsert(slot,message('a','assistant',10,{content:'complete',isStreaming:false}));
 assert.equal(slot.realtimeMessages.length,1);assert.equal(slot.realtimeMessages[0].timestamp,message('a','assistant',0).timestamp);
 const server=[message('a','assistant',11,{content:'complete'})];assert.deepEqual(pending(server,slot.realtimeMessages),[]);
 assert.equal(merge(server,[message('b','assistant',12,{content:'complete'})]).length,2);
});
test('historical question answers keep their actual new turn and never attach to the old question',()=>{
 const server=[message('question','assistant',0),message('u-current','user',10),message('a-current','assistant',11)];
 const answer=message('answer-old-question','user',12,{clientMessageId:'cloudcli-question:old-call',turnId:'answer-turn'});
 const reply=message('a-answer','assistant',13,{turnId:'answer-turn',parentUserMessageId:answer.id});
 assert.deepEqual(merge(server,[answer,reply]).map(m=>m.id),['question','u-current','a-current','answer-old-question','a-answer']);
});
test('reconnect drops duplicate sequences and old runs while accepting a new run with reset seq',()=>{
 const event={sessionId:'replay-test',runId:'run-1',runStartedAt:10,seq:8};assert.equal(accept(event),true);assert.equal(accept(event),false);
 assert.equal(accept({...event,runId:'run-2',runStartedAt:20,seq:1}),true);
 assert.equal(accept({...event,seq:9}),false);
 assert.equal(accept({...event,runId:'run-2',runStartedAt:20,seq:2}),true);
 assert.deepEqual(cursor('replay-test',1000),{runId:'run-2',lastSeq:2});
 assert.equal(accept({sessionId:'replay-test',kind:'chat_subscribed',runId:'run-3',runStartedAt:30}),true);
 assert.deepEqual(cursor('replay-test',1000),{runId:'run-3',lastSeq:0});
});

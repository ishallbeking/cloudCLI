import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudcliStopControl} from '../patches/stop-control-state.js';
function fixture(){
 const timers=new Map();let next=0;
 const control=createCloudcliStopControl({setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 return {control,timers};
}
test('disconnected stop reports non-delivery and is never replayed on reconnect',()=>{
 const {control,timers}=fixture();const sent=[];
 control.request('a','run-a',msg=>{sent.push(msg);return false;});
 assert.equal(control.get('a').phase,'error');assert.match(control.get('a').text,/未发出/);assert.equal(timers.size,0);
 control.observe({kind:'chat_subscribed',sessionId:'a',runId:'run-a',isProcessing:true});assert.equal(sent.length,1);
 control.observe({kind:'chat_subscribed',sessionId:'a',runId:'run-b',isProcessing:true});assert.equal(control.get('a'),null);assert.equal(sent.length,1);
});
test('duplicate clicks send once and only this run completion clears pending state',()=>{
 const {control,timers}=fixture();const sent=[];const send=msg=>{sent.push(msg);return true;};
 control.request('a','run-a',send);control.request('a','run-a',send);
 assert.deepEqual(sent,[{type:'chat.abort',sessionId:'a'}]);assert.equal(control.get('a').phase,'pending');
 control.observe({kind:'complete',sessionId:'b',runId:'run-a'});control.observe({kind:'complete',sessionId:'a',runId:'old'});
 assert.equal(control.get('a').phase,'pending');control.observe({kind:'complete',sessionId:'a',runId:'run-a'});
 assert.equal(control.get('a'),null);assert.equal(timers.size,0);
});
test('missing confirmation becomes an error, and an explicit retry can send again',()=>{
 const {control,timers}=fixture();let count=0;const send=()=>{count++;return true;};
 control.request('a','run-a',send);[...timers.values()][0]();assert.equal(control.get('a').phase,'error');
 control.request('a','run-a',send);assert.equal(count,2);assert.equal(control.get('a').phase,'pending');
 control.observe({kind:'chat_subscribed',sessionId:'a',runId:'run-a',isProcessing:false});assert.equal(control.get('a'),null);
});
test('transport exceptions and server failures remain visible without claiming completion',()=>{
 const {control}=fixture();control.request('a','run-a',()=>{throw Error('socket closed');});assert.match(control.get('a').text,/未发出/);
 control.request('a','run-a',()=>true);control.observe({kind:'protocol_error',sessionId:'a',error:'Interrupt failed'});
 assert.equal(control.get('a').phase,'error');assert.equal(control.get('a').text,'Interrupt failed');
});
test('non-interruptible activity explains where to stop and notifies the UI',()=>{
 const {control}=fixture();let changes=0;const unsubscribe=control.subscribe(()=>changes++);
 control.unavailable('a');assert.match(control.get('a').text,/终端或客户端停止/);assert.equal(changes,1);
 unsubscribe();control.unavailable('b');assert.equal(changes,1);
});

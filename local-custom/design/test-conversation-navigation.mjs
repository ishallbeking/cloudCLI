import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {buildConversationOutline,conversationWindow,navigationExcerpt} from '../package/server/modules/providers/services/conversation-navigation.js';
const user=(id,turnId)=>({id,turnId,kind:'text',role:'user',content:'问题 '+id,timestamp:'2026-11-05T00:00:00Z'});
const answer=(id,parentUserMessageId,content,turnId)=>({id,parentUserMessageId,turnId,kind:'text',role:'assistant',content});
test('outline keeps native IDs and associates delayed replies by parent and turn, without timestamps',()=>{
 const rows=[user('u1','t1'),user('u2','t2'),answer('a1','u1','旧问题的延迟回答'),answer('a2',undefined,'第二个问题','t2'),answer('orphan','missing','不能错误绑定'),{id:'tool',kind:'tool_use'},answer('final','u2','第二个问题的最终回复')];
 const result=buildConversationOutline(rows);
 assert.deepEqual(result.map(e=>e.id),['u1','u2']);
 assert.equal(result[0].answer,'旧问题的延迟回答'); assert.equal(result[1].answer,'第二个问题的最终回复');
 assert.deepEqual(result[0].rowIds,['u1','a1']); assert.ok(!result.flatMap(e=>e.rowIds).includes('orphan'));
});
test('unannotated Claude history falls back to transcript order and ignores nested agents',()=>{
 const rows=[user('c1'),answer('ca1',undefined,'回答'),{...user('nested'),parentToolUseId:'tool'},user('c2'),answer('ca2',undefined,'另一个回答')];
 const result=buildConversationOutline(rows);assert.deepEqual(result.map(e=>e.id),['c1','c2']);assert.equal(result[0].answer,'回答');
});
test('historical question replies produce readable previews, multiquestion and free-text included',()=>{
 const text='<send_user_message_question_reply>'+JSON.stringify([{question:'颜色',answer:'红色'},{question:'备注',answer:'自由回答'}])+'</send_user_message_question_reply>';
 assert.equal(navigationExcerpt({content:text}),'颜色：红色；备注：自由回答');
 assert.equal(navigationExcerpt({content:'',images:[{}]}),'[图片]');
 assert.ok(navigationExcerpt({content:'a'.repeat(1000)}).length<=221);
});
test('windows use IDs despite identical timestamps and remain bounded at both edges',()=>{
 const rows=Array.from({length:8231},(_,i)=>user('u'+i));
 for(const id of ['u0','u4100','u8230']) {const result=conversationWindow(rows,id);assert.ok(result.messages.some(m=>m.id===id));assert.ok(result.messages.length<=120);}
 assert.equal(conversationWindow(rows,'u0').hasBefore,false);
 assert.equal(conversationWindow(rows,'u8230').hasAfter,false);
 assert.equal(conversationWindow(rows,'u4100','before').lastId,'u4100');
 assert.equal(conversationWindow(rows,'u4100','after').firstId,'u4100');
 assert.equal(conversationWindow(rows,'missing'),null);
 // Appending new turns never shifts an existing anchor to the wrong message.
 assert.deepEqual(conversationWindow([...rows,user('new')],'u4100').messages,conversationWindow(rows,'u4100').messages);
});

test('live client preview also associates late answers with their original question',async()=>{
 const scope={};vm.runInNewContext(await fs.readFile(new URL('../patches/conversation-navigation-client.js',import.meta.url),'utf8'),scope);
 const result=scope.cloudcliLocalNavigationEntries([
  {id:'u1',type:'user',content:'旧问题',turnId:'t1'}, {id:'u2',type:'user',content:'新问题',turnId:'t2'},
  {id:'a1',type:'assistant',content:'延迟到达的旧答案',parentUserMessageId:'u1'},
  {id:'a2',type:'assistant',content:'新答案',turnId:'t2'},
  {id:'orphan',type:'assistant',content:'不能覆盖新答案',parentUserMessageId:'unloaded-old-question'},
 ]);
 assert.equal(result[0].answer,'延迟到达的旧答案');assert.equal(result[1].answer,'新答案');
 assert.ok(!result[1].rowIds.includes('a1'));
});

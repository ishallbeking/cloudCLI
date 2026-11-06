// @ts-nocheck -- Executable JavaScript compatibility tests for the binary distribution.
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {writeFile, appendFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const temp=mkdtempSync(path.join(os.tmpdir(),'cloudcli-questions-test-'));
const previousDatabasePath=process.env.DATABASE_PATH;
process.env.DATABASE_PATH=path.join(temp,'auth.db');
const {createQuestionState, consumeQuestionRecord, questionRequests, buildQuestionReply, listCodexQuestions}
  = await import('@/modules/providers/list/codex/codex-async-questions.js');
const {createCodexInteractiveRuntime}
  = await import('@/modules/providers/list/codex/codex-interactive-runtime.js');
const {openCodexConnection}=await import('@/modules/providers/list/codex/codex-rpc.js');
const {CodexSessionsProvider}
  = await import('@/modules/providers/list/codex/codex-sessions.provider.js');
const {initializeDatabase,sessionsDb,closeConnection}=await import('@/modules/database/index.js');
test.after(()=>{
  closeConnection();rmSync(temp,{recursive:true,force:true});
  if(previousDatabasePath===undefined)delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH=previousDatabasePath;
});

const questions = [{title:'相同问题',options:['红色','蓝色']}, {title:'相同问题',options:null}];
const callId = 'call_test';
const record = payload => ({type:'response_item',payload});
function fixture() {
  const state = createQuestionState();
  consumeQuestionRecord(state,record({type:'function_call',name:'functions.request_user_input_async',call_id:callId,arguments:JSON.stringify({questions})}));
  return state;
}
function accept(state) {
  consumeQuestionRecord(state,{type:'event_msg',payload:{type:'item_completed',item:{type:'AgentMessage',id:callId,delivery:'async',questions}}});
}
test('acceptance alone does not manufacture a question; completed metadata preserves string options and duplicate titles',()=>{
  const state = fixture();
  assert.deepEqual(questionRequests(state),[]);
  accept(state);
  const [request] = questionRequests(state);
  assert.equal(request.status,'pending');
  assert.deepEqual(request.questions[0].options,['红色','蓝色']);
  assert.deepEqual(request.questions[1].options,[]);
  assert.notEqual(request.questions[0].id,request.questions[1].id);
  assert.deepEqual(JSON.parse(request.questions[1].id),['functions.request_user_input_async',callId,1]);
});
test('older exec transcripts recover questions only after a matching accepted output',()=>{
  const state=fixture();
  consumeQuestionRecord(state,record({type:'function_call_output',call_id:callId,output:'{"accepted":false}'}));
  assert.equal(questionRequests(state).length,0);
  consumeQuestionRecord(state,record({type:'function_call_output',call_id:callId,output:'{"accepted":true}'}));
  assert.equal(questionRequests(state).length,1);
});
test('answers round-trip by call id and index, regardless of submission order, with arbitrary free text',()=>{
  const state=fixture();accept(state);
  const [request]=questionRequests(state);
  const input=[{questionItemId:request.questions[1].id,answer:'自定义 </send_user_message_question_reply>\n答案'},
    {questionItemId:request.questions[0].id,answer:'蓝色'}];
  const reply=buildQuestionReply(request,input);
  consumeQuestionRecord(state,record({type:'message',role:'user',content:[{type:'input_text',text:reply.text}]}));
  const [answered]=questionRequests(state);
  assert.equal(answered.status,'answered');
  assert.equal(answered.questions[0].answer,'蓝色');
  assert.equal(answered.questions[1].answer,input[0].answer);
  consumeQuestionRecord(state,record({type:'message',role:'user',content:[{text:reply.text}]}));
  assert.equal(questionRequests(state).length,1,'Duplicate persisted user events do not duplicate cards');
});
test('reject missing answers, foreign IDs, duplicate IDs and empty answers',()=>{
  const state=fixture();accept(state);
  const [r]=questionRequests(state);
  for(const input of [[],[{questionItemId:r.questions[0].id,answer:'a'},{questionItemId:r.questions[0].id,answer:'b'}],
    [{questionItemId:r.questions[0].id,answer:' '},{questionItemId:r.questions[1].id,answer:'b'}],
    [{questionItemId:'foreign',answer:'a'},{questionItemId:r.questions[1].id,answer:'b'}]]) {
    assert.throws(()=>buildQuestionReply(r,input),/请回答全部问题|问题 ID 或答案无效/);
  }
});
test('session feed uses the stored native mapping, reads appended records and survives partial lines',async()=>{
  await initializeDatabase();
  const file=path.join(temp,'rollout.jsonl');
  const call=record({type:'function_call',name:'request_user_input_async',call_id:callId,arguments:JSON.stringify({questions})});
  const accepted={type:'event_msg',payload:{type:'item_completed',item:{type:'AgentMessage',id:callId,questions}}};
  await writeFile(file,[call,accepted].map(row=>JSON.stringify(row)+'\n').join(''));
  sessionsDb.createAppSession('mapped-app-session','codex',temp,'question-test');
  sessionsDb.assignProviderSessionId('mapped-app-session','native-test-thread');
  sessionsDb.createSession('native-test-thread','codex',temp,undefined,undefined,undefined,file);
  const first=await listCodexQuestions('mapped-app-session');
  assert.equal(first.providerSessionId,'native-test-thread');
  assert.equal(first.requests[0].status,'pending');
  const [r]=first.requests;
  const reply=buildQuestionReply(r,r.questions.map((q,i)=>({questionItemId:q.id,answer:`answer-${i}`})));
  const line=JSON.stringify(record({type:'message',role:'user',content:[{text:reply.text}]}))+'\n';
  const half=Math.floor(line.length/2);
  await appendFile(file,line.slice(0,half));
  assert.equal((await listCodexQuestions('mapped-app-session')).requests[0].status,'pending');
  await appendFile(file,line.slice(half));
  const [a,b]=await Promise.all([listCodexQuestions('mapped-app-session'),listCodexQuestions('mapped-app-session')]);
  assert.equal(a.requests[0].status,'answered');
  assert.deepEqual(b.requests[0].questions.map(q=>q.answer),['answer-0','answer-1']);
  assert.notEqual(first.revision,a.revision);
});

class FakeRpc extends EventEmitter {
  calls=[]; sent=[]; threadId='native-thread'; turnId='test-turn'; autoComplete=true;
  async call(method,params) {
    this.calls.push({method,params});
    if(method==='thread/start'||method==='thread/resume')return {thread:{id:this.threadId}};
    if(method==='turn/start') {
      if(this.autoComplete)setImmediate(()=>{
        this.emit('message',{method:'item/completed',params:{threadId:this.threadId,item:{type:'agentMessage',id:callId,text:'问题',questions}}});
        this.emit('message',{method:'turn/completed',params:{threadId:this.threadId,turn:{id:this.turnId,status:'completed'}}});
      });
      return {turn:{id:this.turnId}};
    }
    if(method==='turn/interrupt')setImmediate(()=>this.emit('message',{method:'turn/completed',params:{threadId:this.threadId,turn:{id:this.turnId,status:'interrupted'}}}));
    return {};
  }
  send(message){this.sent.push(message);}
}
function runtimeFixture(resumed=false) {
  const rpc=new FakeRpc();
  const runtime=createCodexInteractiveRuntime(async()=>rpc);
  const messages=[];
  const provider=new CodexSessionsProvider();
  const context={resolveProviderSessionId:()=>resumed?rpc.threadId:null,resolveResumeModel:async()=> 'test-model',
    getProviderModels:async()=>({OPTIONS:[{value:'test-model',effort:{values:[{value:'high'}]}}]}),
    normalizeMessage:(raw,id)=>provider.normalizeMessage(raw,id),isProviderInstalled:async()=>true};
  const writer={isWebSocketWriter:true,send:m=>messages.push(m),setSessionId:id=>messages.push({kind:'mapped',id})};
  return {rpc,runtime,messages,context,writer};
}
for(const resumed of [false,true]) for(const mode of ['default','approveForMe','acceptEdits','bypassPermissions']) {
  test(`bidirectional runtime ${resumed?'attaches':'starts'} with ${mode} and forwards structured metadata`,async()=>{
    const {rpc,runtime,messages,context,writer}=runtimeFixture(resumed);
    await runtime.run('hello',{sessionId:'app-test',cwd:'/tmp',permissionMode:mode,effort:'high'},writer,context);
    const setup=rpc.calls[0];
    assert.equal(setup.method,resumed?'thread/resume':'thread/start');
    if(resumed) {assert.equal(setup.params.threadId,'native-thread');assert.equal(setup.params.excludeTurns,true);}
    assert.equal(setup.params.sandbox,mode==='bypassPermissions'?'danger-full-access':'workspace-write');
    assert.equal(setup.params.approvalPolicy,['default','approveForMe'].includes(mode)?'on-request':'never');
    assert.equal(setup.params.approvalsReviewer,mode==='approveForMe'?'auto_review':'user');
    assert.equal(rpc.calls[1].params.approvalsReviewer,setup.params.approvalsReviewer);
    assert.equal(rpc.calls[1].params.approvalPolicy,setup.params.approvalPolicy);
    assert.equal(rpc.calls[1].params.effort,'high');
    assert.deepEqual(rpc.calls[1].params.input,[{type:'text',text:'hello'}]);
    assert.equal(messages.filter(m=>m.kind==='complete').length,1);
    assert.equal(messages.find(m=>m.codexQuestions)?.codexQuestions.requestId,callId);
    assert.equal(messages.find(m=>m.codexQuestions)?.id,callId);
    assert.equal(rpc.listenerCount('message'),0);
  });
}
test('runtime preserves attachments and supplies image-only prompt',async()=>{
  const {rpc,runtime,context,writer}=runtimeFixture();
  await runtime.run('',{sessionId:'app-test',cwd:'/tmp',images:[{path:'/tmp/ui-test.png'}]},writer,context);
  assert.deepEqual(rpc.calls[1].params.input,[{type:'text',text:'Please analyze the attached image(s).'}, {type:'localImage',path:'/tmp/ui-test.png'}]);
});
test('new browser threads explicitly use the current catalog default instead of stale daemon startup defaults',async()=>{
  const {rpc,runtime,context,writer}=runtimeFixture();
  context.resolveResumeModel=async()=>undefined;
  context.getProviderModels=async()=>({DEFAULT:'current-cli-model',OPTIONS:[]});
  await runtime.run('hello',{sessionId:'app-test'},writer,context);
  assert.equal(rpc.calls[0].params.model,'current-cli-model');
  assert.equal(rpc.calls[1].params.model,'current-cli-model');
});
test('reuse existing daemon; only a missing socket invokes the idempotent daemon start command',async()=>{
  let starts=0,creates=0,closes=0;
  const connected={initialize:async function(){return this;},close:()=>closes++};
  await openCodexConnection({createRpc:()=>connected,startDaemon:async()=>starts++});
  assert.equal(starts,0);assert.equal(closes,0);
  const absent={initialize:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});},close:()=>closes++};
  assert.equal(await openCodexConnection({createRpc:()=>creates++?connected:absent,startDaemon:async()=>starts++}),connected);
  assert.equal(starts,1);assert.equal(closes,1);
  const denied={initialize:async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});},close:()=>closes++};
  await assert.rejects(openCodexConnection({createRpc:()=>denied,startDaemon:async()=>starts++}),/denied/);
  assert.equal(starts,1,'Permission/configuration failures must not spawn another daemon');
});
test('approval is interactive and can be replayed after refresh; it never silently grants permission',async()=>{
  const {rpc,runtime,messages,context,writer}=runtimeFixture();rpc.autoComplete=false;
  const running=runtime.run('test',{sessionId:'app-test'},writer,context);
  await new Promise(resolve=>setImmediate(resolve));
  rpc.emit('message',{id:99,method:'item/commandExecution/requestApproval',params:{threadId:rpc.threadId,turnId:rpc.turnId,command:'test command'}});
  const request=messages.find(m=>m.kind==='permission_request');
  assert.ok(request);
  assert.equal(rpc.sent.length,0);
  assert.equal(runtime.permissions.listPending('app-test')[0].requestId,request.requestId);
  runtime.permissions.resolve(request.requestId,{allow:false});
  assert.deepEqual(rpc.sent[0],{jsonrpc:'2.0',id:99,result:{decision:'decline'}});
  assert.equal(runtime.permissions.listPending('app-test').length,0);
  await runtime.abort('app-test');await running;
  assert.equal(messages.filter(m=>m.kind==='complete').length,0,'Gateway owns aborted completion');
});
test('RPC failure leaves one visible failure completion',async()=>{
  const {rpc,runtime,messages,context,writer}=runtimeFixture();
  rpc.call=async()=>{throw new Error('offline test');};
  await runtime.run('hello',{sessionId:'app-test'},writer,context);
  assert.equal(messages.filter(m=>m.kind==='error')[0].content,'offline test');
  assert.equal(messages.filter(m=>m.kind==='complete').length,1);
  assert.equal(messages.find(m=>m.kind==='complete').exitCode,1);
});
test('only the matching turn can finish a run, including notifications that precede the turn/start acknowledgement',async()=>{
  const {rpc,runtime,messages,context,writer}=runtimeFixture();
  const original=rpc.call.bind(rpc);
  rpc.call=async(method,params)=>{
    if(method==='turn/start') {
      rpc.emit('message',{method:'turn/completed',params:{threadId:rpc.threadId,turn:{id:'previous-turn',status:'failed',error:{message:'wrong turn'}}}});
      rpc.emit('message',{method:'turn/completed',params:{threadId:rpc.threadId,turn:{id:rpc.turnId,status:'completed'}}});
      return {turn:{id:rpc.turnId}};
    }
    return original(method,params);
  };
  await runtime.run('test',{sessionId:'app-test'},writer,context);
  assert.equal(messages.find(m=>m.kind==='complete').exitCode,0);
  assert.equal(messages.filter(m=>m.kind==='error').length,0);
});
test('command progress reaches the same tool row and a streamed failure is shown once',async()=>{
  const {rpc,runtime,messages,context,writer}=runtimeFixture();rpc.autoComplete=false;
  const running=runtime.run('test',{sessionId:'app-test'},writer,context);
  await new Promise(r=>setImmediate(r));
  rpc.emit('message',{method:'item/started',params:{threadId:rpc.threadId,item:{id:'command-test',type:'commandExecution',command:'test',status:'inProgress',aggregatedOutput:''}}});
  rpc.emit('message',{method:'item/commandExecution/outputDelta',params:{threadId:rpc.threadId,itemId:'command-test',delta:'progress'}});
  assert.ok(messages.some(m=>m.kind==='tool_result'&&m.toolId==='command-test'&&m.content==='progress'));
  rpc.emit('message',{method:'error',params:{threadId:rpc.threadId,willRetry:false,error:{message:'model failed'}}});
  rpc.emit('message',{method:'turn/completed',params:{threadId:rpc.threadId,turn:{id:rpc.turnId,status:'failed',error:{message:'model failed'}}}});
  await running;
  assert.equal(messages.filter(m=>m.kind==='error').length,1);
  assert.equal(messages.find(m=>m.kind==='complete').exitCode,1);
});

test('native user acknowledgement carries the stable client id and the provider turn id',async()=>{
  const {rpc,runtime,messages,context,writer}=runtimeFixture();rpc.autoComplete=false;
  const task=runtime.run('hello',{sessionId:'stable-app',clientMessageId:'local_stable'},writer,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rpc.calls.find(c=>c.method==='turn/start').params.clientUserMessageId,'local_stable');
  rpc.emit('message',{method:'item/completed',params:{threadId:rpc.threadId,turnId:rpc.turnId,
    item:{id:'native-user',type:'userMessage',clientId:'local_stable',content:[{type:'text',text:'hello'}]}}});
  const ack=messages.find(m=>m.role==='user');
  assert.equal(ack.id,'native-user');assert.equal(ack.clientMessageId,'local_stable');assert.equal(ack.turnId,rpc.turnId);
  rpc.emit('message',{method:'turn/completed',params:{threadId:rpc.threadId,turn:{id:rpc.turnId,status:'completed'}}});await task;
});
test('history-answer turns cannot write into another run; streaming keeps item identity and its original position',async()=>{
  const {rpc,runtime,messages,context,writer}=runtimeFixture();rpc.autoComplete=false;
  const task=runtime.run('hello',{sessionId:'stable-app'},writer,context);await new Promise(resolve=>setImmediate(resolve));
  rpc.emit('message',{method:'item/completed',params:{threadId:rpc.threadId,turnId:'delayed-question-turn',
    item:{id:'wrong-reply',type:'agentMessage',text:'reply to an old question'}}});
  assert.ok(!messages.some(m=>m.id==='wrong-reply'));
  for(const delta of ['first ','second'])rpc.emit('message',{method:'item/agentMessage/delta',params:{threadId:rpc.threadId,turnId:rpc.turnId,itemId:'stable-reply',delta}});
  rpc.emit('message',{method:'item/completed',params:{threadId:rpc.threadId,turnId:rpc.turnId,item:{id:'stable-reply',type:'agentMessage',text:'first second'}}});
  const updates=messages.filter(m=>m.id==='stable-reply');assert.equal(updates.length,3);
  assert.equal(updates[1].content,'first second');assert.equal(updates[1].isStreaming,true);
  assert.equal(updates[2].isStreaming,false);assert.equal(new Set(updates.map(m=>m.timestamp)).size,1);
  rpc.emit('message',{method:'turn/completed',params:{threadId:rpc.threadId,turn:{id:rpc.turnId,status:'completed'}}});await task;
});
test('reloads preserve native message ids and client reply correlation, including equal text on different turns',async()=>{
  await initializeDatabase();const file=path.join(temp,'stable-rollout.jsonl');
  const rows=[
    {timestamp:'2026-11-05T09:22:37Z',type:'event_msg',payload:{type:'task_started',turn_id:'turn-a'}},
    {timestamp:'2026-11-05T09:22:38Z',type:'event_msg',payload:{type:'item_completed',turn_id:'turn-a',item:{type:'UserMessage',id:'u-a',client_id:'local-a',content:[{type:'text',text:'ok'}]}}},
    {timestamp:'2026-11-05T09:22:39Z',type:'response_item',payload:{type:'message',id:'a-a',role:'assistant',content:[{type:'output_text',text:'same answer'}]}},
    {timestamp:'2026-11-05T09:23:37Z',type:'event_msg',payload:{type:'task_started',turn_id:'turn-b'}},
    {timestamp:'2026-11-05T09:23:38Z',type:'event_msg',payload:{type:'item_completed',turn_id:'turn-b',item:{type:'UserMessage',id:'u-b',client_id:'local-b',content:[{type:'text',text:'ok'}]}}},
    {timestamp:'2026-11-05T09:23:39Z',type:'response_item',payload:{type:'message',id:'a-b',role:'assistant',content:[{type:'output_text',text:'same answer'}]}},
    {timestamp:'2026-11-05T09:23:40Z',type:'event_msg',payload:{type:'turn_aborted',turn_id:'turn-b',reason:'interrupted'}},
    {timestamp:'2026-11-05T09:23:41Z',type:'event_msg',payload:{type:'task_complete',turn_id:'turn-c',error:{message:'Explicit model failure'}}},
  ];
  await writeFile(file,rows.map(r=>JSON.stringify(r)+'\n').join(''));
  sessionsDb.createSession('stable-history','codex',temp,undefined,undefined,undefined,file);
  const provider=new CodexSessionsProvider();
  const first=await provider.fetchHistory('stable-history',{limit:null}),second=await provider.fetchHistory('stable-history',{limit:null});
  assert.deepEqual(first.messages.map(m=>m.id),second.messages.map(m=>m.id));
  const texts=first.messages.filter(m=>m.kind==='text');assert.deepEqual(texts.map(m=>m.id),['u-a','a-a','u-b','a-b']);
  assert.equal(texts[0].clientMessageId,'local-a');assert.equal(texts[1].turnId,'turn-a');assert.equal(texts[1].parentUserMessageId,'u-a');
  assert.equal(texts[3].parentUserMessageId,'u-b');assert.ok(first.messages.some(m=>m.id==='codex-turn:turn-b:interrupted'));
  assert.ok(first.messages.some(m=>m.id==='codex-turn:turn-c:error'&&m.kind==='error'&&m.content==='Explicit model failure'));
});

test('cancelled native turns produce an explicit cancellation notice and aborted completion',async()=>{
  const {rpc,runtime,messages,context,writer}=runtimeFixture();rpc.autoComplete=false;
  const task=runtime.run('hello',{sessionId:'cancelled-app'},writer,context);await new Promise(resolve=>setImmediate(resolve));
  rpc.emit('message',{method:'turn/completed',params:{threadId:rpc.threadId,turn:{id:rpc.turnId,status:'interrupted'}}});await task;
  assert.ok(messages.some(m=>m.id===`codex-turn:${rpc.turnId}:interrupted`&&m.summary==='Turn interrupted'));
  assert.equal(messages.find(m=>m.kind==='complete').aborted,true);
});

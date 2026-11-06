import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, mkdir, writeFile, readFile, appendFile, rm, stat} from 'node:fs/promises';
import {zstdCompressSync} from 'node:zlib';
const prefix='../package/dist-server/server/';
const {initializeDatabase,closeConnection,sessionsDb}=await import(prefix+'modules/database/index.js');
const {CodexSessionsProvider}=await import(prefix+'modules/providers/list/codex/codex-sessions.provider.js');
const {CodexSessionSynchronizer}=await import(prefix+'modules/providers/list/codex/codex-session-synchronizer.provider.js');
const {readCodexArtifactLines,readCodexSessionNames}=await import(prefix+'modules/providers/list/codex/codex-rollout-files.js');
const {searchConversations}=await import(prefix+'modules/providers/services/session-conversations-search.service.js');
const {listCodexQuestions}=await import(prefix+'modules/providers/list/codex/codex-async-questions.js');
const encode=rows=>rows.map(row=>JSON.stringify({timestamp:'2026-10-01T01:00:00Z',...row})).join('\n')+'\n';
function turn(id,text) {return [
 {type:'event_msg',payload:{type:'task_started',turn_id:id}},
 {type:'event_msg',payload:{type:'item_completed',turn_id:id,item:{type:'UserMessage',id:id+'-user',content:[{type:'input_text',text}]}}},
 {type:'response_item',payload:{type:'message',id:id+'-assistant',role:'assistant',content:[{type:'output_text',text:'answer '+text}]}},
 {type:'event_msg',payload:{type:'task_complete',turn_id:id}},
];}
async function fixture(run) {
 const root=await mkdtemp(path.join(os.tmpdir(),'cloudcli-zstd-history-'));
 const prevDb=process.env.DATABASE_PATH,prevHome=process.env.CODEX_HOME;
 closeConnection();process.env.DATABASE_PATH=path.join(root,'auth.db');process.env.CODEX_HOME=path.join(root,'.codex');
 await initializeDatabase();
 const directory=path.join(root,'.codex','sessions','2026','10','01');await mkdir(directory,{recursive:true});
 async function rollout(id,rows=turn(id+'-turn','原始中文 '+id),metadata={},compressed=true,archive=false) {
  const dir=archive?path.join(root,'.codex','archived_sessions'):directory;await mkdir(dir,{recursive:true});
  const file=path.join(dir,`rollout-${id}.jsonl${compressed?'.zst':''}`);
  const text=encode([{type:'session_meta',payload:{id,cwd:root,source:'cli',...metadata}},...rows]);
  await writeFile(file,compressed?zstdCompressSync(Buffer.from(text)):text);return {file,text};
 }
 try {await run({root,rollout,directory,sync:new CodexSessionSynchronizer()});}
 finally {closeConnection();if(prevDb===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=prevDb;if(prevHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=prevHome;await rm(root,{recursive:true,force:true});}
}
test('compressed old main sessions are discovered despite scan cursor; subagents and duplicate snapshots stay hidden',async()=>fixture(async({root,rollout,sync})=>{
 await rollout('old');await rollout('agent',[],{source:{subagent:{other:'guardian'}},thread_source:'subagent'});
 const live=await rollout('live',turn('live-turn','new live text'),{},false);await rollout('live',turn('stale-turn','stale text'));
 const archived=await rollout('archive',undefined,{},true,true);
 assert.equal(await sync.synchronize(new Date('2099-01-01')),3);
 assert.ok(sessionsDb.getSessionById('old').jsonl_path.endsWith('.zst'));
 assert.equal(sessionsDb.getSessionById('agent'),null);
 assert.equal(sessionsDb.getSessionById('live').jsonl_path,live.file);
 assert.equal(sessionsDb.getSessionById('archive').isArchived,1);
 sessionsDb.updateSessionIsArchived('archive',false);await sync.synchronize();
 assert.equal(sessionsDb.getSessionById('archive').isArchived,0,'Explicit CloudCLI restore is preserved');
 assert.ok((await stat(archived.file)).isFile());
}));
test('latest Codex rename replaces stale imported label while CloudCLI custom names and app ids survive',async()=>fixture(async({root,rollout,sync})=>{
 await rollout('renamed');await rollout('custom');await rollout('mapped');
 const names=id=>[{id,thread_name:'earliest',updated_at:'2026-10-01T01:00:00Z'},{id,thread_name:'latest',updated_at:'2026-10-02T01:00:00Z'},{id,thread_name:'out-of-order',updated_at:'2026-09-01T01:00:00Z'}];
 await writeFile(path.join(root,'.codex','session_index.jsonl'),encode([...names('renamed'),...names('custom'),...names('mapped')]));
 sessionsDb.createSession('renamed','codex',root,'earliest');sessionsDb.createSession('custom','codex',root,'Chosen in CloudCLI');sessionsDb.createAppSession('app-mapped','codex',root,'App title');sessionsDb.assignProviderSessionId('app-mapped','mapped');
 await sync.synchronize();
 assert.equal(sessionsDb.getSessionById('renamed').custom_name,'latest');assert.equal(sessionsDb.getSessionById('custom').custom_name,'Chosen in CloudCLI');assert.equal(sessionsDb.getSessionById('app-mapped').custom_name,'App title');assert.equal(sessionsDb.getSessionById('mapped'),null);
}));
test('compressed history renders the same stable ids, content, anchors and pagination as plain history',async()=>fixture(async({rollout,sync})=>{
 const source=await rollout('same',[...turn('t1','第一条'),...turn('t2','第二条')]);await sync.synchronize();
 const provider=new CodexSessionsProvider(),compressed=await provider.fetchHistory('same');
 const plain=source.file.slice(0,-4);await writeFile(plain,source.text);await sync.synchronizeFile(plain);
 const expanded=await provider.fetchHistory('same');assert.deepEqual(expanded,compressed);
 assert.deepEqual((await provider.fetchHistory('same',{limit:2,offset:2})).messages.map(m=>m.content),['第一条','answer 第一条']);
 await rm(plain);assert.deepEqual(await provider.fetchHistory('same'),compressed,'Stale plain paths resolve the compressed file');
}));
test('compressed ancestors honor frozen byte boundaries and reject short logical content',async()=>fixture(async({root,rollout,sync})=>{
 const base=await rollout('base',turn('base-turn','冻结中文'));
 const boundary=Buffer.byteLength(base.text);
 await writeFile(base.file,zstdCompressSync(Buffer.from(base.text+encode(turn('later-turn','must not inherit')))));
 await rollout('fork',turn('child-turn','孩子'),{history_base:{thread_id:'base',end_byte_offset:boundary}});
 await sync.synchronize();
 const provider=new CodexSessionsProvider();assert.deepEqual((await provider.fetchHistory('fork')).messages.map(m=>m.content),['冻结中文','answer 冻结中文','孩子','answer 孩子']);
 await writeFile(base.file,zstdCompressSync(Buffer.from('too short\n')));
 await assert.rejects(provider.fetchHistory('fork'),{code:'CODEX_HISTORY_SOURCE_INVALID'});
}));
test('question state survives compression and expands back into the same answer identity',async()=>fixture(async({rollout,sync})=>{
 const questions=[{title:'历史颜色',options:['红色','蓝色']}],call='old-question';
 const q=await rollout('question',[
 {type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:call,arguments:JSON.stringify({questions})}},
 {type:'response_item',payload:{type:'function_call_output',call_id:call,output:'{"accepted":true}'}},
 ]);await sync.synchronize();
 const pending=await listCodexQuestions('question');assert.equal(pending.requests[0].status,'pending');
 const item=pending.requests[0].questions[0];
 const answer={type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:item.id,answer:'蓝色'}])+'\n</send_user_message_question_reply>'}]}};
 const plain=q.file.slice(0,-4);await writeFile(plain,q.text+encode([answer]));await sync.synchronizeFile(plain);
 const answered=await listCodexQuestions('question');assert.equal(answered.requests[0].status,'answered');assert.equal(answered.requests[0].questions[0].id,item.id);assert.equal(answered.requests[0].questions[0].answer,'蓝色');
}));
test('corrupt compressed streams report errors and release the reader',async()=>fixture(async({directory})=>{
 const file=path.join(directory,'broken.jsonl.zst');await writeFile(file,'not zstandard');
 await assert.rejects(async()=>{for await(const line of readCodexArtifactLines(file))void line;});
}));

test('compressed history is searchable even though ripgrep cannot read compressed bytes',async()=>fixture(async({rollout,sync})=>{
 await rollout('searchable',turn('search-turn','ZSTD_HISTORY_UNIQUE_TOKEN'));
 await sync.synchronize();
 const found=await searchConversations('ZSTD_HISTORY_UNIQUE_TOKEN');
 assert.ok(found.results.flatMap(p=>p.sessions).some(s=>s.sessionId==='searchable'&&s.matches.some(m=>m.snippet.includes('ZSTD_HISTORY_UNIQUE_TOKEN'))));
}));

test('same-id continuation resolves the earlier compressed snapshot instead of its own indexed path',async()=>fixture(async({rollout,sync})=>{
 const original=await rollout('continued',turn('before-turn','earlier snapshot'));
 await rollout('continued',turn('after-turn','continued text'),{history_base:{thread_id:'continued',end_byte_offset:Buffer.byteLength(original.text)}},false);
 await sync.synchronize();
 const history=await new CodexSessionsProvider().fetchHistory('continued');
 assert.deepEqual(history.messages.map(m=>m.content),['earlier snapshot','answer earlier snapshot','continued text','answer continued text']);
}));
test('source lookup resolves native underscore aliases in compressed rollout filenames',async()=>fixture(async({rollout,sync})=>{
 const source=await rollout('actual-source',turn('source-turn','aliased snapshot'));
 const alias=source.file.replace('actual-source.jsonl.zst','actual-source_alias-source.jsonl.zst');
 await writeFile(alias,await readFile(source.file));await rm(source.file);
 await rollout('alias-child',[],{history_base:{thread_id:'alias-source',end_byte_offset:Buffer.byteLength(source.text)}});
 await sync.synchronize();
 const history=await new CodexSessionsProvider().fetchHistory('alias-child');
 assert.deepEqual(history.messages.map(m=>m.content),['aliased snapshot','answer aliased snapshot']);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readCodexContextUsed} from '../package/dist-server/server/modules/providers/list/codex/codex-context-usage.js';
import {sessionsDb,initializeDatabase,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {CodexSessionsProvider} from '../package/dist-server/server/modules/providers/list/codex/codex-sessions.provider.js';
import {createProviderTokenUsageService} from '../package/dist-server/server/modules/providers/services/provider-token-usage.service.js';
test('last-request accounting supports persisted and live shapes, valid zero and missing data',()=>{
 assert.equal(readCodexContextUsed({total_tokens:42000,input_tokens:40000,output_tokens:2000,cached_input_tokens:30000}),42000);
 assert.equal(readCodexContextUsed({inputTokens:900,outputTokens:100,cachedInputTokens:700}),1000);
 assert.equal(readCodexContextUsed({totalTokens:0}),0);
 for(const v of [null,{},'12',{total_tokens:-1},{total_tokens:NaN},{totalTokens:Infinity},{inputTokens:100}])assert.equal(readCodexContextUsed(v),null);
});
test('history and usage API keep context separate from cumulative spend, including compaction',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cloudcli-context-'));
 const previous=process.env.DATABASE_PATH;closeConnection();process.env.DATABASE_PATH=path.join(root,'auth.db');await initializeDatabase();
 const file=path.join(root,'rollout.jsonl'),id='context-usage-fixture';
 const event=(cumulative,current)=>JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{model_context_window:200000,total_token_usage:{input_tokens:cumulative-100,output_tokens:100,total_tokens:cumulative},...(current===undefined?{}:{last_token_usage:{total_tokens:current}})}}})+'\n';
 try{
  await writeFile(file,event(1200000,80000));sessionsDb.createSession(id,'codex',root,'context fixture');
  // The synchronizer owns this path in production; isolate that mapping here.
  const {getConnection}=await import('../package/dist-server/server/modules/database/connection.js');
  getConnection().prepare('UPDATE sessions SET jsonl_path = ? WHERE session_id = ?').run(file,id);
  const provider=new CodexSessionsProvider(),service=createProviderTokenUsageService();
  const initial=(await provider.fetchHistory(id)).tokenUsage,api=await service.getSessionTokenUsage(id);
  assert.equal(initial.used,1200000);assert.equal(initial.contextUsed,80000);assert.equal(api.contextUsed,80000);assert.equal(api.used,1200000);
  await appendFile(file,event(1300000,20000));
  const compacted=(await provider.fetchHistory(id)).tokenUsage;
  assert.equal(compacted.used,1300000);assert.equal(compacted.contextUsed,20000);assert.equal((await service.getSessionTokenUsage(id)).contextUsed,20000);
  assert.deepEqual((await provider.fetchHistory(id)).tokenUsage,compacted);
  await appendFile(file,event(1400000));
  assert.equal((await provider.fetchHistory(id)).tokenUsage.contextUsed,null,'Missing current measurement must not show cumulative use or stale progress');
 }finally{closeConnection();if(previous===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=previous;await rm(root,{recursive:true,force:true});}
});

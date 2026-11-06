import assert from 'node:assert/strict';
import test from 'node:test';
import {createCodexLivenessReader} from '../services/codex-liveness.service.js';
function mockRpc({fail=false,ids=['active','idle','gone'],nextCursor=null}={}) {
 const calls=[];let closed=false;
 return {calls,get closed(){return closed;},async initialize(){if(fail)throw Error('offline');},close(){closed=true;},async call(method,p){
 calls.push([method,p]);
 if(method==='thread/loaded/list')return {data:p.cursor?['paged']:ids,nextCursor:p.cursor?null:nextCursor};
 assert.equal(method,'thread/read');assert.equal(p.includeTurns,false);
 if(p.threadId==='gone')throw Error('unloaded');
 return {thread:{status:{type:p.threadId==='idle'?'idle':'active'},updatedAt:100}};
 }};
}
test('active native threads are detected without reading history or acquiring writer',async()=>{
 const rpc=mockRpc({nextCursor:'page2'});const read=createCodexLivenessReader(()=>rpc);
 const rows=await read();assert.deepEqual(rows.map(x=>x.providerSessionId).sort(),['active','paged']);assert.equal(rows[0].startedAt,100000);assert.ok(rpc.closed);
 assert.ok(rpc.calls.every(([m])=>['thread/loaded/list','thread/read'].includes(m)));
});
test('simultaneous browser polls share one read and short cache',async()=>{
 let created=0;const rpc=mockRpc();const read=createCodexLivenessReader(()=>{created++;return rpc;});
 const [a,b]=await Promise.all([read(),read()]);assert.deepEqual(a,b);await read();assert.equal(created,1);
});
test('unavailable daemon returns no stale running session and always closes',async()=>{
 const rpc=mockRpc({fail:true});assert.deepEqual(await createCodexLivenessReader(()=>rpc)(),[]);assert.ok(rpc.closed);
});
test('next poll removes finished threads and a daemon outage clears old state',async()=>{
 const realNow=Date.now;let now=1000;Date.now=()=>now;
 try{let current=mockRpc();const read=createCodexLivenessReader(()=>current);assert.equal((await read()).length,1);
 now+=1100;current=mockRpc({ids:['idle']});assert.deepEqual(await read(),[]);
 now+=1100;current=mockRpc({fail:true});assert.deepEqual(await read(),[]);
 }finally{Date.now=realNow;}
});

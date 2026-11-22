// Reload cache changes only after all WebUI generations are idle.
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
const root=new URL('../',import.meta.url).pathname,run=promisify(execFile);
const token=generateToken(userDb.getFirstUser());closeConnection();
const statusPath=root+'data/history-reload-status.json',lockPath=root+'data/history-reload.lock';
const lock=await fs.open(lockPath,'wx',0o600).catch(error=>{if(error.code==='EEXIST')process.exit(0);throw error;});await lock.writeFile(String(process.pid));await lock.close();
const expectedPid=(await fs.readFile(root+'data/server.pid','utf8')).trim();let state='';
async function status(next,extra={}){if(next===state&&!extra.error)return;state=next;await fs.writeFile(statusPath,JSON.stringify({state,expectedPid,updatedAt:new Date().toISOString(),...extra},null,2),{mode:0o600});console.log(next);}
async function get(path){const r=await fetch('http://10.20.64.136:3001'+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return(await r.json()).data;}
async function idle(){const data=await get('/api/providers/sessions/running');if(!Array.isArray(data.sessions))throw Error('Invalid running-session response');return !data.sessions.some(s=>s.canInterrupt!==false||s.background===true);}
try{
 await status('waiting-for-idle');let samples=0;const deadline=Date.now()+86400000;
 while(Date.now()<deadline){
  if((await fs.readFile(root+'data/server.pid','utf8')).trim()!==expectedPid){await status('superseded-by-another-restart');break;}
  try{samples=await idle()?samples+1:0;}catch{samples=0;}
  if(samples>=3&&await idle()){
   await status('reloading');await run(root+'webui',['restart'],{cwd:root,timeout:20000});
   const id='01a1edc6-541f-7eb3-bc2f-2b678f18d2cd',timings=[];
   for(let i=0;i<2;i++){const t=performance.now();const d=await get(`/api/providers/sessions/${id}/navigation`);if(!d.entries?.length)throw Error('History outline missing');timings.push(Math.round(performance.now()-t));}
   await run(root+'bin/node',[root+'design/review-history-performance.mjs'],{cwd:root,timeout:90000,env:{...process.env,DATABASE_PATH:root+'data/auth.db',LC_ALL:'C'}});
   await status('complete',{newPid:(await fs.readFile(root+'data/server.pid','utf8')).trim(),outlineMs:timings});break;
  }
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
 if(state==='waiting-for-idle')await status('idle-window-not-reached');
}catch(error){await status('failed',{error:error.message});process.exitCode=1;}
finally{await fs.unlink(lockPath).catch(()=>{});}

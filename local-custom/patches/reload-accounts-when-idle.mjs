// Reload the reviewed account feature only after WebUI turns have finished.
// Existing Codex daemon work is never stopped or resumed by this script.
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection,getConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
const root=new URL('../',import.meta.url).pathname,run=promisify(execFile);
const release=JSON.parse(await fs.readFile(root+'data/accounts-release.json','utf8'));
const statusFile=root+'data/accounts-reload-status.json',lockFile=root+'data/accounts-reload.lock';
const lock=await fs.open(lockFile,'wx',0o600).catch(error=>{if(error.code==='EEXIST')process.exit(0);throw error;});await lock.writeFile(String(process.pid));await lock.close();
const token=generateToken(userDb.getFirstUser());closeConnection();
const expectedPid=(await fs.readFile(root+'data/server.pid','utf8')).trim();let state='';
async function status(next,extra={}){if(next===state&&!extra.error)return;state=next;await fs.writeFile(statusFile,JSON.stringify({state,expectedPid,updatedAt:new Date().toISOString(),...extra},null,2),{mode:0o600});console.log(new Date().toISOString(),state);}
async function request(path,options={}){
 const response=await fetch('http://10.20.64.136:3001'+path,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});
 return {status:response.status,json:await response.json()};
}
async function running(){
 const {status:code,json}=await request('/api/providers/sessions/running');
 if(code!==200||!Array.isArray(json.data?.sessions))throw Error('Invalid running-session response');
 return json.data.sessions.filter(session=>session.canInterrupt!==false||session.background===true);
}
try{
 await status('waiting-for-idle');let idle=0;const deadline=Date.now()+24*60*60*1000;
 while(Date.now()<deadline){
  if((await fs.readFile(root+'data/server.pid','utf8')).trim()!==expectedPid){await status('superseded-by-another-restart');break;}
  try{idle=(await running()).length===0?idle+1:0;}catch{idle=0;}
  if(idle>=3&&(await running()).length===0){
   await status('backing-up');
   const db=getConnection();
   const before={users:db.prepare('SELECT COUNT(*) AS n FROM users').get().n,groups:db.prepare('SELECT COUNT(*) AS n FROM session_groups').get().n,members:db.prepare('SELECT COUNT(*) AS n FROM session_group_members').get().n};
   const backup=root+'data/auth-before-accounts-'+Date.now()+'.db';await db.backup(backup);await fs.chmod(backup,0o600);closeConnection();
   await status('reloading');await run(root+'webui',['restart'],{cwd:root,timeout:20000});
   const currentUser=await request('/api/auth/user');if(currentUser.status!==200)throw Error('Existing login stopped working');
   const empty=await request('/api/auth/accounts',{method:'POST',body:'{}'});
   if(empty.status!==400||empty.json.error?.code!=='AUTH_CREDENTIALS_REQUIRED')throw Error('New account API is unavailable');
   const groups=await request('/api/providers/session-groups');if(groups.status!==200||!Array.isArray(groups.json.data?.groups))throw Error('Groups unavailable');
   const afterDb=getConnection();
   const after={users:afterDb.prepare('SELECT COUNT(*) AS n FROM users').get().n,groups:afterDb.prepare('SELECT COUNT(*) AS n FROM session_groups').get().n,members:afterDb.prepare('SELECT COUNT(*) AS n FROM session_group_members').get().n};closeConnection();
   if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Account/group totals changed during reload');
   const indexPath=root+'package/dist/index.html',html=await fs.readFile(indexPath,'utf8');
   const previous=html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
   if(previous!==release.previous&&previous!==release.asset)throw Error('Browser release changed');
   await fs.access(root+'package/dist'+release.asset);await fs.writeFile(indexPath+'.accounts-next',html.replace(previous,release.asset));await fs.rename(indexPath+'.accounts-next',indexPath);
   await run(root+'bin/node',[root+'design/review-accounts-live.mjs'],{cwd:root,timeout:60000,env:{...process.env,DATABASE_PATH:root+'data/auth.db',LC_ALL:'C'}});
   await status('complete',{newPid:(await fs.readFile(root+'data/server.pid','utf8')).trim(),asset:release.asset,preserved:after,checks:['existing-login','authenticated-registration','group-totals','live-browser-settings']});break;
  }
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
 if(state==='waiting-for-idle')await status('idle-window-not-reached');
}catch(error){await status('failed',{error:error.message});process.exitCode=1;}
finally{await fs.unlink(lockFile).catch(()=>{});}

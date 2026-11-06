import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=path.join(root,'data'), logs=path.join(root,'logs'), pidFile=path.join(data,'server.json');
const entry=path.join(root,'package/dist-server/server/index.js');
const command=process.argv[2]||'status';
process.umask(0o077);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function current(){
  try{
    const record=JSON.parse(await fs.readFile(pidFile,'utf8'));
    if(!Number.isSafeInteger(record.pid)||record.pid<2)return null;
    process.kill(record.pid,0);
    // The launcher targets Linux servers. Avoid signaling a recycled PID.
    const args=await fs.readFile(`/proc/${record.pid}/cmdline`,'utf8');
    if(!args.split('\0').includes(entry))return null;
    const status=await fs.readFile(`/proc/${record.pid}/stat`,'utf8');
    if(status.slice(status.lastIndexOf(')')+2).startsWith('Z'))return null;
    return record;
  }catch(error){if(error.code==='EPERM')throw error;return null;}
}
async function stop(){
  const record=await current();
  if(!record){console.log('Stopped');return;}
  process.kill(record.pid,'SIGTERM');
  for(let i=0;i<100;i++){
    if(!await current()){await fs.rm(pidFile,{force:true});console.log('Stopped');return;}
    await delay(100);
  }
  throw new Error('Server is still stopping. Check logs/server.log before restarting.');
}
async function start(){
  const record=await current();
  if(record){console.log(`Already running (PID ${record.pid})`);return;}
  await fs.access(entry);
  await fs.mkdir(data,{recursive:true,mode:0o700});await fs.mkdir(logs,{recursive:true,mode:0o700});
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.SERVER_PORT||3001);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('Invalid SERVER_PORT');
  // Refuse to start over an existing listener instead of claiming its PID.
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,host,()=>listener.close(resolve));});
  const log=await fs.open(path.join(logs,'server.log'),'a',0o600);
  const env={...process.env,HOST:host,SERVER_PORT:String(port),NODE_ENV:'production',DATABASE_PATH:process.env.DATABASE_PATH||path.join(data,'auth.db')};
  // Only shadow `claude` when an explicit real binary is supplied. Otherwise
  // use the installed CLI's normal authentication and avoid wrapper recursion.
  if(env.CLOUDCLI_CLAUDE_BINARY)env.PATH=path.join(root,'bin')+path.delimiter+(env.PATH||'');
  const child=spawn(process.execPath,[entry],{cwd:path.join(root,'package'),env,detached:true,stdio:['ignore',log.fd,log.fd]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref();await log.close();
  await fs.writeFile(pidFile,JSON.stringify({pid:child.pid,host,port})+'\n',{mode:0o600});
  for(let i=0;i<100;i++){
    if(!await current())throw new Error('Startup failed; see local-custom/logs/server.log');
    const accessible=await new Promise(resolve=>{const socket=net.connect({host:host==='0.0.0.0'?'127.0.0.1':host==='::'?'::1':host,port});socket.setTimeout(200);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
    if(accessible){console.log(`Running: http://${host==='0.0.0.0'?'127.0.0.1':host}:${port} (PID ${child.pid})`);return;}
    await delay(200);
  }
  throw new Error('Server has not opened its port yet; check logs/server.log');
}
try{
  if(command==='start')await start();
  else if(command==='stop')await stop();
  else if(command==='restart'){await stop();await start();}
  else if(command==='status'){const record=await current();console.log(record?`Running (PID ${record.pid})`:'Stopped');}
  else throw new Error('Usage: local-custom/webui {start|stop|restart|status}');
}catch(error){console.error(error.message);process.exitCode=1;}

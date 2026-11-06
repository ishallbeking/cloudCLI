import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import Database from '../package/node_modules/better-sqlite3/lib/index.js';
const dbModule=new URL('../package/dist-server/server/modules/database/repositories/app-config.js',import.meta.url).href;
const connectionModule=new URL('../package/dist-server/server/modules/database/connection.js',import.meta.url).href;
const node=process.execPath;
test('a locked auth database never becomes a missing JWT key and never replaces the persisted secret',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cloudcli-auth-lock-')),file=path.join(dir,'auth.db');
 const db=new Database(file);db.exec('CREATE TABLE app_config (key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO app_config VALUES (?,?)').run('jwt_secret','fixture-existing-secret');
 const script=path.join(dir,'read.mjs');
 await writeFile(script,`import {appConfigDb} from ${JSON.stringify(dbModule)};import {getConnection,closeConnection} from ${JSON.stringify(connectionModule)};getConnection().pragma('busy_timeout = 10');process.stdout.write('READY\\n');setTimeout(()=>{try{appConfigDb.getOrCreateJwtSecret();process.exitCode=2;}catch(e){if(e.code!=='SQLITE_BUSY'&&e.code!=='SQLITE_LOCKED')throw e;console.log('LOCK_REPORTED');}finally{closeConnection();}},150);`);
 try {
  const completed=new Promise((resolve,reject)=>{
   const child=execFile(node,[script],{env:{...process.env,DATABASE_PATH:file}},(error,stdout)=>error?reject(error):resolve(stdout));
   child.stdout.on('data',chunk=>{if(chunk.toString().includes('READY'))db.exec('BEGIN EXCLUSIVE');});
  });
  const stdout=await completed;assert.ok(stdout.includes('LOCK_REPORTED'));db.exec('COMMIT');
  assert.equal(db.prepare("SELECT value FROM app_config WHERE key='jwt_secret'").get().value,'fixture-existing-secret');
 } finally {if(db.inTransaction)db.exec('ROLLBACK');db.close();await rm(dir,{recursive:true,force:true});}
});

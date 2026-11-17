import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import {closeConnection, initializeDatabase, sessionsDb, getConnection} from '@/modules/database/index.js';
import {sessionGroupsService as groups} from '../services/session-groups.service.js';
import {createSessionGroupsRouter} from '../session-groups.routes.js';

async function isolated(run: () => Promise<void> | void) {
  const previous = process.env.DATABASE_PATH;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-groups-'));
  closeConnection(); process.env.DATABASE_PATH = path.join(dir, 'auth.db');
  await initializeDatabase();
  sessionsDb.createAppSession('session-a', 'codex', '/tmp/alpha', 'Conversation A');
  sessionsDb.createAppSession('session-b', 'claude', '/tmp/beta', 'Conversation B');
  getConnection().prepare('UPDATE projects SET project_id=?, custom_project_name=? WHERE project_path=?').run('project-a','Alpha','/tmp/alpha');
  getConnection().prepare('UPDATE projects SET project_id=?, custom_project_name=? WHERE project_path=?').run('project-b','Beta','/tmp/beta');
  try {await run();} finally {closeConnection(); if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous; await rm(dir, {recursive: true, force: true});}
}

test('groups persist across reopen and accept different projects/providers with stable IDs', () => isolated(() => {
  const group = groups.create(1, '跨项目');
  groups.add(1, group.id, ['session-a','session-b','session-a']);
  closeConnection();
  const stored = groups.list(1).groups[0];
  assert.equal(stored.name, '跨项目');
  assert.deepEqual(new Set(stored.sessions.map(s => s.projectId)), new Set(['project-a','project-b']));
  assert.deepEqual(new Set(stored.sessions.map(s => s.sessionId)), new Set(['session-a','session-b']));
  assert.deepEqual(new Set(stored.sessions.map(s => s.provider)), new Set(['codex','claude']));
}));

test('one session may belong to multiple groups; remove/delete never changes conversations', () => isolated(() => {
  const a = groups.create(1, 'One'), b = groups.create(1, 'Two');
  groups.add(1, a.id, ['session-a']); groups.add(1, b.id, ['session-a']);
  groups.removeMember(1, a.id, 'session-a');
  assert.equal(groups.list(1).groups.find(g=>g.id===b.id)?.sessions.length, 1);
  groups.remove(1, b.id);
  assert.equal(sessionsDb.getSessionById('session-a')?.custom_name, 'Conversation A');
  assert.equal(groups.list(1).groups.length, 1);
  assert.equal(getConnection().prepare('SELECT COUNT(*) AS n FROM session_group_members').get().n, 0);
}));

test('rename only changes group; duplicate names report conflict', () => isolated(() => {
  const a = groups.create(1, 'One'); groups.create(1, 'Two');
  groups.rename(1, a.id, '新组');
  assert.equal(groups.list(1).groups.find(g=>g.id===a.id)?.name, '新组');
  assert.throws(()=>groups.rename(1,a.id,'Two'), {statusCode:409});
  assert.throws(()=>groups.create(1,'two'), {statusCode:409});
  assert.equal(sessionsDb.getSessionById('session-a')?.custom_name, 'Conversation A');
}));

test('user isolation applies to read, rename, add, remove membership and delete', () => isolated(() => {
  const a=groups.create(1,'Private'); groups.add(1,a.id,['session-a']);
  assert.deepEqual(groups.list(2).groups, []);
  groups.create(2, 'Private');
  for(const action of [()=>groups.rename(2,a.id,'Stolen'),()=>groups.add(2,a.id,['session-b']),()=>groups.removeMember(2,a.id,'session-a'),()=>groups.remove(2,a.id)]) assert.throws(action,{statusCode:404});
  assert.equal(groups.list(1).groups[0].sessions.length,1);
}));

test('invalid batch is atomic; deleted sessions cannot leave dangling group entries', () => isolated(() => {
  const a=groups.create(1,'Atomic');
  assert.throws(()=>groups.add(1,a.id,['session-a','missing']), {statusCode:404});
  assert.equal(groups.list(1).groups[0].sessions.length,0);
  groups.add(1,a.id,['session-a']); sessionsDb.deleteSessionById('session-a');
  assert.equal(groups.list(1).groups[0].sessions.length,0);
  assert.equal(getConnection().prepare('SELECT COUNT(*) AS n FROM session_group_members').get().n,0);
}));

test('archiving hides memberships without losing them; restoring returns them', () => isolated(() => {
  const a=groups.create(1,'Archive'); groups.add(1,a.id,['session-a','session-b']);
  sessionsDb.updateSessionIsArchived('session-a',true);
  assert.deepEqual(groups.list(1).groups[0].sessions.map(s=>s.sessionId),['session-b']);
  sessionsDb.updateSessionIsArchived('session-a',false);
  assert.equal(groups.list(1).groups[0].sessions.length,2);
  getConnection().prepare('UPDATE projects SET isArchived=1 WHERE project_id=?').run('project-b');
  assert.deepEqual(groups.list(1).groups[0].sessions.map(s=>s.sessionId),['session-a']);
}));

test('search is global, literal, paginated, and reflects session/project renames', () => isolated(() => {
  assert.equal(groups.candidates('',1,0).hasMore,true);
  assert.equal(groups.candidates('',1,1).hasMore,false);
  assert.equal(groups.candidates('Beta',50,0).conversations[0].sessionId,'session-b');
  assert.equal(groups.candidates('%',50,0).total,0);
  sessionsDb.updateSessionCustomName('session-a','100% renamed');
  assert.equal(groups.candidates('%',50,0).conversations[0].sessionTitle,'100% renamed');
  const a=groups.create(1,'Live'); groups.add(1,a.id,['session-a']);
  assert.equal(groups.list(1).groups[0].sessions[0].sessionTitle,'100% renamed');
}));

test('HTTP contracts validate input and preserve owner boundaries', () => isolated(async () => {
  const app=express(); app.use(express.json());
  app.use((req,res,next)=>{(req as any).user={id:Number(req.header('x-test-user') || 1)};next();});
  app.use('/api/providers',createSessionGroupsRouter());
  app.use((error:any,req:any,res:any,next:any)=>res.status(error.statusCode || 500).json({error:{message:error.message}}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/providers/session-groups`;
  const call=async(suffix='',method='GET',body?:unknown,user=1)=>{
    const response=await fetch(base+suffix,{method,headers:{'Content-Type':'application/json','x-test-user':String(user)},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  try {
    for(const name of ['', '  ', 3, 'x'.repeat(101)]) assert.equal((await call('','POST',{name})).status,400);
    const created=await call('','POST',{name:' HTTP '});assert.equal(created.status,201);const id=created.data.data.id;
    assert.equal(created.data.data.name,'HTTP');
    for(const ids of [[],['ok','bad id'],['x'.repeat(121)],Array(101).fill('session-a'),null]) assert.equal((await call('/'+id+'/sessions','POST',{sessionIds:ids})).status,400);
    assert.equal((await call('/'+id+'/sessions','POST',{sessionIds:['session-a','session-b']})).status,200);
    assert.equal((await call()).data.data.groups[0].sessions.length,2);
    assert.equal((await call('/'+id,'PATCH',{name:'Renamed'},2)).status,404);
    assert.equal((await call('/'+id,'PATCH',{name:'Renamed'})).status,200);
    assert.equal((await call('/candidates?q=Beta')).data.data.total,1);
    for(const query of ['?offset=-1','?offset=1.2','?offset=NaN','?q[a]=x']) assert.equal((await call('/candidates'+query)).status,400);
    assert.equal((await call('/'+id+'/sessions/session-a','DELETE')).status,200);
    assert.equal((await call('/'+id,'DELETE')).status,200);
    assert.equal((await call()).data.data.groups.length,0);
    assert.ok(sessionsDb.getSessionById('session-a'));
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}));

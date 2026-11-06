import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants, createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import express from '../package/node_modules/express/index.js';
import {createFileTreeService} from '../package/dist-server/server/modules/file-tree/file-tree.service.js';
import {createFileTreeRouter} from '../package/dist-server/server/modules/file-tree/file-tree.routes.js';

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-file-copy-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  await fs.mkdir(source); await fs.mkdir(target);
  const fileSystem = {
    access:fs.access, stat:fs.stat, lstat:fs.lstat, realpath:fs.realpath,
    openDirectory:async function* (directory) {yield* await fs.opendir(directory);},
    readTextFile:p=>fs.readFile(p,'utf8'), writeTextFile:(p,c)=>fs.writeFile(p,c),
    makeDirectory:(p,recursive)=>fs.mkdir(p,{recursive}), rename:fs.rename,
    removeDirectory:p=>fs.rm(p,{recursive:true,force:true}), unlink:fs.unlink,
    copyFile:(s,d,exclusive)=>fs.copyFile(s,d,exclusive?constants.COPYFILE_EXCL:0),
    createReadStream, ...overrides,
  };
  const services = createFileTreeService({fileSystem,
    projects:{getProjectPathById:id=>({source,target})[id]??null},
    workspace:{rootPath:root,validatePath:async p=>({valid:p.startsWith(root+'/'),resolvedPath:p}),resolveReadOnlyRootPath:async()=>null},
    resolveMimeType:()=> 'application/octet-stream',fileSystemConcurrency:4,logger:{error(){}}});
  const copy = (sourcePath, targetPath = '', projectId = 'target', sourceProjectId = 'source') => services.copyEntry({projectId,sourceProjectId,sourcePath,targetPath});
  return {root,source,target,services,copy};
}

test('copies binary files and recursively copies all folder contents independently of loaded tree', async t=>{
  const {source,target,copy}=await fixture(t);
  await fs.mkdir(path.join(source,'folder/nested'),{recursive:true});
  const data=Buffer.from([0,255,128,1]);
  await fs.writeFile(path.join(source,'folder/nested/data.bin'),data);
  await fs.writeFile(path.join(source,'folder/.hidden'),'hidden');
  await copy('folder');
  assert.deepEqual(await fs.readFile(path.join(target,'folder/nested/data.bin')),data);
  assert.equal(await fs.readFile(path.join(target,'folder/.hidden'),'utf8'),'hidden');
  const file=await copy('folder/nested/data.bin');
  assert.deepEqual(await fs.readFile(file.path),data);
  assert.equal((await fs.readdir(source)).length,1);
});

test('same-folder and repeated paste preserve originals and choose names without overwriting', async t=>{
  const {source,target,copy}=await fixture(t);
  await fs.writeFile(path.join(source,'a.txt'),'original');
  await fs.writeFile(path.join(target,'a.txt'),'existing');
  assert.equal((await copy('a.txt')).name,'a (副本).txt');
  assert.equal((await copy('a.txt')).name,'a (副本 2).txt');
  assert.equal((await copy('a.txt','','source')).name,'a (副本).txt');
  assert.equal(await fs.readFile(path.join(target,'a.txt'),'utf8'),'existing');
  await fs.mkdir(path.join(source,'dir'));
  await copy('dir'); assert.equal((await copy('dir')).name,'dir (副本)');
});

test('concurrent copies exclusively claim destinations', async t=>{
  const {source,copy}=await fixture(t);
  await fs.writeFile(path.join(source,'a.txt'),'data');
  const results=await Promise.all(Array.from({length:10},()=>copy('a.txt')));
  assert.equal(new Set(results.map(r=>r.path)).size,10);
  for(const result of results) assert.equal(await fs.readFile(result.path,'utf8'),'data');
});

test('rejects own descendants, traversal, outside paths, unknown project and invalid destinations', async t=>{
  const {source,target,copy}=await fixture(t);
  await fs.mkdir(path.join(source,'dir/child'),{recursive:true});
  await fs.writeFile(path.join(source,'a.txt'),'data');
  await assert.rejects(copy('dir',path.join(source,'dir/child'),'source'),/自身或其子目录/);
  await assert.rejects(copy('dir',path.join(source,'dir'),'source'),/自身或其子目录/);
  await assert.rejects(copy('../target'),/对应项目内/);
  await assert.rejects(copy('/etc/passwd'),/对应项目内/);
  await assert.rejects(copy('a.txt','..'),/对应项目内/);
  await assert.rejects(copy('a.txt','','missing'),/项目不存在/);
  await fs.writeFile(path.join(target,'file'),'data');
  await assert.rejects(copy('a.txt','file'),/必须是文件夹/);
  await assert.rejects(copy('missing'),{code:'ENOENT'});
});

test('rejects source/destination symlink escapes and symlink-containing trees before writing', async t=>{
  const {root,source,target,copy}=await fixture(t);
  await fs.mkdir(path.join(root,'outside'));
  await fs.writeFile(path.join(root,'outside/data.txt'),'private');
  await fs.symlink(path.join(root,'outside'),path.join(source,'link'));
  await fs.symlink(path.join(root,'outside'),path.join(target,'link'));
  await assert.rejects(copy('link/data.txt'),/项目外/);
  await fs.writeFile(path.join(source,'file'),'data');
  await assert.rejects(copy('file','link'),/项目外/);
  await fs.mkdir(path.join(source,'dir'));await fs.symlink('../file',path.join(source,'dir/link'));
  await assert.rejects(copy('dir'),/符号链接/);
  assert.deepEqual(await fs.readdir(target),['link']);
});

test('failed recursive copy removes only its incomplete destination', async t=>{
  const {source,target,copy}=await fixture(t,{copyFile:async()=>{throw new Error('simulated disk error');}});
  await fs.mkdir(path.join(source,'dir'));await fs.writeFile(path.join(source,'dir/file'),'data');
  await fs.mkdir(path.join(target,'dir'));await fs.writeFile(path.join(target,'dir/existing'),'keep');
  await assert.rejects(copy('dir'),/simulated disk error/);
  assert.deepEqual(await fs.readdir(target),['dir']);
  assert.equal(await fs.readFile(path.join(target,'dir/existing'),'utf8'),'keep');
});

test('HTTP copy route validates input and returns copied entry for the requested projects',async t=>{
  const {source,services}=await fixture(t);await fs.writeFile(path.join(source,'a.txt'),'hello');
  const app=express();app.use(express.json());
  app.use(createFileTreeRouter(services,(_req,_res,next)=>next(),{maximumFileCount:20,maximumFileSizeMegabytes:200},{error(){}}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=body=>fetch(`http://127.0.0.1:${server.address().port}/projects/target/files/copy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const ok=await request({sourceProjectId:'source',sourcePath:'a.txt'});assert.equal(ok.status,200);
  const result=await ok.json();assert.equal(result.name,'a.txt');assert.equal(await fs.readFile(result.path,'utf8'),'hello');
  assert.equal((await request({sourcePath:'a.txt'})).status,400);
  assert.equal((await request({sourceProjectId:'source',sourcePath:'/etc/passwd'})).status,403);
});

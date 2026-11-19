import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {patchChatFileLinks} from '../patches/chat-file-links-client.mjs';
const source=await fs.readFile(new URL('../patches/chat-file-links-client.js',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(source,context);
test('Markdown href decoding preserves the exact filesystem filename',()=>{
 for(const path of ['/项目/结果 表格.csv','/project/100%.md','/project/literal%20name.csv','/project/a#b?c&d.csv','/project/emoji🧪.md','/project/sub/file.ts:12:3']){
  assert.equal(context.cloudcliDecodeFileHref(encodeURI(path)),path);
 }
 assert.equal(context.cloudcliDecodeFileHref('/project/%252F.csv'),'/project/%2F.csv');
 assert.equal(context.cloudcliDecodeFileHref('/项目/%oops-%E4%BD%A0.md'),'/项目/%oops-你.md');
 assert.equal(context.cloudcliDecodeFileHref('/project/%FF.csv'),'/project/%FF.csv');
});
test('patch decodes only actual local hrefs and adds authenticated binary download',async()=>{
 const original=await fs.readFile(new URL('../package/dist/assets/index-Cq6TKEnV.js',import.meta.url),'utf8');
 const patched=await patchChatFileLinks(original);
 assert.ok(patched.includes('d===m?cloudcliDecodeFileHref(m.trim()):m.trim()'));
 assert.ok(patched.includes('m&&!o1e(d)?'));
 assert.ok(patched.includes('s.jsx(CloudcliFileDownload,{file:e},e.projectId+":"+e.path)'));
 await assert.rejects(patchChatFileLinks(patched),/upstream changed/);
});
test('binary download sends exact path, keeps original bytes and releases blob URLs',async()=>{
 const calls=[],timers=[];const bytes=new Uint8Array([80,75,3,4,0,255]);
 const anchor={click(){calls.push(['click',this.download]);},remove(){calls.push(['remove']);}};
 const sandbox=vm.createContext({AbortController,Uint8Array,
 f:{useState:initial=>[initial,value=>calls.push(['state',value])],useRef:()=>({current:null}),useEffect:()=>{}},
 s:{jsx:(tag,props)=>({tag,...props}),jsxs:(tag,props)=>({tag,...props})},
 ke:{readFileBlob:async(...args)=>{calls.push(['fetch',...args]);return {ok:true,blob:async()=>bytes}}},
 URL:{createObjectURL:blob=>{assert.deepEqual(blob,bytes);return 'blob:test'},revokeObjectURL:url=>calls.push(['revoke',url])},
 document:{createElement:()=>anchor,body:{appendChild:()=>{}}},setTimeout:fn=>timers.push(fn)});
 vm.runInContext(source,sandbox);
 const file={projectId:'project-id',path:'/项目/表%20格.xlsx',name:'表%20格.xlsx'};
 const component=sandbox.CloudcliFileDownload({file});await component.children[0].onClick();
 const request=calls.find(c=>c[0]==='fetch');assert.equal(request[1],file.projectId);assert.equal(request[2],file.path);
 assert.equal(anchor.download,file.name);assert.ok(calls.some(c=>c[0]==='click'));
 timers.forEach(fn=>fn());assert.ok(calls.some(c=>c[0]==='revoke'));
});

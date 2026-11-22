import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {patchAccounts} from '../patches/accounts-client.mjs';
const source=await fs.readFile(new URL('../patches/accounts-client.js',import.meta.url),'utf8');
const jwt=id=>'e30.'+Buffer.from(JSON.stringify({userId:id})).toString('base64url')+'.signature';
test('account changes reset other tabs; same-user token rotation keeps active work mounted',()=>{
 let listener,reloads=0;
 const context=vm.createContext({atob,window:{addEventListener:(type,handler)=>{assert.equal(type,'storage');listener=handler;},location:{reload:()=>reloads++}}});
 vm.runInContext(source,context);
 listener({key:'auth-token',oldValue:jwt(1),newValue:jwt(1)});assert.equal(reloads,0);
 listener({key:'other',oldValue:'1',newValue:'2'});assert.equal(reloads,0);
 listener({key:'auth-token',oldValue:jwt(1),newValue:jwt(2)});assert.equal(reloads,1);
 listener({key:'auth-token',oldValue:jwt(2),newValue:null});assert.equal(reloads,2);
 listener({key:'auth-token',oldValue:null,newValue:jwt(2)});assert.equal(reloads,3);
 listener({key:null});assert.equal(reloads,4);
});
test('account API reports duplicate/failed registration and never changes stored login',async()=>{
 let response={ok:true,json:async()=>({success:true,user:{id:2,username:'bob'}})},request;
 const context=vm.createContext({window:{addEventListener:()=>{}},ht:async(...args)=>{request=args;return response;},Po:()=>null});
 vm.runInContext(source+'\nglobalThis.createAccount=cloudcliAccountsApi.create;',context);
 const result=await context.createAccount('bob','secret12');assert.equal(result.username,'bob');
 assert.equal(request[0],'/api/auth/accounts');assert.equal(request[1].method,'POST');
 assert.deepEqual(JSON.parse(request[1].body),{username:'bob',password:'secret12'});
 response={ok:false,json:async()=>({error:{code:'AUTH_USERNAME_CONFLICT'}})};
 await assert.rejects(context.createAccount('bob','secret12'),/用户名已被使用/);
 response={ok:false,json:async()=>({})};await assert.rejects(context.createAccount('bob','secret12'),/注册失败/);
});
test('compatibility patch includes the settings tab and preserves its selection through status refresh',async()=>{
 const original=await fs.readFile(new URL('../package/dist/assets/index-Cq6TKEnV.js',import.meta.url),'utf8');
 const result=await patchAccounts(original);
 assert.ok(result.includes('Wrt=["account","agents","appearance",'));
 assert.ok(result.includes('f.useEffect(()=>{e&&i(dA(t))},[t,e])'));
 assert.ok(result.includes('s.jsx(CloudcliAccountSettings,{})'));
 await assert.rejects(patchAccounts(result),/Accounts anchor changed/);
});

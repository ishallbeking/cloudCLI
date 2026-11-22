// Exercise real auth/groups/user routes with a disposable DB. Only unrelated
// history GETs reach the live server; no live account, group or model writes.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection,initializeDatabase,sessionsDb,getConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken,authenticateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
import {createSessionGroupsRouter} from '../package/dist-server/server/modules/providers/session-groups.routes.js';
const require=createRequire(new URL('../package/package.json',import.meta.url));
const express=require('express');
const root=new URL('../',import.meta.url).pathname;
const liveToken=generateToken(userDb.getFirstUser());closeConnection();
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cloudcli-account-browser-'));
await fs.writeFile(path.join(dir,'auth.db'),'');
process.env.DATABASE_PATH=path.join(dir,'auth.db');await initializeDatabase();
const {authRoutes}=await import('../package/dist-server/server/modules/auth/index.js');
const {userRoutes}=await import('../package/dist-server/server/modules/user/index.js');
const app=express();app.use(express.json());
app.use('/api/auth',authRoutes);app.use('/api/user',authenticateToken,userRoutes);
app.use('/api/providers',(req,res,next)=>req.path.startsWith('/session-groups')?authenticateToken(req,res,()=>createSessionGroupsRouter()(req,res,next)):next());
app.use('/api',async(req,res)=>{
 if(req.method!=='GET')return res.status(403).json({error:'Live writes disabled during verification'});
 try{const response=await fetch('http://10.20.64.136:3001/api'+req.url,{headers:{Authorization:`Bearer ${liveToken}`},signal:AbortSignal.timeout(20000)});
 res.status(response.status).type(response.headers.get('content-type')||'application/json').send(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.status(502).json({error:error.message});}
});
app.use(express.static(root+'package/dist',{index:false}));
const candidate=await fs.readFile(process.env.CLOUDCLI_ACCOUNTS_TEST_HTML || new URL('../package/dist/index.html',import.meta.url),'utf8');
app.get('*',(_req,res)=>res.type('html').send(candidate));
app.use((error,req,res,next)=>res.status(error.statusCode||500).json({error:{message:error.message,code:error.code}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const password='test-'+randomUUID();
const initial=await fetch(origin+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test_alice',password})}).then(r=>r.json());
assert.ok(initial.token);userDb.completeOnboarding(initial.user.id);
sessionsDb.createAppSession('account-fixture-session','codex','/tmp/account-browser-fixture','Browser fixture');
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
await context.route('**/*',route=>['127.0.0.1','10.20.64.136'].includes(new URL(route.request().url()).hostname)||route.request().url().startsWith('blob:')?route.continue():route.abort());
const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];
page.on('pageerror',error=>errors.push(error.message));
async function signIn(username){
 await page.locator('#username').fill(username);await page.locator('#password').fill(password);
 await page.locator('form button[type="submit"]').click();
 await page.getByTestId('sidebar-footer').waitFor();
}
async function openAccount(){
 const buttons=page.getByRole('button',{name:/^设置$|^Settings$/});
 await buttons.last().click();
 await page.getByRole('button',{name:'账号',exact:true}).filter({visible:true}).click();
 await page.getByTestId('account-settings').waitFor();
}
async function closeSettings(){await page.keyboard.press('Escape');await page.getByTestId('account-settings').waitFor({state:'hidden'});}
async function clickGroups(){
 const tab=page.getByRole('button',{name:'组',exact:true}).filter({visible:true});
 if(await tab.count())return tab.first().click();
 await page.getByRole('button',{name:/^More$|^更多$/}).filter({visible:true}).first().click();
 await page.getByRole('menuitem',{name:'组',exact:true}).click();
}
async function createGroup(name){
 await clickGroups();
 await page.getByRole('button',{name:'＋ 创建组',exact:true}).click();
 await page.getByRole('dialog').getByLabel('组名称').fill(name);
 await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.locator('.ccg-group').filter({hasText:name}).waitFor();
}
async function registerForm(username,confirmation=password){
 await page.getByLabel('用户名',{exact:true}).fill(username);
 await page.getByLabel('密码',{exact:true}).fill(password);
 await page.getByLabel('确认密码',{exact:true}).fill(confirmation);
 await page.getByRole('button',{name:'注册新账号',exact:true}).click();
}
try{
 await page.goto(origin,{waitUntil:'domcontentloaded'});await signIn('test_alice');
 await createGroup('Alice 私有组');
 await openAccount();assert.equal(await page.getByTestId('account-username').innerText(),'test_alice');
 await registerForm('test_bob','mismatch');await page.getByRole('alert').filter({hasText:'两次输入的密码不一致'}).waitFor();
 await registerForm('test_alice');await page.getByRole('alert').filter({hasText:'用户名已被使用'}).waitFor();
 await registerForm('test_bob');await page.getByRole('status').filter({hasText:'test_bob'}).waitFor();
 assert.equal(await page.getByTestId('account-username').innerText(),'test_alice');
 assert.equal(userDb.hasCompletedOnboarding(userDb.getUserByUsername('test_bob').id),true);
 await page.screenshot({path:path.join(dir,'accounts-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
 await page.getByRole('button',{name:'账号',exact:true}).filter({visible:true}).click();
 await page.getByTestId('account-settings').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(dir,'accounts-mobile.png')});
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'账号',exact:true}).filter({visible:true}).click();
 const second=await context.newPage();await second.goto(origin,{waitUntil:'domcontentloaded'});
 await second.getByTestId('sidebar-footer').waitFor();
 await page.getByRole('button',{name:'退出登录',exact:true}).click();
 await page.locator('#username').waitFor();await second.locator('#username').waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('auth-token')),null);
 await signIn('test_bob');
 await second.getByTestId('sidebar-footer').waitFor();
 await clickGroups();
 await page.getByText('还没有组',{exact:true}).waitFor();assert.equal(await page.locator('.ccg-group').count(),0);
 await createGroup('Bob 私有组');
 await page.reload({waitUntil:'domcontentloaded'});await clickGroups();
 await page.locator('.ccg-group').filter({hasText:'Bob 私有组'}).waitFor();
 assert.equal(await page.locator('.ccg-group').filter({hasText:'Alice 私有组'}).count(),0);
 await openAccount();assert.equal(await page.getByTestId('account-username').innerText(),'test_bob');
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.locator('#username').waitFor();
 await signIn('test_alice');await clickGroups();
 await page.locator('.ccg-group').filter({hasText:'Alice 私有组'}).waitFor();
 assert.equal(await page.locator('.ccg-group').filter({hasText:'Bob 私有组'}).count(),0);
 assert.deepEqual(errors,[]);
 const result={passed:true,checks:['settings-account-entry','registration-validation','duplicate-username','create-without-switching','logout-to-login','cross-tab-logout-login','empty-new-user-groups','groups-survive-refresh','restore-first-user-groups','desktop-mobile','no-browser-errors']};
 await fs.writeFile('/tmp/cloudcli-accounts-browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await fs.copyFile(path.join(dir,'accounts-desktop.png'),root+'design/accounts-desktop.png');await fs.copyFile(path.join(dir,'accounts-mobile.png'),root+'design/accounts-mobile.png');
}catch(error){await page.screenshot({path:root+'design/accounts-error.png'}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-1800));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeConnection();await fs.rm(dir,{recursive:true,force:true});}

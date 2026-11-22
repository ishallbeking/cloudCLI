// Real-session read-only UI validation. Never sends or schedules a message.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
const token=generateToken(userDb.getFirstUser());closeConnection();
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const prefix=process.env.COMPOSER_REVIEW_PREFIX||'/tmp/cloudcli-composer';
try{
 const context=await browser.newContext({viewport:{width:393,height:740},isMobile:true,hasTouch:true,locale:'zh-CN'});
 await context.addInitScript(token=>localStorage.setItem('auth-token',token),token);

 await context.addInitScript(()=>{
  window.__stopAttempts=[];window.__testSockets=[];
  const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){
   if(!window.__testSockets.includes(this))window.__testSockets.push(this);
   let msg;try{msg=JSON.parse(data);}catch{return;}
   if(msg.type==='chat.subscribe')return send.call(this,data);
   window.__stopAttempts.push({type:msg.type,sessionId:msg.sessionId});
  };
 });
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(r.method()!=='GET'&&u.pathname.startsWith('/api/')&&u.pathname!=='/api/commands/list')return route.fulfill({json:{success:true}});
  if(process.env.STOP_REVIEW_CSS&&u.pathname==='/styles/cloudcli-modern.css')return route.fulfill({contentType:'text/css',body:await fs.readFile(process.env.STOP_REVIEW_CSS,'utf8')});
  if(process.env.STOP_REVIEW_HTML&&r.isNavigationRequest())return route.fulfill({contentType:'text/html',body:await fs.readFile(process.env.STOP_REVIEW_HTML,'utf8')});
  return route.continue();
 });
 const page=await context.newPage(),acks=[];page.setDefaultTimeout(15000);
 page.on('websocket',ws=>ws.on('framereceived',e=>{try{const m=JSON.parse(e.payload);if(m.kind==='chat_subscribed')acks.push({sessionId:m.sessionId,isProcessing:m.isProcessing,canInterrupt:m.canInterrupt});}catch{}}));
 await page.goto('http://10.20.64.136:3001/session/01a1a5c2-7d36-7da0-824e-f79a302e3e80',{waitUntil:'domcontentloaded'});
 const button=page.locator('.cloudcli-composer-send > button');await button.waitFor();await page.waitForTimeout(1500);

 const sessionId='01a1a5c2-7d36-7da0-824e-f79a302e3e80';
 const inject=async event=>page.evaluate(event=>window.__testSockets.at(-1).dispatchEvent(new MessageEvent('message',{data:JSON.stringify(event)})),{sessionId,provider:'codex',...event});
 const active={kind:'chat_subscribed',runId:'stop-review-current',runStartedAt:Date.now()+10000,isProcessing:true,canInterrupt:true};
 await inject(active);await page.waitForTimeout(100);await button.click();
 await page.getByRole('status').filter({hasText:'正在停止，等待确认'}).waitFor();assert.equal(await button.isDisabled(),true);
 assert.deepEqual(await page.evaluate(()=>window.__stopAttempts),[{type:'chat.abort',sessionId}]);
 await inject({kind:'complete',runId:'older',runStartedAt:0,aborted:true});assert.equal(await button.isDisabled(),true);
 await inject({kind:'complete',runId:active.runId,runStartedAt:active.runStartedAt,aborted:true});await page.waitForTimeout(100);assert.equal(await page.locator('.cloudcli-stop-feedback').count(),0);
 await inject({...active,canInterrupt:false});await page.waitForTimeout(100);await button.click();
 await page.getByRole('alert').filter({hasText:'当前生成由其他客户端运行'}).waitFor();assert.equal((await page.evaluate(()=>window.__stopAttempts)).length,1);
 await inject({kind:'complete',runId:active.runId,runStartedAt:active.runStartedAt,aborted:true});await inject(active);await page.waitForTimeout(100);
 await page.evaluate(()=>window.__testSockets.at(-1).close());await page.waitForTimeout(300);await button.click();
 await page.getByRole('alert').filter({hasText:'停止请求未发出'}).waitFor();assert.equal((await page.evaluate(()=>window.__stopAttempts)).length,1);
 await page.screenshot({path:'/tmp/cloudcli-stop-feedback.png'});await page.waitForTimeout(3500);
 assert.equal((await page.evaluate(()=>window.__stopAttempts)).length,1,'Reconnect must not replay a stop into a later turn');
 console.log(JSON.stringify({passed:true,checks:['click-target-session','pending-until-confirmed','duplicate-disabled','stale-completion-ignored','completion-clears','external-run-explained','disconnected-not-delivered','no-stop-replay'],acks}));
}finally{await browser.close();}

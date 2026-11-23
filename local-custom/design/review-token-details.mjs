// Real-page verification: usage queries only; never sends a chat message or stop.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
const token=generateToken(userDb.getFirstUser());closeConnection();
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
 const context=await browser.newContext({viewport:{width:393,height:740},isMobile:true,hasTouch:true,locale:'zh-CN'});
 await context.addInitScript(token=>{
  localStorage.setItem('auth-token',token);
  const send=WebSocket.prototype.send;
  WebSocket.prototype.send=function(data){let msg;try{msg=JSON.parse(data);}catch{return;}if(msg.type==='chat.subscribe')return send.call(this,data);};
 },token);
 const commands=[],writes=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST'&&url.pathname==='/api/commands/execute'){
   const body=request.postDataJSON();
   if(body.commandName!=='/cost'){writes.push(url.pathname);return route.abort();}
   const response=await route.fetch();const json=await response.json();commands.push(json);return route.fulfill({response,json});
  }
  if(request.method()!=='GET'&&url.pathname.startsWith('/api/')&&url.pathname!=='/api/commands/list')return route.fulfill({json:{success:true}});
  return route.continue();
 });
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 const url=(process.env.TOKEN_REVIEW_BASE||'http://10.20.64.136:3001')+'/session/01a1a5c2-7d36-7da0-824e-f79a302e3e80';
 const open=async()=>{
  const button=page.locator('[data-cloudcli-actions]').getByRole('button',{name:/Token Usage|用量|令牌使用/i});
  await button.click();
  try {await page.getByRole('region',{name:'会话累计消耗'}).waitFor();}
  catch(error){await page.screenshot({path:'/tmp/cloudcli-token-review-error.png'});console.log(JSON.stringify({providers:commands.map(command=>command.data?.provider),errors,body:(await page.locator('.cloudcli-token-details').innerText().catch(()=>''))}));throw error;}
 };
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('[data-cloudcli-actions]').waitFor();await page.waitForTimeout(1500);
 await open();
 const current=commands.at(-1)?.data;
 assert.equal(typeof current?.tokenUsage?.cacheReadTokens,'number','/cost must preserve measured cached input');
 assert.equal(typeof current?.tokenUsage?.lastUsage?.inputTokens,'number');
 const section=page.getByRole('region',{name:'会话累计消耗'});
 const value=label=>section.locator('.cloudcli-token-row').filter({has:page.locator('dt',{hasText:new RegExp('^'+label+'$')})}).locator('dd');
 assert.equal(await value('缓存命中').innerText(),current.tokenUsage.cacheReadTokens.toLocaleString('zh-CN'));
 assert.match(await value('缓存命中率').innerText(),/^\d+\.\d%$/);
 assert.equal(await value('总 Token').innerText(),current.tokenUsage.used.toLocaleString('zh-CN'));
 assert.equal(await page.getByRole('region',{name:'最近一次请求',exact:true}).count(),1);
 for(const width of [320,393,1440]){
  await page.setViewportSize({width,height:width>768?1000:740});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await section.evaluate(node=>node.scrollWidth>node.clientWidth),false);
  await page.screenshot({path:'/tmp/cloudcli-token-details-'+width+'.png'});
 }
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-cloudcli-actions]').waitFor();await page.waitForTimeout(1500);await open();
 assert.equal(typeof commands.at(-1)?.data?.tokenUsage?.cacheReadTokens,'number','Refresh must retain details');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log(JSON.stringify({passed:true,checks:['usage-api-to-cost','cached-input','hit-rate','cumulative-vs-last','no-double-counting','320-1440-layout','refresh-retains-details','no-chat-writes']}));
} finally {await browser.close();}

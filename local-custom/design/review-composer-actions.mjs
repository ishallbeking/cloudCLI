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
 const writes=[];
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.hostname!=='10.20.64.136')return route.abort();
  if(r.method()==='POST'&&u.pathname==='/api/commands/list')return route.continue(); // Read-only discovery endpoint.
  if(r.method()!=='GET'&&u.pathname==='/api/user/drafts')return route.fulfill({json:{success:true}}); // Keep verification drafts local.
  if(r.method()!=='GET'&&u.pathname.startsWith('/api/')){writes.push(u.pathname);return route.abort();}
  if(process.env.COMPOSER_REVIEW_HTML&&r.isNavigationRequest())return route.fulfill({contentType:'text/html',body:await fs.readFile(process.env.COMPOSER_REVIEW_HTML,'utf8')});
  if(process.env.COMPOSER_REVIEW_CSS&&u.pathname==='/styles/cloudcli-modern.css')return route.fulfill({contentType:'text/css',body:await fs.readFile(process.env.COMPOSER_REVIEW_CSS,'utf8')});
  return route.continue();
 });
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://10.20.64.136:3001/session/01a12419-2111-71e3-a2c8-b482b2d4081f',{waitUntil:'domcontentloaded'});
 await page.locator('[data-cloudcli-actions]').waitFor({timeout:30000});
 const plus=page.getByRole('button',{name:'添加附件、命令或定时发送',exact:true}),textbox=page.locator('[data-slot="prompt-input-textarea"]');
 const open=async()=>{if(await plus.getAttribute('aria-expanded')!=='true')await plus.click();await page.getByRole('menu',{name:'添加到消息',exact:true}).waitFor();};
 await open();assert.equal(await page.getByRole('menuitem').count(),3);
 assert.equal(await page.getByRole('menuitem',{name:'定时发送',exact:true}).isDisabled(),true);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu',{name:'添加到消息',exact:true}).count(),0);
 // File chooser proves the original attachment handler is retained, without uploading.
 await open();const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'附加文件',exact:true}).click();await chooserPromise;
 assert.equal(await page.getByRole('menu',{name:'添加到消息',exact:true}).count(),0);
 await open();await page.getByRole('menuitem',{name:'显示所有命令',exact:true}).click();
 await page.getByText(/^built-in commands$/i).waitFor();await page.getByText('/help',{exact:true}).waitFor();await page.screenshot({path:prefix+'-commands.png'});
 // Dismiss command list with its existing input keyboard behavior.
 await textbox.press('Escape');await textbox.fill('布局验证草稿，不发送');
 await open();await page.getByRole('menuitem',{name:'定时发送',exact:true}).click();await page.locator('#schedule-at').waitFor();
 await page.locator('#schedule-at').fill('2027-01-01T12:00');assert.equal(await page.locator('#schedule-at').inputValue(),'2027-01-01T12:00');
 const scheduleBox=await page.locator('#schedule-at').boundingBox();assert.ok(scheduleBox.x>=0&&scheduleBox.x+scheduleBox.width<=393);
 await page.screenshot({path:prefix+'-schedule.png'});await page.keyboard.press('Escape');
 assert.equal(await page.locator('#schedule-at').count(),0);
 assert.equal(await textbox.inputValue(),'布局验证草稿，不发送');assert.equal(await page.locator('.cloudcli-composer-send > button').isDisabled(),false);
 await open();await page.getByRole('menuitem',{name:'定时发送',exact:true}).click();await page.locator('#schedule-at').waitFor();await textbox.click();assert.equal(await page.locator('#schedule-at').count(),0);assert.equal(await page.getByRole('menu',{name:'添加到消息',exact:true}).count(),0);
 await plus.focus();await page.keyboard.press('ArrowDown');await page.waitForTimeout(50);assert.equal(await page.locator(':focus').getAttribute('role'),'menuitem');
 await page.keyboard.press('ArrowDown');assert.ok((await page.locator(':focus').innerText()).includes('显示所有命令'));await page.keyboard.press('Escape');
 const sizes=[];
 for(const width of [320,360,393,430,768,1440]){
  await page.setViewportSize({width,height:width>=768?1000:740});await page.waitForTimeout(350);
  const size=await page.evaluate(()=>{
   const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};
   return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,body:box('.cloudcli-composer-writing'),plus:box('.cloudcli-composer-plus'),text:box('[data-slot="prompt-input-textarea"]'),send:box('.cloudcli-composer-send > button'),form:box('[data-cloudcli-actions]')};
  });
  assert.equal(size.overflow,false);assert.ok(size.plus.x+size.plus.w<=size.text.x+1);assert.ok(size.send.x>=size.text.x+size.text.w-1);assert.ok(size.send.x+size.send.w<=size.form.x+size.form.w);
  assert.ok(size.send.y>=size.body.y&&size.send.y+size.send.h<=size.body.y+size.body.h);sizes.push(size);
  if(width===393||width===1440)await page.screenshot({path:prefix+'-'+width+'.png'});
 }
 await page.setViewportSize({width:393,height:480});await textbox.focus();await page.waitForTimeout(300);const form=await page.locator('[data-cloudcli-actions]').boundingBox();assert.ok(form.y>=0&&form.y+form.height<=481);
 await page.setViewportSize({width:393,height:740});await textbox.fill('');await textbox.blur();await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:prefix+'-dark.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 const result={passed:true,errors,sizes,checks:['three-actions','empty-schedule-disabled','file-chooser','commands-click','schedule-picker','escape','keyboard-menu','draft-retained','left-plus-right-send-inside-body','mobile-desktop-no-overflow','keyboard-space','dark','no-api-writes']};
 await fs.writeFile(prefix+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}

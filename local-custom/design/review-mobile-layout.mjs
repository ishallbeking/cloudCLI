// Read-only layout review against real history; no prompts or approval replies.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
const token=generateToken(userDb.getFirstUser());closeConnection();
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const output=process.env.MOBILE_REVIEW_PREFIX||'/tmp/cloudcli-mobile-before';
try{
 const context=await browser.newContext({viewport:{width:393,height:740},isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'zh-CN'});
 await context.addInitScript(token=>{localStorage.setItem('auth-token',token);},token);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='10.20.64.136')return route.abort();
  if(request.method()!=='GET'&&url.pathname.startsWith('/api/'))return route.abort();
  if(process.env.MOBILE_REVIEW_HTML&&request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:await fs.readFile(process.env.MOBILE_REVIEW_HTML,'utf8')});
  if(process.env.MOBILE_REVIEW_CSS&&url.pathname==='/styles/cloudcli-modern.css')return route.fulfill({contentType:'text/css',body:await fs.readFile(process.env.MOBILE_REVIEW_CSS,'utf8')});
  return route.continue();
 });
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://10.20.64.136:3001/session/01a1a5c2-7d36-7da0-824e-f79a302e3e80',{waitUntil:'domcontentloaded'});
 await page.locator('[data-slot="prompt-input-footer"]').waitFor({timeout:30000});await page.waitForTimeout(1200);
 const results=[];
 for(const width of [393,360,320,430,640,768,1440]){
  await page.setViewportSize({width,height:width>=768?1000:740});await page.waitForTimeout(400);
  results.push(await page.evaluate(()=>{
   const box=el=>el?{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}:null;
   const footer=document.querySelector('[data-slot="prompt-input-footer"]');
   return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,header:box(document.querySelector('header.pwa-header-safe')),composer:box(document.querySelector('[data-slot="prompt-input"]')),footer:box(footer),footerHTML:footer?.outerHTML,headerHTML:document.querySelector('header.pwa-header-safe')?.outerHTML,controls:[...footer.querySelectorAll('button,.cloudcli-context-meter')].map(b=>({label:b.getAttribute('aria-label')||b.title||b.innerText,rect:box(b),visible:!!b.getClientRects().length})),fixed:[...document.querySelectorAll('button')].filter(b=>getComputedStyle(b).position==='fixed').map(b=>({html:b.outerHTML,rect:box(b)}))};
  }));
  if(width===393||width===1440)await page.screenshot({path:output+'-'+width+'.png'});
 }
 if(process.env.MOBILE_REVIEW_VERIFY==='1'){
  for(const result of results){
   assert.equal(result.overflow,false,`Horizontal page overflow at ${result.width}`);
   for(const control of result.controls.filter(c=>c.visible)){
    assert.ok(control.rect.x>=result.footer.x-1 && control.rect.x+control.rect.w<=result.footer.x+result.footer.w+1,`Control outside footer at ${result.width}`);
   }
   if(result.width<640){
    assert.ok(result.header.h<=65,'Compact phone header');
    const controls=result.controls.filter(c=>c.visible);
    assert.equal(controls.filter(c=>c.label.includes('Select model'))[0].rect.w>=110,true,'Readable model name');
   }
  }
  console.log('Viewport geometry passed');
  await page.setViewportSize({width:393,height:740});await page.waitForTimeout(300);
  const footer=page.locator('[data-slot="prompt-input-footer"]');
  const textbox=page.locator('[data-slot="prompt-input-textarea"]');
  await textbox.fill('手机排版验证，不发送');
  console.log('Model menu');
  await footer.getByRole('button',{name:'Select model and reasoning effort',exact:true}).click();
  await page.getByRole('menu').waitFor();
  const menuBox=await page.getByRole('menu').boundingBox();assert.ok(menuBox.x>=0&&menuBox.x+menuBox.width<=393);
  await page.keyboard.press('Escape');
  console.log('Permission menu');
  await footer.getByRole('button',{name:/如何批准 Codex/}).click();await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');
  console.log('Schedule menu');
  await page.getByRole('button',{name:'添加附件、命令或定时发送',exact:true}).click();await page.getByRole('menuitem',{name:'定时发送',exact:true}).click();await page.locator('#schedule-at').waitFor();await page.keyboard.press('Escape');
  console.log('Quick settings');
  const handle=page.getByRole('button',{name:'打开设置面板',exact:true});await handle.click();await page.getByRole('button',{name:'关闭设置面板',exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭设置面板',exact:true}).click();
  // Viewport shrink models the space available above an on-screen keyboard.
  await page.setViewportSize({width:393,height:480});await textbox.focus();await page.waitForTimeout(400);
  const composer=await page.locator('[data-slot="prompt-input"]').boundingBox();assert.ok(composer.y>=0&&composer.y+composer.height<=481);
  await textbox.fill('');await textbox.blur();await page.setViewportSize({width:393,height:740});
  await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:output+'-dark.png'});
  assert.deepEqual(errors,[]);
 }
 await fs.writeFile(output+'.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({output,errors,summary:results.map(({width,overflow,header,composer,footer,controls})=>({width,overflow,header,composer,footer,controls}))}));
}finally{await browser.close();}

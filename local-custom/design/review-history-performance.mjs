// Read-only candidate verification: no prompts, answers, approvals, or live data writes.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
const token=generateToken(userDb.getFirstUser());closeConnection();
const base='http://10.20.64.136:3001',id='01a12419-2111-71e3-a2c8-b482b2d4081f';
const candidate=await fs.readFile(process.env.CLOUDCLI_CANDIDATE_HTML || new URL('../package/dist/index.html',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(token=>localStorage.setItem('auth-token',token),token);
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='10.20.64.136')return route.abort();if(route.request().isNavigationRequest())return route.fulfill({status:200,contentType:'text/html',body:candidate});if(route.request().method()!=='GET'&&u.pathname.startsWith('/api/'))return route.abort();return route.continue();});
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/messages|\/navigation/.test(r.url()))requests.push(r.url())});
 await page.goto(`${base}/session/${id}`,{waitUntil:'domcontentloaded'});await page.locator('[data-nav-id]').first().waitFor({timeout:30000});await page.waitForTimeout(800);
 // Block live-tail history reads; browsing uses its own anchored requests.
 let held=false,release;const gate=new Promise(r=>release=r);
 await context.route(`**/sessions/${id}/messages?*`,async route=>{held=true;await gate;await route.continue().catch(()=>{});});
 const oldCount=requests.length;
 const t=performance.now();await page.locator('.chat-messages-pane').evaluate(p=>{p.scrollTop=0;p.dispatchEvent(new Event('scroll'));});
 await page.locator('.cloudcli-nav-controls').getByRole('button',{name:'回到最新',exact:true}).waitFor({timeout:15000});
 await page.waitForFunction(()=>!document.querySelector('.chat-messages-pane')?.innerText.includes('Loading earlier messages')&&!document.querySelector('.cloudcli-nav-controls')?.innerText.includes('正在定位'));
 const olderMs=Math.round(performance.now()-t);
 assert.ok(requests.slice(oldCount).some(u=>u.includes('direction=before')));
 assert.ok(!requests.slice(oldCount).some(u=>/messages\?.*offset=(?!0\b)/.test(u)));
 // Continue scrolling within the historical window, still without tail-offset reads.
 await page.waitForTimeout(400);
 const beforeRequests=requests.filter(u=>u.includes('direction=before')).length;
 await page.locator('.chat-messages-pane').evaluate(p=>{p.scrollTop=150;p.dispatchEvent(new Event('scroll'));p.scrollTop=0;p.dispatchEvent(new Event('scroll'));});
 await page.waitForFunction(()=>!document.querySelector('.cloudcli-nav-controls')?.innerText.includes('正在定位'));
 await page.waitForTimeout(400);
 assert.ok(requests.filter(u=>u.includes('direction=before')).length>beforeRequests);
 // Locate first / middle / last turns, retaining bounded rows and stable anchors.
 release();await context.unroute(`**/sessions/${id}/messages?*`);
 const ids=await page.locator('[data-nav-id]').evaluateAll(rows=>rows.map(r=>r.dataset.navId));
 const jumps=[];
 async function jump(anchor){const b=page.locator(`[data-nav-id="${anchor}"]`);await b.scrollIntoViewIfNeeded();const t=performance.now();await b.click();await page.waitForFunction(anchor=>{const p=document.querySelector('.chat-messages-pane');const row=Array.from(p?.querySelectorAll('[data-message-row-id]')||[]).find(r=>r.dataset.messageRowId===anchor);if(!row)return false;const y=row.getBoundingClientRect().top-p.getBoundingClientRect().top;return y>=-5&&y<p.clientHeight-20;},anchor,{timeout:15000});jumps.push(Math.round(performance.now()-t));assert.ok(await page.locator('[data-message-row-id]').count()<=240);}
 for(const index of [0,Math.floor(ids.length/2),ids.length-1])await jump(ids[index]);
 // A repeated target inside the current window should not issue a request.
 await page.waitForTimeout(250);const count=requests.filter(u=>u.includes('anchor=')).length;await jump(ids.at(-1));assert.equal(requests.filter(u=>u.includes('anchor=')).length,count);
 await page.getByRole('button',{name:'回到最新',exact:true}).click();await page.locator('.cloudcli-nav-controls').waitFor({state:'detached'});
 // A failed/timed-out request clears loading, can be dismissed, and can be retried.
 await context.route('**/navigation?*',route=>route.fulfill({status:503,json:{error:'test'}}));
 const first=page.locator(`[data-nav-id="${ids[0]}"]`);await first.scrollIntoViewIfNeeded();await first.click();await page.getByText('暂时无法加载对话导航，请重试',{exact:true}).waitFor();assert.equal(await page.getByText('正在定位…',{exact:true}).count(),0);
 await context.unroute('**/navigation?*');await page.locator('.cloudcli-nav-controls').getByRole('button',{name:'关闭',exact:true}).click();await jump(ids[0]);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-nav-id]').first().waitFor();assert.equal(await page.locator('.cloudcli-nav-controls').count(),0);assert.deepEqual(errors,[]);
 const result={passed:true,totalTurns:ids.length,olderMs,jumpMs:jumps,checks:['older-read-uses-native-anchor','no-tail-offset-queue','first-middle-last-visible','bounded-rows','repeat-jump-no-fetch','return-latest','failure-clear-retry','refresh','no-page-errors']};
 await fs.writeFile('/tmp/cloudcli-history-browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}

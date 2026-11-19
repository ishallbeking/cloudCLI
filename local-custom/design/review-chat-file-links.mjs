// Read-only: clicks existing file links; never sends a prompt or saves a file.
import {chromium} from 'playwright-core';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const token=generateToken(userDb.getFirstUser());closeConnection();
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,env:{...process.env,LC_ALL:'en_US.utf8',LANG:'en_US.utf8',GCONV_PATH:new URL('../runtime/glibc/usr/lib/x86_64-linux-gnu/gconv',import.meta.url).pathname},args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
await context.addInitScript(t=>localStorage.setItem('auth-token',t),token);
await context.route('**/*',route=>(new URL(route.request().url()).hostname==='10.20.64.136'||route.request().url().startsWith('blob:'))?route.continue():route.abort());
const page=await context.newPage(), requests=[],errors=[];
// Record the real anchor attributes before the native download. This server's
// isolated Chromium/libc falls back to "download" for Unicode suggested names.
await context.addInitScript(()=>{const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__cloudcliLastDownload={href:this.href,name:this.download};return original.call(this)}});
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.url().includes('/file?')||r.url().includes('/files/content?'))requests.push({url:r.url(),status:r.status()})});
try{
 await page.goto('http://10.20.64.136:3001/session/0613137a-9764-4a37-b755-1b85a7452dc8',{waitUntil:'domcontentloaded'});
 const link=page.getByRole('link',{name:'拟合曲线对照数据：15 个样品',exact:true});
 await link.waitFor({state:'attached',timeout:30000});
 const href=await link.getAttribute('href');
 await link.click();await page.waitForTimeout(1800);
 const editor=await page.locator('.cm-content').allTextContents();
 assert.equal(requests.at(-1).status,200);assert.ok(editor.join('').includes('Sample01_Target'));
 const samples=[{kind:'csv',path:new URL(requests.at(-1).url).searchParams.get('filePath')}];
 const doc=page.getByRole('link',{name:'逐样品 CN 数值与详细说明',exact:true});
 await doc.click();await page.waitForTimeout(1200);
 assert.equal(requests.at(-1).status,200);
 assert.ok(!(await page.locator('.cm-content').allTextContents()).join('').includes('Error loading file'));
 samples.push({kind:'markdown',status:requests.at(-1).status});
 const pdf=page.locator('.chat-message a').filter({hasText:/^PDF$/}).first();
 await pdf.click();await page.waitForTimeout(1000);
 const pdfFrame=page.locator('iframe').last();
 assert.ok((await pdfFrame.getAttribute('src')).startsWith('blob:'));
 samples.push({kind:'pdf',status:requests.at(-1).status});
 await page.getByRole('link',{name:'全部数据打包下载',exact:true}).click();
 const downloadPromise=page.waitForEvent('download',{predicate:d=>!d.suggestedFilename().endsWith('.pdf'),timeout:30000});
 await page.getByRole('button',{name:'下载文件',exact:true}).click();
 const download=await downloadPromise;
 const expected='/home/claw/zc/codex/RMC/gxw/TEM_拟合曲线与末帧CN_作图数据_20261119.zip';
 assert.equal(await page.evaluate(()=>window.__cloudcliLastDownload.name),expected.split('/').pop());
 assert.equal(await download.failure(),null);
 const downloaded=await fs.readFile(await download.path());
 const original=await fs.readFile(expected);
 assert.equal(createHash('sha256').update(downloaded).digest('hex'),createHash('sha256').update(original).digest('hex'));
 samples.push({kind:'zip',bytes:downloaded.length,identical:true});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,samples,errors}));
 await fs.writeFile('/tmp/cloudcli-file-links-result.json',JSON.stringify({passed:true,href,requests,errors,samples},null,2));
}finally{await browser.close()}

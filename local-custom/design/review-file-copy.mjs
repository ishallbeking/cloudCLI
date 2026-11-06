// Deployed UI + real file API; creates and removes only an isolated test folder.
import {chromium} from 'playwright-core';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const token=generateToken(userDb.getFirstUser());closeConnection();
const url=process.env.CLOUDCLI_TEST_URL || 'http://127.0.0.1:3001';
const projectName=process.env.CLOUDCLI_TEST_PROJECT_NAME || 'claw';
const projectPath=process.env.CLOUDCLI_TEST_PROJECT_PATH || process.env.HOME;
const root=await fs.mkdtemp(path.join(projectPath,'cloudcli-copy-check-'));
await fs.mkdir(path.join(root,'source/nested'),{recursive:true});
await fs.mkdir(path.join(root,'destination'));
await fs.writeFile(path.join(root,'source/nested/data.bin'),Buffer.from([0,1,128,255]));
await fs.writeFile(path.join(root,'hello.txt'),'clipboard test 你好\n');
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer']});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
await context.addInitScript(token=>localStorage.setItem('auth-token',token),token);
await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const tree=page.getByTestId('project-file-tree');
const row=relative=>tree.locator(`[data-tree-path="${path.join(root,relative)}"]`);
const menu=()=>page.getByRole('menu',{name:'文件上下文菜单'});
const copyMenu=()=>page.getByRole('menuitem',{name:'复制 Ctrl+C',exact:true});
const pasteMenu=()=>page.getByRole('menuitem',{name:'粘贴 Ctrl+V',exact:true});
async function open(){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByTitle(projectName,{exact:true}).click();
  await page.getByRole('tab',{name:'文件',exact:true}).click();
  await tree.waitFor();await row('').click();await row('hello.txt').waitFor();
}
async function paste(target='destination'){
  await row(target).click({button:'right'});
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/files/copy'));
  await pasteMenu().click();
  const result=await response;
  assert.equal(result.status(),200,await result.text());
  return result.json();
}
try{
  await open();
  // The private file clipboard also works in insecure LAN HTTP deployments.
  await row('hello.txt').click({button:'right'});assert.equal(await pasteMenu().isDisabled(),true);
  await copyMenu().click();
  const first=await paste();assert.equal(first.name,'hello.txt');
  assert.equal(await fs.readFile(path.join(root,'destination/hello.txt'),'utf8'),'clipboard test 你好\n');
  await row('destination').waitFor();await row('destination').click();await row('destination/hello.txt').waitFor();
  const second=await paste();assert.equal(second.name,'hello (副本).txt');await row('destination/hello (副本).txt').waitFor();
  // A collapsed folder still copies all nested contents.
  await row('source').click({button:'right'});await copyMenu().click();
  const folder=await paste();assert.equal(folder.name,'source');
  assert.deepEqual(await fs.readFile(path.join(root,'destination/source/nested/data.bin')),Buffer.from([0,1,128,255]));
  await row('source').click({button:'right'});await page.keyboard.press('Escape');
  await page.keyboard.press('Control+c');
  await row('destination').click({button:'right'});await page.keyboard.press('Escape');
  const keyboardResponse=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/files/copy'));
  await page.keyboard.press('Control+v');assert.equal((await keyboardResponse).status(),200);
  assert.deepEqual(await fs.readFile(path.join(root,'destination/source (副本)/nested/data.bin')),Buffer.from([0,1,128,255]));
  // Refresh preserves the private clipboard; no browser clipboard permission needed.
  await open();const afterRefresh=await paste();assert.equal(afterRefresh.name,'source (副本 2)');
  // Source deletion must show an error and permit a subsequent successful retry.
  await row('hello.txt').click({button:'right'});await copyMenu().click();
  await fs.unlink(path.join(root,'hello.txt'));
  await row('destination').click({button:'right'});
  const failedResponse=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/files/copy'));
  await pasteMenu().click();assert.equal((await failedResponse).ok(),false);
  await page.getByText(/ENOENT|不存在|not found/i).filter({visible:true}).first().waitFor();
  await fs.writeFile(path.join(root,'hello.txt'),'restored');
  const retry=await paste();assert.equal(retry.name,'hello (副本 2).txt');
  assert.equal(await fs.readFile(retry.path,'utf8'),'restored');
  // Copy/paste shortcuts in an editor retain ordinary text editing behavior.
  await row('hello.txt').click();await page.locator('.cm-content').filter({visible:true}).waitFor();
  let copyRequests=0;const count=request=>{if(new URL(request.url()).pathname.endsWith('/files/copy'))copyRequests++;};page.on('request',count);
  await page.locator('.cm-content').filter({visible:true}).focus();await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(150);assert.equal(copyRequests,0);page.off('request',count);
  await row('destination').click({button:'right'});
  const bounds=await page.getByRole('menu').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=1000);
  await page.screenshot({path:new URL('./file-copy-desktop.png',import.meta.url).pathname});
  assert.deepEqual(errors,[]);
  const result={passed:true,scope:'Real deployed LAN HTTP page and real file API; isolated temporary folder; no model calls',checks:['right-click-copy-paste','keyboard-copy-paste','full-collapsed-folder','binary-integrity','same-name-no-overwrite','automatic-tree-refresh','clipboard-after-refresh','failure-and-retry','editor-shortcuts-isolated','menu-stays-in-viewport','no-browser-errors']};
  await fs.writeFile(new URL('./file-copy-result.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:new URL('./file-copy-error.png',import.meta.url).pathname}).catch(()=>{});throw error;}
finally{await browser.close();await fs.rm(root,{recursive:true,force:true});}

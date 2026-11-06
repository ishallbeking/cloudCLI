// Read-only deployed UI, with deterministic file metadata and lazy directories.
import {chromium} from 'playwright-core';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const token=generateToken(userDb.getFirstUser());closeConnection();
const url=process.env.CLOUDCLI_TEST_URL || 'http://127.0.0.1:3001';
const projectName=process.env.CLOUDCLI_TEST_PROJECT_NAME || 'claw';
const base=process.env.CLOUDCLI_TEST_PROJECT_PATH || process.env.HOME;
const file=(name,size,day,parent=base)=>({name,path:`${parent}/${name}`,type:'file',size,modified:day?`2026-11-${day}T10:00:00.000Z`:null,permissionsRwx:'rw-r--r--'});
const folder=(name,day)=>({...file(name,4096,day),type:'directory',childrenLoaded:false});
const roots=[file('file10.txt',4,'02'),folder('folder10','01'),file('file2.txt',1000,'04'),file('file1.txt',50,'03'),folder('folder2','05'),file('unknown.txt',null,null)];
const children=[file('child10.txt',30,'01',base+'/folder2'),file('child2.txt',10,'04',base+'/folder2'),file('child1.txt',20,'02',base+'/folder2')];
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
await context.addInitScript(token=>localStorage.setItem('auth-token',token),token);
await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
let loads=0;
await context.route('**/api/file-tree/projects/*/files?*',async route=>{
  const directory=new URL(route.request().url()).searchParams.get('directory');
  if(directory===base+'/folder2')loads++;
  return route.fulfill({json:directory===base+'/folder2'?children:directory?[]:roots});
});
const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const tree=page.getByTestId('project-file-tree');
const column=key=>tree.locator(`[data-file-sort="${key}"]`);
const order=async(parent=base)=>tree.locator('[data-tree-path]').evaluateAll((nodes,parent)=>nodes.map(n=>n.getAttribute('data-tree-path')).filter(p=>p.slice(0,p.lastIndexOf('/'))===parent).map(p=>p.slice(p.lastIndexOf('/')+1)),parent);
const check=async(expected,parent=base)=>assert.deepEqual(await order(parent),expected);
async function open(){
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.getByTitle(projectName,{exact:true}).click();
 await page.getByRole('tab',{name:'文件',exact:true}).click();
 await column('name').waitFor();
}
try{
 await open();
 await check(['folder2','folder10','file1.txt','file2.txt','file10.txt','unknown.txt']);
 await column('name').click();assert.equal(await column('name').getAttribute('data-sort-direction'),'desc');
 await check(['folder10','folder2','unknown.txt','file10.txt','file2.txt','file1.txt']);
 await column('name').click();await check(['folder2','folder10','file1.txt','file2.txt','file10.txt','unknown.txt']);
 await column('size').click();await check(['folder2','folder10','file2.txt','file1.txt','file10.txt','unknown.txt']);
 await column('size').click();await check(['folder2','folder10','file10.txt','file1.txt','file2.txt','unknown.txt']);
 await column('modified').click();await check(['folder2','folder10','file2.txt','file1.txt','file10.txt','unknown.txt']);
 await column('modified').click();await check(['folder10','folder2','file10.txt','file1.txt','file2.txt','unknown.txt']);
 // Newly loaded descendants inherit the chosen ordering without flattening.
 await tree.locator(`[data-tree-path="${base}/folder2"]`).click();
 await tree.locator(`[data-tree-path="${base}/folder2/child1.txt"]`).waitFor();
 await check(['child10.txt','child1.txt','child2.txt'],base+'/folder2');
 await column('size').click();await check(['child10.txt','child1.txt','child2.txt'],base+'/folder2');
 await column('size').click();await check(['child2.txt','child1.txt','child10.txt'],base+'/folder2');
 assert.equal(loads,1,'Sorting does not refetch or collapse loaded directories');
 const input=tree.getByPlaceholder('搜索文件和文件夹...');
 await input.fill('child');await check(['child2.txt','child1.txt','child10.txt'],base+'/folder2');await input.fill('');
 // Rebuilding data after refresh retains the order and the existing copy menu.
 await tree.getByRole('button',{name:'刷新',exact:true}).click();
 await tree.locator(`[data-tree-path="${base}/folder2/child1.txt"]`).waitFor();
 await check(['child2.txt','child1.txt','child10.txt'],base+'/folder2');
 await tree.locator(`[data-tree-path="${base}/file1.txt"]`).click({button:'right'});
 await page.getByRole('menuitem',{name:'复制 Ctrl+C',exact:true}).waitFor();await page.keyboard.press('Escape');
 await open();assert.equal(await column('size').getAttribute('data-sort-direction'),'asc');
 await check(['folder2','folder10','file10.txt','file1.txt','file2.txt','unknown.txt']);
 await page.screenshot({path:new URL('./file-sort-desktop.png',import.meta.url).pathname});
 await page.evaluate(()=>document.documentElement.classList.add('dark'));
 await page.setViewportSize({width:390,height:844});await column('modified').click();
 assert.ok(await column('name').isVisible());assert.ok(await column('size').isVisible());
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:new URL('./file-sort-mobile.png',import.meta.url).pathname});
 assert.deepEqual(errors,[]);
 const result={passed:true,scope:'Read-only deployed UI with controlled metadata; no file writes or model calls',checks:['name-natural-order-both-directions','numeric-size-both-directions','modified-date-both-directions','missing-metadata-last','folder-first-hierarchy','lazy-children-inherit-sort','search-and-refresh','sort-persists-on-reload','copy-menu-preserved','dark-mobile-layout','no-browser-errors']};
 await fs.writeFile(new URL('./file-sort-result.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:new URL('./file-sort-error.png',import.meta.url).pathname}).catch(()=>{});throw error;}
finally{await browser.close();}

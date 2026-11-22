// Read-only post-release check: never registers/logs out a real user or sends a prompt.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import '../package/dist-server/server/load-env.js';
import {userDb,closeConnection} from '../package/dist-server/server/modules/database/index.js';
import {generateToken} from '../package/dist-server/server/modules/auth/auth.middleware.js';
const user=userDb.getFirstUser(),token=generateToken(user);closeConnection();
const browser=await chromium.launch({executablePath:new URL('./chromium',import.meta.url).pathname,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(token=>localStorage.setItem('auth-token',token),token);
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='10.20.64.136'?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://10.20.64.136:3001/',{waitUntil:'domcontentloaded'});
 await page.getByTestId('sidebar-footer').waitFor({timeout:20000});
 await page.getByRole('button',{name:/^Settings$|^设置$/}).last().click();
 await page.getByRole('button',{name:'账号',exact:true}).filter({visible:true}).click();
 await page.getByTestId('account-settings').waitFor();
 assert.equal(await page.getByTestId('account-username').innerText(),user.username);
 await page.getByLabel('确认密码',{exact:true}).waitFor();
 await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 await fs.writeFile(new URL('../data/accounts-live-result.json',import.meta.url),JSON.stringify({passed:true,checks:['account-tab-visible','current-user-matches','register-form-visible','logout-visible','no-page-errors'],checkedAt:new Date().toISOString()},null,2));
 console.log('Live account settings verified (read-only)');
}finally{await browser.close();}

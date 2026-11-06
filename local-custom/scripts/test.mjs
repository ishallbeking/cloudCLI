import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=[...(await fs.readdir(new URL('../tests/',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).map(name=>'tests/'+name),
  ...(await fs.readdir(new URL('../design/',import.meta.url))).filter(name=>name.startsWith('test-')&&name.endsWith('.mjs')).map(name=>'design/'+name),
  'package/dist-server/server/modules/file-tree/tests/file-tree.routes.test.js',
  'package/dist-server/server/modules/file-tree/tests/file-tree.service.test.js',
  'package/dist-server/server/modules/providers/tests/provider-token-usage.service.test.js',
  'package/dist-server/server/modules/providers/tests/provider-capabilities.service.test.js',
  'package/dist-server/server/modules/websocket/tests/chat-background-subscribe.test.js'];
const child=spawn(process.execPath,['--test',...tests],{cwd:root,env:process.env,stdio:'inherit'});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});

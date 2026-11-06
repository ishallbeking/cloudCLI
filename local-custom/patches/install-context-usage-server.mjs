import fs from 'node:fs/promises';
const root=new URL('../package/',import.meta.url);
export async function installContextUsageServer(){
  async function patch(file,before,after){
    const url=new URL(file,root);let code=await fs.readFile(url,'utf8');
    if(code.includes(after))return;
    if(code.split(before).length!==2)throw new Error(`Context usage upstream changed: ${file}: ${before.slice(0,80)}`);
    const backup=new URL('./backups-context-usage/'+file,import.meta.url);
    await fs.mkdir(new URL('.',backup),{recursive:true});
    try{await fs.writeFile(backup,code,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
    await fs.writeFile(url,code.replace(before,after));
  }
  const codex='modules/providers/list/codex/';
  for(const tree of ['server/','dist-server/server/']){
    const ts=tree==='server/';
    const sessions=tree+codex+`codex-sessions.provider.${ts?'ts':'js'}`;
    await patch(sessions,"import { createHash } from 'node:crypto';","import { createHash } from 'node:crypto';\nimport { readCodexContextUsed } from './codex-context-usage.js';");
    await patch(sessions,'tokenUsage = { used: usage.total_tokens || 0, total: info.model_context_window || 200000 };',
      'tokenUsage = { used: usage.total_tokens || 0, total: info.model_context_window || 200000, contextUsed: readCodexContextUsed(info.last_token_usage) };');
    const runtime=tree+codex+'codex-interactive-runtime.js';
    await patch(runtime,"import { randomUUID } from 'node:crypto';","import { randomUUID } from 'node:crypto';\nimport { readCodexContextUsed } from './codex-context-usage.js';");
    await patch(runtime,'total: usage.modelContextWindow || 200000, inputTokens: usage.total.inputTokens, outputTokens: usage.total.outputTokens',
      'total: usage.modelContextWindow || 200000, contextUsed: readCodexContextUsed(usage.last), inputTokens: usage.total.inputTokens, outputTokens: usage.total.outputTokens');
    const service=tree+`modules/providers/services/provider-token-usage.service.${ts?'ts':'js'}`;
    await patch(service,"import Database from 'better-sqlite3';","import Database from 'better-sqlite3';\nimport { readCodexContextUsed } from '../list/codex/codex-context-usage.js';");
    const indent=ts?'        ':'                ';
    await patch(service,'total: readUsageNumber(tokenInfo.model_context_window) || 200_000,',
      'total: readUsageNumber(tokenInfo.model_context_window) || 200_000,\n'+indent+'...(readCodexContextUsed(tokenInfo.last_token_usage) !== null ? { contextUsed: readCodexContextUsed(tokenInfo.last_token_usage) } : {}),');
    if(ts)await patch(service,'type TokenUsageResult = {\n  used: number;','type TokenUsageResult = {\n  used: number;\n  contextUsed?: number | null;');
  }
  await fs.copyFile(new URL('server/'+codex+'codex-context-usage.js',root),new URL('dist-server/server/'+codex+'codex-context-usage.js',root));
  console.log('Separate Codex context usage installed');
}
if(process.argv[1]===new URL(import.meta.url).pathname)await installContextUsageServer();

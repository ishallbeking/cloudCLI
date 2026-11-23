import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const code=await fs.readFile(new URL('../patches/token-details-client.js',import.meta.url),'utf8');
const {cloudcliTokenDetailRows:rows}=await import('data:text/javascript,'+encodeURIComponent(code));
const values=usage=>Object.fromEntries(rows(usage).map(row=>[row.label,row.value]));
test('cache hit and reasoning are subsets; reported zero differs from missing',()=>{
 const detail=values({used:1200,inputTokens:1000,outputTokens:200,cacheReadTokens:800,cacheCreationTokens:0,reasoningTokens:120});
 assert.equal(detail['总 Token'],'1,200');assert.equal(detail['缓存命中率'],'80.0%');assert.equal(detail['缓存写入'],'0');assert.equal(detail['其中推理 Token'],'120');
 assert.equal(values({})['缓存命中'],'—');assert.equal(values({inputTokens:0,cacheReadTokens:0})['缓存命中率'],'—');
 assert.equal(values({inputTokens:100,cacheReadTokens:120})['缓存命中率'],'—');
 assert.equal(values({inputTokens:100,outputTokens:20})['总 Token'],'120');
});

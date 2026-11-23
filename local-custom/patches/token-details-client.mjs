import fs from 'node:fs/promises';
export async function patchTokenDetails(client) {
  const replace=(before,after)=>{
    if(client.split(before).length!==2)throw Error('Token details anchor changed: '+before.slice(0,90));
    client=client.replace(before,after);
  };
  replace('Input, output, and total token counts for this session.','输入、输出、缓存命中及推理用量；当前上下文单独展示。');
  const start=client.indexOf('function hZe({data:e}){');
  const end=client.indexOf('function ', start+10);
  if(start<0||end<start||end-start>5000||!client.slice(start,end).includes('Total tokens used'))throw Error('Token details modal boundary changed');
  client=client.slice(0,start)+'function hZe({data:e}){return s.jsx(CloudcliTokenUsageContent,{data:e})}'+client.slice(end);
  return client+'\n'+(await fs.readFile(new URL('./token-details-client.js',import.meta.url),'utf8')).replace('export function','function');
}

import fs from 'node:fs/promises';
export async function installCompressedHistoryServer() {
  const patches=JSON.parse(await fs.readFile(new URL('./compressed-history-server-patches.json',import.meta.url),'utf8'));
  for(const {path: relative,before,after,count=1} of patches) {
    const file=new URL('../package/dist-server/server/'+relative,import.meta.url);
    let code=await fs.readFile(file,'utf8');
    if(code.split(after).length-1===count) continue;
    if(code.split(before).length-1!==count) throw new Error(`Compressed history upstream changed: ${relative}`);
    await fs.writeFile(file,code.replaceAll(before,after));
  }
}

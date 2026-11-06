import fs from 'node:fs/promises';
// Exact reviewed deltas for CloudCLI 1.37.7; never silently patch another build.
export async function installMessageOrderServer() {
  const patches=JSON.parse(await fs.readFile(new URL('./message-order-server-patches.json',import.meta.url),'utf8'));
  for(const file of patches){
    const path=new URL('../package/dist-server/server/'+file.path,import.meta.url);
    let code=await fs.readFile(path,'utf8');
    for(const {before,after} of file.chunks){
      if(code.includes(after))continue;
      if(code.split(before).length!==2)throw new Error(`Message order upstream changed: ${file.path}`);
      code=code.replace(before,after);
    }
    await fs.writeFile(path,code);
  }
}

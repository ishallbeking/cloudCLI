import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const release=JSON.parse(await fs.readFile(path.join(root,'upstream.json'),'utf8'));
const major=Number(process.versions.node.split('.')[0]);
if(major<22)throw new Error('Use Node.js 22 or newer. Set CLOUDCLI_NODE_BIN to a compatible Node executable if needed.');
const args=new Set(process.argv.slice(2));
const packageRoot=path.join(root,'package');
const cache=path.join(root,'.cache');
await fs.mkdir(cache,{recursive:true});
async function run(command,parameters,cwd=root){
  const child=spawn(command,parameters,{cwd,stdio:'inherit',env:process.env});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} exited with code ${code}`)));});
}
const archive=process.env.CLOUDCLI_UPSTREAM_ARCHIVE?path.resolve(process.env.CLOUDCLI_UPSTREAM_ARCHIVE):path.join(cache,`cloudcli-${release.version}.tgz`);
try{await fs.access(archive);}catch{
  if(process.env.CLOUDCLI_UPSTREAM_ARCHIVE)throw new Error('CLOUDCLI_UPSTREAM_ARCHIVE does not exist');
  await run('curl',['--fail','--location','--silent','--show-error','--connect-timeout','20','--max-time','300',release.url,'-o',archive]);
}
const integrity='sha512-'+createHash('sha512').update(await fs.readFile(archive)).digest('base64');
if(integrity!==release.integrity)throw new Error('Upstream package integrity mismatch. No installation files changed.');
try{
  const installed=JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'),'utf8'));
  if(installed.version!==release.version)throw new Error('Existing runtime is a different version; use a clean local-custom checkout.');
}catch(error){if(error.code!=='ENOENT')throw error;}
await fs.mkdir(packageRoot,{recursive:true});
await run('tar',['-xzf',archive,'--strip-components=1','-C',packageRoot]);
for(const entry of release.overlay){
  const relative=entry.path;
  if(path.isAbsolute(relative)||relative.split('/').includes('..'))throw new Error('Invalid overlay path');
  if(entry.upstreamSha256){
    const hash=createHash('sha256').update(await fs.readFile(path.join(packageRoot,relative))).digest('hex');
    if(hash!==entry.upstreamSha256)throw new Error(`Unexpected upstream file: ${relative}`);
  }
  const source=path.join(root,'overlay',relative);
  const hash=createHash('sha256').update(await fs.readFile(source)).digest('hex');
  if(hash!==entry.sha256)throw new Error(`Overlay checksum mismatch: ${relative}`);
  await fs.mkdir(path.dirname(path.join(packageRoot,relative)),{recursive:true});
  await fs.copyFile(source,path.join(packageRoot,relative));
}
await fs.copyFile(path.join(root,'package.runtime.json'),path.join(packageRoot,'package.json'));
await fs.copyFile(path.join(root,'package.runtime-lock.json'),path.join(packageRoot,'package-lock.json'));
// Backend overlays already contain the reviewed final patches. Do not reapply
// historical incremental installers: later patches can split earlier anchors.
await run(process.execPath,[path.join(root,'patches/file-tree-lazy-client.mjs')]);
await fs.mkdir(path.join(packageRoot,'dist/styles'),{recursive:true});
await fs.copyFile(path.join(packageRoot,'public/styles/cloudcli-modern.css'),path.join(packageRoot,'dist/styles/cloudcli-modern.css'));
if(!args.has('--skip-deps')){
  // npm starts Node child processes through PATH. Put this Node first.
  await run(process.env.npm_execpath?process.execPath:'npm',process.env.npm_execpath?[process.env.npm_execpath,'ci','--omit=dev']:['ci','--omit=dev'],packageRoot);
}
await fs.mkdir(path.join(root,'bin'),{recursive:true});
await fs.copyFile(path.join(root,'claude-wrapper.bash'),path.join(root,'bin/claude'));
await fs.chmod(path.join(root,'bin/claude'),0o755);
console.log(`Prepared CloudCLI ${release.version} with local customizations. Run ./local-custom/webui start from the repository root.`);

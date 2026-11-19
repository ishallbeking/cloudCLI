import fs from 'node:fs/promises';
export async function patchChatFileLinks(client) {
  function replace(before,after) {
    if(client.split(before).length!==2)throw new Error(`Chat file links upstream changed: ${before.slice(0,100)}`);
    client=client.replace(before,after);
  }
  client+='\n'+await fs.readFile(new URL('./chat-file-links-client.js',import.meta.url),'utf8');
  replace('const g=m.trim();if(g.endsWith("/")){l(g);return}i(jz(g),s1e(g))',
    'const g=d===m?cloudcliDecodeFileHref(m.trim()):m.trim();if(g.endsWith("/")){l(g);return}i(jz(g),s1e(g))');
  // Binary previews previously offered only Close, leaving document/archive
  // links unusable. Use the existing authenticated byte-stream endpoint.
  replace('s.jsx("button",{onClick:r,className:"mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90",children:"Close"})',
    's.jsx(CloudcliFileDownload,{file:e},e.projectId+":"+e.path),s.jsx("button",{onClick:r,className:"rounded-md border border-border px-4 py-2 text-sm hover:bg-muted",children:"关闭"})');
  return client;
}

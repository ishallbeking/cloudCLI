import fs from 'node:fs/promises';
export async function patchComposerActions(client) {
  const replace=(before,after)=>{
    if(client.split(before).length!==2)throw Error('Composer actions anchor changed: '+before.slice(0,80));
    client=client.replace(before,after);
  };
  // Keep the empty composer visually blank, with a separate accessible name.
  replace('onInput:ee,placeholder:ye', 'onInput:ee,rows:1,placeholder:"","aria-label":"消息"');
  // Only ChatComposer instantiates this input root in the pinned distribution.
  replace('s.jsxs(eD,{onSubmit:', 's.jsxs(CloudcliComposerInput,{onSubmit:');
  replace('function JYe({disabled:e,onSchedule:t})', 'function JYe({disabled:e,onSchedule:t,cloudcliActionMode:cloudcliActionMode=false})');
  replace('"aria-label":h,title:h,className:Se("flex h-8 w-8 shrink-0', '"aria-label":cloudcliActionMode?"定时发送":h,title:h,role:cloudcliActionMode?"menuitem":void 0,className:Se(cloudcliActionMode?"cloudcli-composer-schedule-action":"flex h-8 w-8 shrink-0');
  replace('children:s.jsx(Su,{className:"h-4 w-4"})}),r&&c&&qa.createPortal', 'children:s.jsxs(s.Fragment,{children:[s.jsx(Su,{className:"h-4 w-4"}),cloudcliActionMode&&"定时发送"]})}),r&&c&&qa.createPortal');
  client+='\n'+await fs.readFile(new URL('./composer-actions-client.js',import.meta.url),'utf8');
  return client;
}

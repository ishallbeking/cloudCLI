import fs from 'node:fs/promises';
// Inject into the pinned compatibility client, with exact anchors that fail on upstream drift.
export async function patchSessionGroups(client) {
  const replace = (before, after) => {
    if (client.split(before).length !== 2) throw new Error('Session groups anchor changed: ' + before.slice(0, 100));
    client = client.replace(before, after);
  };
  client += '\n' + await fs.readFile(new URL('./session-groups-client.js', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('./session-groups-client.css', import.meta.url), 'utf8');
  replace('const a=[{mode:"projects",label:r("search.modeProjects")',
    'const a=[{mode:"groups",label:"组",icon:CloudcliGroupIcon,showLabel:!0},{mode:"projects",label:r("search.modeProjects")');
  // Keep the user's familiar order: Projects, Conversations, Groups, activity/archive.
  replace('{mode:"groups",label:"组",icon:CloudcliGroupIcon,showLabel:!0},{mode:"projects",label:r("search.modeProjects"),icon:Fa,showLabel:!0},{mode:"conversations",label:r("search.modeConversations"),icon:Oo,showLabel:!0}',
    '{mode:"projects",label:r("search.modeProjects"),icon:Fa,showLabel:!0},{mode:"conversations",label:r("search.modeConversations"),icon:Oo,showLabel:!0},{mode:"groups",label:"组",icon:CloudcliGroupIcon,showLabel:!0}');
  replace('x=u==="conversations"?v("search.conversationsPlaceholder")', 'x=u==="groups"?"搜索组或对话…":u==="conversations"?v("search.conversationsPlaceholder")');
  replace('children:pe?C&&!S?', 'children:x==="groups"?s.jsx(CloudcliSessionGroups,{selectedSession:Z.selectedSession,onSelect:R,filter:b,reloadKey:q,sessionActions:Z}):pe?C&&!S?');
  replace('!xe&&s.jsx(Mtt,{updateAvailable:$',
    's.jsx(CloudcliGroupDialogHost,{}),s.jsx("style",{children:' + JSON.stringify(css) + '}),!xe&&s.jsx(Mtt,{updateAvailable:$');
  replace('items:[...r!==null?[{key:"rename",label:"Rename session"',
    'items:[{key:"group",label:"加入组",icon:CloudcliGroupIcon,onSelect:()=>cloudcliGroupAction({kind:"add-to-group",sessionId:e,sessionName:t})},...r!==null?[{key:"rename",label:"Rename session"');
  // Projects have a separate touch-friendly options sheet on mobile.
  replace('children:[s.jsxs("button",{type:"button",onClick:ge,className:"flex min-h-12 w-full',
    'children:[s.jsxs("button",{type:"button",onClick:()=>{je(!1);cloudcliGroupAction({kind:"add-to-group",sessionId:t.id,sessionName:w.sessionName})},className:"ccg-add-row",children:[s.jsx(CloudcliGroupIcon,{}),"加入组"]}),s.jsxs("button",{type:"button",onClick:ge,className:"flex min-h-12 w-full');
  return client;
}

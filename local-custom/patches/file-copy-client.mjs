import fs from 'node:fs/promises';
export async function patchFileCopy(client) {
  function replace(before, after) {
    if (client.split(before).length !== 2) throw new Error(`File copy client upstream changed: ${before.slice(0,90)}`);
    client = client.replace(before, after);
  }
  client += '\n' + await fs.readFile(new URL('./file-copy-client.js', import.meta.url), 'utf8');
  replace('className:p=""}){const{t:m}=Te(),[h,g]=f.useState(!1),[b,v]=f.useState({x:0,y:0})',
    'className:p=""}){const cloudcliFileClipboard=f.useContext(CloudcliFileClipboardContext);const{t:m}=Te(),[h,g]=f.useState(!1),[b,v]=f.useState({x:0,y:0})');
  replace('C=f.useMemo(()=>t?.type==="file"?[{key:"rename"', 'C=f.useMemo(()=>cloudcliFileClipboardItems(t,cloudcliFileClipboard,t?.type==="file"?[{key:"rename"');
  replace('onSelect:l,showDividerBefore:!0}],[t,c,r,d,a,o,l,n,i,m]);return f.useEffect',
    'onSelect:l,showDividerBefore:!0}]),[cloudcliFileClipboard,t,c,r,d,a,o,l,n,i,m]);f.useLayoutEffect(()=>{if(!h||!y.current)return;const rect=y.current.getBoundingClientRect();v(previous=>({x:Math.max(8,Math.min(previous.x,innerWidth-rect.width-8)),y:Math.max(8,Math.min(previous.y,innerHeight-rect.height-8))}))},[h,cloudcliFileClipboard?.canPaste]);return f.useEffect');
  replace('style:{position:"fixed",left:b.x,top:b.y,zIndex:9999}', 'style:{position:"fixed",left:b.x,top:b.y,zIndex:9999,maxHeight:"calc(100dvh - 16px)",overflowY:"auto"}');
  replace('operationLoading:E}){const{t:A}=Te(),T=e.type===', 'operationLoading:E}){const cloudcliFileClipboard=f.useContext(CloudcliFileClipboardContext);const{t:A}=Te(),T=e.type===');
  replace('"relative",q&&"bg-blue-500/10 ring-1 ring-inset ring-blue-500/40")', '"relative",q&&"bg-blue-500/10 ring-1 ring-inset ring-blue-500/40",cloudcliFileClipboard?.selectedPath===e.path&&"bg-accent/80 ring-1 ring-inset ring-border")');
  replace('P=A.operationLoading||D.operationLoading,R=f.useRef(null)', 'cloudcliFileClipboard=useCloudcliFileClipboard(e,p,T,g,u),P=A.operationLoading||D.operationLoading||cloudcliFileClipboard.busy,R=f.useRef(null)');
  replace('return m?s.jsx(lQe,{}):s.jsxs("div",{ref:T,className:"relative flex h-full flex-col bg-background",',
    'return s.jsx(CloudcliFileClipboardContext.Provider,{value:cloudcliFileClipboard,children:m?s.jsx(lQe,{}):s.jsxs("div",{ref:T,tabIndex:0,"data-testid":"project-file-tree",onMouseDownCapture:cloudcliFileClipboard.capture,onContextMenuCapture:cloudcliFileClipboard.capture,onKeyDown:cloudcliFileClipboard.onKeyDown,className:"relative flex h-full flex-col bg-background",');
  replace('children:i.message})]})]})}const mQe=', 'children:i.message})]})]})})}const mQe=');
  return client;
}

// CloudCLI 1.37.7 ships a compiled client. Keep the compatibility patch readable
// and build a new asset name so existing browsers cannot cache the old client.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { patchMessageOrder } from './message-order-client.mjs';
import { patchApproveForMeClient } from './approve-for-me-client.mjs';
import { patchConversationNavigation } from './conversation-navigation-client.mjs';
import { patchManualApprovals } from './manual-approval-client.mjs';
import { patchContextUsage } from './context-usage-client.mjs';
import { patchSidebarFooter } from './sidebar-footer-client.mjs';
import { patchFileCopy } from './file-copy-client.mjs';
import { patchFileSort } from './file-sort-client.mjs';
const root = new URL('../package/dist/', import.meta.url);
let client = await fs.readFile(new URL('assets/index-Cq6TKEnV.js', root), 'utf8');
function replaceOnce(before, after) {
  if (client.split(before).length !== 2) throw new Error(`Unexpected upstream client: ${before.slice(0, 90)}`);
  client = client.replace(before, after);
}
replaceOnce(
  'getFiles:(e,t={})=>ht(`/api/file-tree/projects/${e}/files${bn({respectGitignore:!0})}`,t)',
  'getFiles:(e,{directory,shallow,complete,...t}={})=>ht(`/api/file-tree/projects/${e}/files${bn({respectGitignore:!0,directory,shallow,complete})}`,t)',
);
const hookStart = client.indexOf('function TXe(');
const hookEnd = client.indexOf('function Rp(', hookStart);
if (hookStart < 0 || hookEnd < hookStart || hookEnd - hookStart > 2000) throw new Error('File tree hook boundary changed');
const hook = `
function cloudcliPatchTree(nodes, target, patch) {
  return nodes.map(item => item.path === target ? {...item, ...patch}
    : item.children ? {...item, children: cloudcliPatchTree(item.children, target, patch)} : item);
}
function cloudcliFindTreeNode(nodes, target) {
  for (const item of nodes) {
    if (item.path === target) return item;
    const match = item.children && cloudcliFindTreeNode(item.children, target);
    if (match) return match;
  }
}
function cloudcliHasUnloaded(nodes) {
  return nodes.some(item => item.childrenLoaded === false || (item.children && cloudcliHasUnloaded(item.children)));
}
function cloudcliNeedsDirectory(item) {
  return item.type === 'directory' && (item.childrenLoaded === false || item.children === undefined);
}
function TXe(e) {
  const [files, setFiles] = f.useState([]);
  const [loading, setLoading] = f.useState(false);
  const [error, setError] = f.useState(null);
  const [version, setVersion] = f.useState(0);
  const active = f.useRef(null);
  const pending = f.useRef(new Map());
  const refreshFiles = f.useCallback(() => setVersion(value => value + 1), []);
  f.useEffect(() => {
    const projectId = e?.projectId;
    active.current?.abort();
    pending.current.clear();
    setFiles([]);
    setError(null);
    if (!projectId) { setLoading(false); return; }
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    (async () => {
      try {
        const response = await ke.getFiles(projectId, {signal: controller.signal});
        if (!response.ok) throw new Error(NXe(await response.text()) ?? o6);
        const entries = await response.json();
        if (!controller.signal.aborted) setFiles(entries);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message || o6);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [e?.projectId, version]);
  const loadDirectory = f.useCallback(item => {
    if (!cloudcliNeedsDirectory(item)) return Promise.resolve(item.children ?? []);
    const controller = active.current;
    if (!controller || controller.signal.aborted) return Promise.resolve([]);
    if (pending.current.has(item.path)) return pending.current.get(item.path);
    const request = (async () => {
      setFiles(tree => cloudcliPatchTree(tree, item.path, {childrenLoading: true, childrenError: null}));
      try {
        const response = await ke.getFiles(e.projectId, {
          directory: item.path, shallow: true, signal: controller.signal,
        });
        if (!response.ok) throw new Error(NXe(await response.text()) ?? o6);
        const entries = await response.json();
        if (!controller.signal.aborted) {
          setFiles(tree => cloudcliPatchTree(tree, item.path, {
            children: entries, childrenLoaded: true, childrenLoading: false,
          }));
        }
        return entries;
      } catch (failure) {
        if (!controller.signal.aborted) {
          setFiles(tree => cloudcliPatchTree(tree, item.path, {childrenError: failure.message || o6}));
        }
        throw failure;
      } finally {
        if (!controller.signal.aborted) {
          pending.current.delete(item.path);
          setFiles(tree => cloudcliPatchTree(tree, item.path, {childrenLoading: false}));
        }
      }
    })();
    pending.current.set(item.path, request);
    return request;
  }, [e?.projectId, version]);
  return {files, loading, error, refreshFiles, loadDirectory};
}
`;
client = client.slice(0, hookStart) + hook + client.slice(hookEnd);
replaceOnce(
  '{files:p,loading:m,error:h,refreshFiles:g}=TXe(e)',
  '{files:p,loading:m,error:h,refreshFiles:g,loadDirectory:cloudcliLoadDirectory}=TXe(e)',
);
replaceOnce(
  'const A=IXe({selectedProject:e,onRefresh:g,showToast:u})',
  'f.useEffect(()=>{for(const directory of y){const item=cloudcliFindTreeNode(p,directory);if(item&&cloudcliNeedsDirectory(item)&&!item.childrenLoading&&!item.childrenError)cloudcliLoadDirectory(item).catch(failure=>{if(failure.name!=="AbortError")u(failure.message,"error")})}},[p,y,cloudcliLoadDirectory,u]);const A=IXe({selectedProject:e,onRefresh:g,showToast:u})',
);
replaceOnce(
  'L.length!==0&&(E.current=n,k(L))},[n,e?.path,e?.fullPath,k,p])',
  'L.length!==0&&(k(L),cloudcliFindTreeNode(p,L[L.length-1])?.childrenLoaded===false?cloudcliLoadDirectory(cloudcliFindTreeNode(p,L[L.length-1])).catch(failure=>{if(failure.name!=="AbortError")u(failure.message,"error")}):E.current=n)},[n,e?.path,e?.fullPath,k,p,cloudcliLoadDirectory,u])',
);
replaceOnce(
  'H=f.useCallback(V=>{if(V.type==="directory"){x(V.path);return}if(FXe(V.name)&&e){o({name:V.name,path:V.path,projectPath:e.path,projectId:e.projectId});return}t?.(V.path)},[t,e,x])',
  'H=f.useCallback(V=>{if(V.type==="directory"){if(V.childrenError&&y.has(V.path)){cloudcliLoadDirectory(V).catch(failure=>{if(failure.name!=="AbortError")u(failure.message,"error")});return}x(V.path);return}if(FXe(V.name)&&e){o({name:V.name,path:V.path,projectPath:e.path,projectId:e.projectId});return}t?.(V.path)},[t,e,x,y,cloudcliLoadDirectory,u])',
);
replaceOnce(
  'T&&D&&P&&s.jsxs("div",{className:"relative",children:',
  'T&&D&&!P&&s.jsx("p",{className:"px-6 py-2 text-xs text-muted-foreground",children:e.childrenError?e.childrenError+"（点击文件夹重试）":e.childrenLoading||cloudcliNeedsDirectory(e)?"正在加载…":"此文件夹为空或内容已被忽略"}),T&&D&&P&&s.jsxs("div",{className:"relative",children:',
);
replaceOnce(
  'onClick:()=>a(e),onDragOver:y?V=>y(V,N):void 0,children:',
  '"data-tree-path":e.path,"data-tree-expanded":T?D:void 0,onClick:()=>a(e),onDragOver:y?V=>y(V,N):void 0,children:',
);
replaceOnce(
  'B=f.useCallback(async H=>{if(!e)return;const I=new EXe,V=async',
  'B=f.useCallback(async H=>{if(!e)return;const treeResponse=await ke.getFiles(e.projectId,{directory:H.path,complete:true});if(!treeResponse.ok)throw new Error(NXe(await treeResponse.text())??"Unable to download folder");H={...H,children:await treeResponse.json()};const I=new EXe,V=async',
);
replaceOnce(
  'function Fp({item:e,isOpen:t,renderFileIcon:n}){',
  'function Fp({item:e,isOpen:t,renderFileIcon:n}){if(e.childrenLoading)return s.jsx(Wt,{className:"h-4 w-4 animate-spin text-muted-foreground","aria-label":"正在加载文件夹"});',
);
replaceOnce(
  's.jsx(dQe,{upload:D.uploadProgress}),b==="detailed"',
  's.jsx(dQe,{upload:D.uploadProgress}),cloudcliHasUnloaded(p)&&s.jsx("p",{className:"px-3 py-2 text-xs text-muted-foreground",children:"展开文件夹查看内容，搜索仅包含已加载文件。"}),b==="detailed"',
);
// Retain the structured Codex questions feed alongside the file-tree patch.
client += '\n' + await fs.readFile(new URL('./codex-questions-client.js', import.meta.url), 'utf8');
replaceOnce('s.jsx(lZe,{pendingPermissionRequests:z,',
  's.jsx(CloudcliCodexQuestions,{sessionId:ue||n?.id,provider:N,active:e,onUpdate:Kt},ue||n?.id||"new"),s.jsx(lZe,{pendingPermissionRequests:z,');
client = await patchMessageOrder(client);
client = patchApproveForMeClient(client);
client = await patchConversationNavigation(client);
client = await patchManualApprovals(client);
client = await patchContextUsage(client);
client = patchSidebarFooter(client);
client = await patchFileCopy(client);
client = await patchFileSort(client);
const hash = createHash('sha256').update(client).digest('hex').slice(0, 12);
const asset = `assets/index-cloudcli-tree-${hash}.js`;
await fs.writeFile(new URL(asset, root), client);
const indexPath = new URL('index.html', root);
const index = await fs.readFile(indexPath, 'utf8');
const currentAsset = /\/assets\/index-(?:Cq6TKEnV|cloudcli-tree-[a-f0-9]+)\.js/;
if (!currentAsset.test(index)) throw new Error('Unexpected HTML entry point');
await fs.writeFile(indexPath, index.replace(currentAsset, '/' + asset));
console.log('File tree client built:', asset);

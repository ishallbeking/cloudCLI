// File operations use a private browser clipboard of server paths. They work on
// HTTP LAN deployments without requiring the secure-context Clipboard API.
const CloudcliFileClipboardContext = f.createContext(null);
const cloudcliFileClipboardKey = 'cloudcli:file-clipboard:v1';
const cloudcliFileClipboardListeners = new Set();
let cloudcliFileClipboardValue = null;
try {
  const saved = JSON.parse(sessionStorage.getItem(cloudcliFileClipboardKey) || 'null');
  if (saved && typeof saved.projectId === 'string' && typeof saved.path === 'string' && typeof saved.name === 'string') cloudcliFileClipboardValue = saved;
} catch {}
function cloudcliFileClipboardSubscribe(listener) {
  cloudcliFileClipboardListeners.add(listener);
  return () => cloudcliFileClipboardListeners.delete(listener);
}
function cloudcliFileClipboardItems(item, clipboard, existing) {
  if (!clipboard) return existing;
  return [
    ...(item ? [{key:'copy', icon:ji, label:'复制', shortcut:'Ctrl+C', onSelect:()=>clipboard.copy(item), isDisabled:clipboard.busy}] : []),
    {key:'paste', icon:ji, label:'粘贴', shortcut:'Ctrl+V', onSelect:()=>clipboard.paste(item), isDisabled:!clipboard.canPaste || clipboard.busy},
    ...existing,
  ];
}
function useCloudcliFileClipboard(project, files, treeRef, refresh, toast) {
  const clipboard = f.useSyncExternalStore(cloudcliFileClipboardSubscribe, () => cloudcliFileClipboardValue);
  const [selectedPath, setSelectedPath] = f.useState(null);
  const [busy, setBusy] = f.useState(false);
  const pending = f.useRef(false);
  const activeProject = f.useRef(project?.projectId);
  activeProject.current = project?.projectId;
  f.useEffect(() => setSelectedPath(null), [project?.projectId]);
  const selected = selectedPath && cloudcliFindTreeNode(files, selectedPath);
  const copy = item => {
    if (!project?.projectId || !item || pending.current) return;
    cloudcliFileClipboardValue = {projectId:project.projectId, path:item.path, name:item.name};
    try { sessionStorage.setItem(cloudcliFileClipboardKey, JSON.stringify(cloudcliFileClipboardValue)); } catch {}
    for (const listener of cloudcliFileClipboardListeners) listener();
    toast(`已复制“${item.name}”，请选择目标文件夹后粘贴`, 'success');
  };
  const paste = async item => {
    const source = cloudcliFileClipboardValue;
    if (!project?.projectId || !source || pending.current) return;
    const projectId = project.projectId;
    const targetPath = item ? item.type === 'directory' ? item.path : rQe(item.path) : '';
    pending.current = true; setBusy(true);
    try {
      const response = await ft(`/api/file-tree/projects/${encodeURIComponent(projectId)}/files/copy`, {
        sourceProjectId:source.projectId, sourcePath:source.path, targetPath,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '复制失败');
      if (activeProject.current === projectId) {
        toast(`已粘贴“${result.name}”`, 'success');
        refresh();
      }
    } catch (error) {
      if (activeProject.current === projectId) toast(error.message || '复制失败，请重试', 'error');
    } finally { pending.current = false; setBusy(false); }
  };
  const capture = event => {
    if (event.target.closest('input,textarea,select,[contenteditable="true"],button,a')) return;
    const row = event.target.closest('[data-tree-path]');
    setSelectedPath(row?.getAttribute('data-tree-path') || null);
    treeRef.current?.focus({preventScroll:true});
  };
  const onKeyDown = event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.defaultPrevented ||
        event.target.closest('input,textarea,select,[contenteditable="true"],.cm-editor,[role="dialog"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'c' && selected && !window.getSelection()?.toString()) {
      event.preventDefault(); event.stopPropagation(); copy(selected);
    } else if (key === 'v' && clipboard) {
      event.preventDefault(); event.stopPropagation(); paste(selected);
    }
  };
  return {selectedPath, busy, canPaste:!!clipboard, copy, paste, capture, onKeyDown};
}

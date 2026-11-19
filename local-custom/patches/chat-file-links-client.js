// Decode the Markdown href once, at the URI -> filesystem boundary only.
// Link-text fallbacks and file-tree paths are already filesystem strings.
function cloudcliDecodeFileHref(reference) {
  return reference.replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
    try { return decodeURIComponent(encoded); } catch { return encoded; }
  });
}
function CloudcliFileDownload({file}) {
  // Retain transfer state so repeated clicks cannot start parallel downloads.
  const [pending,setPending]=f.useState(false);
  // Surface HTTP/read failures alongside the action, rather than silently closing.
  const [error,setError]=f.useState('');
  const active=f.useRef(null);
  f.useEffect(()=>()=>active.current?.abort(),[]);
  async function download() {
    if(active.current)return;
    const controller=new AbortController();active.current=controller;
    setPending(true);setError('');
    try {
      if(!file.projectId)throw new Error('缺少项目标识，请重新打开文件');
      const response=await ke.readFileBlob(file.projectId,file.path,{signal:controller.signal});
      if(!response.ok){
        const data=await response.json().catch(()=>null);
        throw new Error(data?.error||`下载失败 (${response.status})`);
      }
      const blob=await response.blob();
      if(controller.signal.aborted)return;
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=file.name;document.body.appendChild(anchor);
      try {anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    } catch(failure) {
      if(!controller.signal.aborted)setError(failure.message||'下载失败');
    } finally {
      if(active.current===controller)active.current=null;
      if(!controller.signal.aborted)setPending(false);
    }
  }
  return s.jsxs('div',{className:'flex flex-col items-center gap-2',children:[
    s.jsx('button',{type:'button',disabled:pending,onClick:download,className:'rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50',children:pending?'正在下载…':'下载文件'}),
    error&&s.jsx('p',{role:'alert',className:'text-sm text-destructive',children:error})
  ]});
}

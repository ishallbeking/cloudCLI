// Kept readable because this distribution contains only the compiled React UI.
function cloudcliNavigationRow(pane, id) {
  return Array.from(pane?.querySelectorAll('[data-message-row-id]') || []).find(row => row.dataset.messageRowId === id || (row.dataset.messageRowIds && JSON.parse(row.dataset.messageRowIds).includes(id)));
}
async function cloudcliNavigationGet(sessionId, query = '', signal) {
  const response = await ht(`/api/providers/sessions/${encodeURIComponent(sessionId)}/navigation${query}`, {signal});
  if (!response.ok) throw new Error(response.status === 404 ? '消息目录已更新，请重试' : '暂时无法加载对话导航，请重试');
  return (await response.json()).data;
}
function useCloudcliNavigation(options) {
  const latest = f.useRef(options); latest.current = options;
  const [storedView, setView] = f.useState(null), [loading, setLoading] = f.useState(false), [error, setError] = f.useState('');
  const requests = f.useRef({sequence:0, controller:null}), state = f.useRef(null), scrollJob = f.useRef(null);
  const view = storedView?.sessionId === options.sessionId ? storedView : null; state.current = view;
  const cancelScroll = () => { if (scrollJob.current) cancelAnimationFrame(scrollJob.current); scrollJob.current = null; };
  f.useEffect(() => {
    requests.current.sequence++; requests.current.controller?.abort(); cancelScroll();
    state.current = null; setView(null); setError(''); setLoading(false);
    if (!options.active) options.release();
    return () => { requests.current.sequence++; requests.current.controller?.abort(); cancelScroll(); };
  }, [options.sessionId, options.active]);
  const position = (id, oldOffset, sequence) => {
    cancelScroll(); let attempts = 0, stable = 0, last = null;
    const step = () => {
      if (sequence !== requests.current.sequence) return;
      const pane = latest.current.scrollRef.current, row = cloudcliNavigationRow(pane, id);
      if (pane && row) {
        const y = row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
        const offset = oldOffset ?? Math.min(96, pane.clientHeight / 4);
        pane.scrollTop += y - offset;
        stable = last === row.offsetHeight ? stable + 1 : 0; last = row.offsetHeight;
        if (stable > 5) { row.classList.add('cloudcli-nav-highlight'); setTimeout(() => row.classList.remove('cloudcli-nav-highlight'), 1300); scrollJob.current = null; return; }
      }
      if (++attempts < 90) scrollJob.current = requestAnimationFrame(step);
      else { scrollJob.current = null; setError('定位未完成，请再次点击对应刻度'); }
    };
    scrollJob.current = requestAnimationFrame(step);
  };
  const load = f.useCallback(async (anchor, direction = 'around') => {
    const config = latest.current, old = state.current;
    if (!config.active || !config.sessionId || !anchor || (direction !== 'around' && requests.current.controller)) return;
    const sequence = ++requests.current.sequence;
    requests.current.controller?.abort(); const controller = new AbortController(); requests.current.controller = controller;
    cancelScroll(); config.suspend(); setLoading(true); setError('');
    const pane = config.scrollRef.current;
    let keepId = anchor, keepOffset;
    if (direction !== 'around' && pane) {
      const bounds = pane.getBoundingClientRect();
      const row = Array.from(pane.querySelectorAll('[data-message-row-id]')).find(row => row.getBoundingClientRect().bottom > bounds.top + 10);
      if (row) { keepId = row.dataset.messageRowId; keepOffset = row.getBoundingClientRect().top - bounds.top; }
    }
    try {
      const data = await cloudcliNavigationGet(config.sessionId, `?anchor=${encodeURIComponent(anchor)}&direction=${direction}`, controller.signal);
      if (sequence !== requests.current.sequence || latest.current.sessionId !== config.sessionId) return;
      let raw = data.messages, hasBefore = data.hasBefore, hasAfter = data.hasAfter;
      if (direction !== 'around' && old) {
        const union = direction === 'before' ? [...raw, ...old.raw] : [...old.raw, ...raw];
        const seen = new Set(); raw = union.filter(message => !seen.has(message.id) && seen.add(message.id));
        if (direction === 'before') { hasAfter = old.hasAfter; if (raw.length > 240) { raw = raw.slice(0,240); hasAfter = true; } }
        else { hasBefore = old.hasBefore; if (raw.length > 240) { raw = raw.slice(-240); hasBefore = true; } }
      }
      // Paging may evict the old viewport to retain a bounded window. In that
      // case anchor to a retained text row at the adjoining page boundary.
      if (!raw.some(message => message.id === keepId)) {
        const retained = new Set(raw.map(message => message.id));
        const candidates = direction === 'after' ? [...(old?.messages||[])].reverse() : old?.messages||[];
        keepId = candidates.find(message => retained.has(message.id) && !message.isToolUse && !message.isThinking)?.id
          || Ld(raw).find(message => message.type === 'user')?.id || raw[0]?.id;
        keepOffset = 96;
      }
      const next = {...data, raw, messages:Ld(raw), hasBefore, hasAfter, firstId:raw[0]?.id, lastId:raw.at(-1)?.id, sessionId:config.sessionId};
      state.current = next; setView(next); position(keepId, keepOffset, sequence);
    } catch (failure) { if (!controller.signal.aborted && sequence === requests.current.sequence) { setError(failure.message); if (!state.current) latest.current.release(); } }
    finally { if (sequence === requests.current.sequence) { requests.current.controller = null; setLoading(false); } }
  }, []);
  const before = f.useCallback(() => { const current = state.current; if (current?.hasBefore) return load(current.firstId, 'before'); }, [load]);
  const after = f.useCallback(() => { const current = state.current; if (current?.hasAfter) return load(current.lastId, 'after'); }, [load]);
  const reset = f.useCallback(() => {
    requests.current.sequence++; requests.current.controller?.abort(); requests.current.controller = null; cancelScroll();
    state.current = null; setView(null); setError(''); setLoading(false);
  }, []);
  const resume = f.useCallback(() => { reset(); latest.current.resume(); }, [reset]);
  return {view,loading,error,jump:load,before,after,reset,resume,clearError:()=>setError(''),isViewing:()=>!!state.current};
}
function cloudcliLocalNavigationEntries(messages) {
  const entries = [], byId = new Map(), byTurn = new Map(); let current;
  for (const message of messages) {
    if (message.type !== 'user' || !message.id) continue;
    const entry = {id:message.id,timestamp:message.timestamp,question:message.displayText||message.content||'[附件]',answer:'',rowIds:[message.id]};
    entries.push(entry); byId.set(message.id,entry); if (message.turnId) byTurn.set(message.turnId,entry);
  }
  for (const message of messages) {
    if (byId.has(message.id)) { current = byId.get(message.id); continue; }
    const explicit = message.parentUserMessageId || message.turnId;
    const owner = byId.get(message.parentUserMessageId) || byTurn.get(message.turnId) || (!explicit ? current : undefined);
    if (!owner) continue;
    if (message.id) owner.rowIds.push(message.id);
    if (message.type === 'assistant' && !message.isToolUse && !message.isThinking && message.content) owner.answer = message.content;
  }
  return entries;
}
function CloudcliConversationRail({sessionId,active,scrollRef,messages,navigation}) {
  const [outline,setOutline] = f.useState([]), [failure,setFailure] = f.useState(''), [revision,setRevision] = f.useState(0);
  const [rect,setRect] = f.useState(null), [activeId,setActiveId] = f.useState(null), [hover,setHover] = f.useState(null);
  const rail = f.useRef(null), hovering = f.useRef(false), currentSession = f.useRef(sessionId); currentSession.current = sessionId;
  // Refresh only when new user turns arrive or a run finishes, not per token.
  const userRevision = messages.filter(message => message.type === 'user').map(message => message.id).join('|');
  const streaming = messages.some(message => message.isStreaming);
  f.useEffect(() => {
    setOutline([]); setHover(null); setActiveId(null); setFailure('');
  }, [sessionId]);
  f.useEffect(() => {
    if (!sessionId || !active) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await cloudcliNavigationGet(sessionId, '', controller.signal);
        if (!controller.signal.aborted && currentSession.current === sessionId) { setOutline(data.entries); setFailure(''); }
      } catch (error) { if (!controller.signal.aborted) setFailure(error.message); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [sessionId,active,userRevision,streaming,revision]);
  const entries = f.useMemo(() => {
    const result = outline.map(entry => ({...entry})), byId = new Map(result.map(entry => [entry.id,entry]));
    for (const entry of cloudcliLocalNavigationEntries(messages)) {
      const existing = byId.get(entry.id);
      // Optimistic messages get their own marker until the stable server ID arrives.
      if (!existing) { if (!entry.id.startsWith('local_') || !result.some(row => row.question === entry.question)) result.push(entry); }
      else { existing.rowIds = Array.from(new Set([...existing.rowIds,...entry.rowIds])); if (entry.answer) existing.answer = entry.answer.slice(0,301); }
    }
    return result;
  }, [outline,messages]);
  const owners = f.useMemo(() => new Map(entries.flatMap(entry => entry.rowIds.map(id => [id,entry.id]))), [entries]);
  f.useEffect(() => {
    const pane = scrollRef.current;
    if (!pane || !active) return;
    const measure = () => { const box = pane.getBoundingClientRect(); setRect({left:box.left,top:box.top,width:box.width,height:box.height}); };
    measure(); const resize = new ResizeObserver(measure); resize.observe(pane);
    // Pane moves when neighboring panels change width; observe the containing layout too.
    if (pane.parentElement) resize.observe(pane.parentElement);
    window.addEventListener('resize',measure);
    return () => { resize.disconnect(); window.removeEventListener('resize',measure); };
  }, [active,sessionId,scrollRef]);
  f.useEffect(() => {
    const pane = scrollRef.current; if (!pane || !active) return;
    let frame = null;
    const scan = () => {
      frame = null; const box = pane.getBoundingClientRect(), rows = Array.from(pane.querySelectorAll('[data-message-row-id]'));
      let selected;
      for (const row of rows) {
        const owner = owners.get(row.dataset.messageRowId); if (!owner) continue;
        const bounds = row.getBoundingClientRect();
        if (bounds.top <= box.top + Math.min(120,box.height/3)) selected = owner;
        else { if (!selected && bounds.bottom > box.top) selected = owner; break; }
      }
      if (selected) setActiveId(selected);
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(scan); };
    pane.addEventListener('scroll',queue,{passive:true});
    const observer = new MutationObserver(queue); observer.observe(pane,{childList:true,subtree:true}); queue();
    return () => { pane.removeEventListener('scroll',queue); observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [owners,active,sessionId,navigation.view]);
  f.useEffect(() => {
    if (hovering.current) return;
    const button = Array.from(rail.current?.querySelectorAll('button[data-nav-id]') || []).find(button => button.dataset.navId === activeId);
    if (button && rail.current) {
      const parent = rail.current, offset = button.offsetTop - parent.clientHeight/2;
      parent.scrollTop = Math.max(0,offset);
    }
  }, [activeId]);
  if (!active || !sessionId || !rect || rect.width < 300 || (!entries.length && !failure)) return null;
  const choose = entry => {
    setHover(null);
    if (entry.id.startsWith('local_')) {
      const row = cloudcliNavigationRow(scrollRef.current,entry.id);
      if (row) row.scrollIntoView({block:'center',behavior:'smooth'});
      else setFailure('这条消息正在同步，请稍后重试');
    } else navigation.jump(entry.id);
  };
  const showPreview = (entry,event) => { const box = event.currentTarget.getBoundingClientRect(); setHover({entry,top:Math.max(12,Math.min(box.top-24,window.innerHeight-290))}); };
  const moveFocus = event => {
    if (event.key === 'Escape') { setHover(null); event.currentTarget.blur(); return; }
    const buttons = Array.from(rail.current.querySelectorAll('button[data-nav-id]')), index = buttons.indexOf(event.currentTarget);
    const next = event.key === 'ArrowDown' ? index+1 : event.key === 'ArrowUp' ? index-1 : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : null;
    if (next !== null) { event.preventDefault(); buttons[Math.max(0,Math.min(buttons.length-1,next))]?.focus(); }
  };
  const height = Math.max(80,Math.min(360,rect.height-100)), top = rect.top+(rect.height-height)/2;
  const activeIndex = entries.findIndex(entry => entry.id === activeId);
  return qa.createPortal(s.jsxs(s.Fragment,{children:[
    s.jsxs('nav',{className:'cloudcli-conversation-nav',style:{left:rect.left+5,top,height},'aria-label':'对话快速导航',
      onMouseEnter:()=>{hovering.current=true;},onMouseLeave:()=>{hovering.current=false;setHover(null);},
      children:[s.jsx('div',{ref:rail,className:'cloudcli-nav-ticks',children:entries.map((entry,index)=>s.jsx('button',{
        type:'button',className:'cloudcli-nav-tick'+(activeId===entry.id?' is-active':''),'data-nav-id':entry.id,
        'aria-label':`第 ${index+1} 轮：${entry.question.slice(0,100)}`,'aria-current':activeId===entry.id?'location':undefined,
        onMouseEnter:event=>showPreview(entry,event),onFocus:event=>showPreview(entry,event),onBlur:()=>setHover(null),onKeyDown:moveFocus,
        onClick:()=>choose(entry),children:s.jsx('span',{})
      },entry.id))}),s.jsx('span',{className:'cloudcli-nav-count','aria-hidden':true,children:entries.length?`${Math.max(1,activeIndex+1)}/${entries.length}`:''})]}),
    hover&&s.jsxs('div',{className:'cloudcli-nav-preview',role:'tooltip',style:{left:rect.left+40,top:hover.top},children:[
      s.jsxs('div',{className:'cloudcli-nav-preview-meta',children:[`第 ${entries.findIndex(entry=>entry.id===hover.entry.id)+1} 轮`,s.jsx('time',{children:hover.entry.timestamp?new Date(hover.entry.timestamp).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''})]}),
      s.jsx('div',{className:'cloudcli-nav-preview-question',children:hover.entry.question.slice(0,240)}),
      s.jsx('div',{className:'cloudcli-nav-preview-answer',children:(hover.entry.answer||'暂无文字回复').replace(/[#*`>]/g,'').slice(0,340)}),
      s.jsx('div',{className:'cloudcli-nav-preview-hint',children:'点击刻度跳转 · ↑↓ 浏览 · Enter 定位'})]}),
    (navigation.view||navigation.loading||navigation.error||failure)&&s.jsxs('div',{className:'cloudcli-nav-controls',style:{left:rect.left+rect.width/2,top:rect.top+rect.height-52},children:[
      (navigation.error||failure)?s.jsxs(s.Fragment,{children:[s.jsx('span',{role:'status',children:navigation.error||failure}),s.jsx('button',{type:'button',onClick:()=>{setRevision(value=>value+1);setFailure('');navigation.clearError();},children:'刷新目录'}),s.jsx('button',{type:'button',onClick:()=>{setFailure('');navigation.clearError();},children:'关闭'})]}):navigation.loading?s.jsx('span',{role:'status',children:'正在定位…'}):s.jsxs(s.Fragment,{children:[
        navigation.view?.hasBefore&&s.jsx('button',{type:'button',onClick:navigation.before,children:'↑ 更早消息'}),
        navigation.view?.hasAfter&&s.jsx('button',{type:'button',onClick:navigation.after,children:'后续消息 ↓'})]}),
      navigation.view&&s.jsx('button',{type:'button',onClick:navigation.resume,children:'回到最新'})]})
  ]}),document.body);
}

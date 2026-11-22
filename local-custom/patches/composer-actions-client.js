// Used by the pinned composer's input form; keep original handlers and context.
function CloudcliComposerActions({attachment,commands,schedule}) {
  // Only transient menu visibility/position is owned here; drafts stay upstream.
  const [open,setOpen] = f.useState(false), [position,setPosition] = f.useState(null);
  const trigger = f.useRef(null), menu = f.useRef(null);
  const close = f.useCallback(() => setOpen(false),[]);
  const update = f.useCallback(() => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) setPosition({left:Math.max(8,Math.min(box.left,window.innerWidth-248)),bottom:Math.max(8,window.innerHeight-box.top+8),maxHeight:Math.max(100,box.top-16)});
  },[]);
  f.useEffect(() => {
    if (!open) return;
    const dismiss = event => {
      // The existing scheduler uses a portal; its menu remains part of this action.
      if (trigger.current?.contains(event.target) || menu.current?.contains(event.target) || event.target.closest?.('[role="menu"]')) return;
      close();
    };
    const keyboard = event => {
      if (event.key==='Escape') { event.preventDefault();close();trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown',dismiss);
    document.addEventListener('keydown',keyboard);
    window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
    return () => {document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',keyboard);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[open,close,update]);
  const choose = action => {close();action?.();};
  const focusItem = event => {
    if (!menu.current?.contains(event.target)) return; // Nested scheduler owns its keyboard events.
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    const items=Array.from(menu.current?.querySelectorAll('[role="menuitem"]:not(:disabled)')||[]);
    const index=items.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;
    event.preventDefault();items[next]?.focus();
  };
  return s.jsxs(s.Fragment,{children:[
    s.jsx('button',{ref:trigger,type:'button',className:'cloudcli-composer-plus','aria-label':'添加附件、命令或定时发送','aria-haspopup':'menu','aria-expanded':open,
      onClick:()=>{update();setOpen(value=>!value);},onKeyDown:event=>{if(event.key==='ArrowDown'){event.preventDefault();update();setOpen(true);requestAnimationFrame(()=>menu.current?.querySelector('[role="menuitem"]')?.focus());}},
      children:s.jsx('svg',{viewBox:'0 0 24 24',width:20,height:20,fill:'none',stroke:'currentColor',strokeWidth:1.8,'aria-hidden':true,children:s.jsx('path',{d:'M12 5v14M5 12h14',strokeLinecap:'round'})})}),
    open&&position&&qa.createPortal(s.jsxs('div',{ref:menu,role:'menu','aria-label':'添加到消息',className:'cloudcli-composer-actions',style:position,onKeyDown:focusItem,children:[
      s.jsxs('button',{type:'button',role:'menuitem',onClick:()=>choose(attachment.props.onClick),children:[s.jsx(xJ,{className:'h-4 w-4'}),'附加文件']}),
      s.jsxs('button',{type:'button',role:'menuitem',onClick:()=>choose(commands.props.onClick),children:[s.jsx(Oo,{className:'h-4 w-4'}),'显示所有命令']}),
      f.cloneElement(schedule,{cloudcliActionMode:true,onSchedule:date=>{close();schedule.props.onSchedule(date);}})
    ]}),document.body)
  ]});
}
function CloudcliComposerInput({children,...props}) {
  const parts=f.Children.toArray(children), footer=parts.find(child=>child.type===aD);
  if (!footer) return s.jsx(eD,{...props,children});
  const footerParts=f.Children.toArray(footer.props.children);
  const tools=footerParts[0], actions=footerParts[1];
  const toolParts=f.Children.toArray(tools.props.children), actionParts=f.Children.toArray(actions.props.children);
  const attachment=toolParts[0], commands=toolParts.find(child=>child.props?.onClick && child.props?.className==='relative');
  const schedule=actionParts[0], send=actionParts.at(-1);
  const remainingTools=toolParts.filter(child=>child!==attachment && child!==commands);
  const nextFooter=f.cloneElement(footer,{className:'cloudcli-composer-details',children:[
    f.cloneElement(tools,{key:'tools',children:remainingTools}),
    f.cloneElement(actions,{key:'options',className:'cloudcli-composer-options',children:actionParts.slice(1,-1)})
  ]});
  return s.jsx(eD,{...props,'data-cloudcli-actions':'true',children:parts.map(part=>{
    if(part===footer)return nextFooter;
    if(part.type!==nD)return part;
    return f.cloneElement(part,{className:'cloudcli-composer-writing',children:[
      s.jsx('div',{className:'cloudcli-composer-leading',children:s.jsx(CloudcliComposerActions,{attachment,commands,schedule})},'plus'),
      s.jsx('div',{className:'cloudcli-composer-text',children:part.props.children},'text'),
      s.jsx('div',{className:'cloudcli-composer-send',children:send},'send')
    ]});
  })});
}

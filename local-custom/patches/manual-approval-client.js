// Human approvals use the same compact composer card as interactive questions.
// Keep the existing provider decision handlers; displaying a card grants nothing.
function CloudcliApprovalSummary({request}) {
  let input = request.input;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = null; }
  }
  if (!input || typeof input !== 'object') input = {};
  const command = typeof input.command === 'string' ? input.command : Array.isArray(input.command) ? input.command.join(' ') : null;
  const reason = [input.reason,input.justification].find(value => typeof value === 'string' && value.trim());
  const cwd = typeof input.cwd === 'string' ? input.cwd : null;
  return s.jsxs('div',{className:'cloudcli-approval-summary',children:[
    s.jsx('p',{className:'cloudcli-approval-reason-label',children:'申请原因'}),
    s.jsx('p',{className:'cloudcli-approval-reason',children:reason||'此请求未提供申请原因。'}),
    (command||cwd)&&s.jsxs('details',{className:'cloudcli-approval-operation',children:[
      s.jsx('summary',{children:'查看操作详情'}),
      command&&s.jsx('pre',{className:'cloudcli-approval-command',children:command}),
      cwd&&s.jsxs('p',{className:'cloudcli-approval-cwd',children:['执行目录：',s.jsx('code',{children:cwd})]}),
    ]}),
  ]});
}
function CloudcliManualApprovals(props) {
  const requests = props.pendingPermissionRequests || [];
  const manual = requests.filter(request => request.toolName !== 'AskUserQuestion');
  const questions = requests.filter(request => request.toolName === 'AskUserQuestion');
  const key = manual.map(request => request.requestId).join('|');
  const [postponed,setPostponed] = f.useState(null);
  const open = manual.length > 0 && postponed !== key;
  const planRequests = manual.filter(request => ['ExitPlanMode','exit_plan_mode'].includes(request.toolName));
  const normalRequests = manual.filter(request => !['ExitPlanMode','exit_plan_mode'].includes(request.toolName));
  return s.jsxs(s.Fragment,{children:[
    questions.length>0&&s.jsx(CloudcliInlinePermissionRequests,{...props,pendingPermissionRequests:questions},'interactive-questions'),
    manual.length>0&&s.jsxs(s.Fragment,{children:[
      !open&&s.jsx('button',{type:'button',className:'cloudcli-approval-reopen',onClick:()=>setPostponed(null),children:`有 ${manual.length} 项操作等待审核 · 查看`}),
      s.jsxs('section',{className:'cloudcli-manual-approval',role:'region',hidden:!open,
        'aria-labelledby':'cloudcli-manual-approval-title','aria-describedby':'cloudcli-manual-approval-description',
        onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();setPostponed(key);}},children:[
        s.jsxs('header',{className:'cloudcli-approval-header',children:[
          s.jsxs('div',{children:[s.jsx('h2',{id:'cloudcli-manual-approval-title',children:`${props.providerLabel||'助手'} 等待你的审核`}),
            s.jsx('p',{id:'cloudcli-manual-approval-description',children:manual.length>1?`共 ${manual.length} 项操作，可逐项审核。`:'请确认是否允许此操作。'})]}),
          s.jsx('button',{type:'button',className:'cloudcli-approval-postpone',onClick:()=>setPostponed(key),children:'稍后处理'}),
        ]}),
        s.jsxs('div',{className:'cloudcli-approval-body',children:[
          normalRequests.length>0&&s.jsx(CloudcliInlinePermissionRequests,{...props,pendingPermissionRequests:normalRequests}),
          ...planRequests.map(request=>s.jsxs('section',{className:'cloudcli-plan-approval',children:[
            s.jsx('h3',{children:'确认执行计划'}),s.jsx('pre',{children:LN(request.input)}),
            s.jsxs('div',{className:'cloudcli-plan-approval-actions',children:[
              s.jsx('button',{type:'button',onClick:()=>props.handlePermissionDecision(request.requestId,{allow:false,message:'用户拒绝执行此计划'}),children:'拒绝'}),
              s.jsx('button',{type:'button',onClick:()=>props.handlePermissionDecision(request.requestId,{allow:true}),children:'批准执行'}),
            ]})]},request.requestId)),
        ]}),
      ]}),
    ]},'cloudcli-manual-approval-card'),
  ]});
}

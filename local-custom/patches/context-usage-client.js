function CloudcliContextUsageRing({usage,providerLabel}) {
  const codex=providerLabel?.toLowerCase()==='codex';
  const used=usage?.contextUsed ?? (codex?null:usage?.used);
  const total=usage?.total;
  const known=typeof used==='number'&&Number.isFinite(used)&&used>=0&&typeof total==='number'&&Number.isFinite(total)&&total>0;
  const ratio=known?used/total:0;
  const percent=known?Math.round(ratio*100):null;
  const progress=Math.min(1,Math.max(0,ratio));
  const label=known?`上下文占用 ${percent}%`:'上下文占用：暂无数据';
  const format=value=>value.toLocaleString('zh-CN');
  const detail=known?`${format(used)} / ${format(total)} tokens · 剩余 ${format(Math.max(0,total-used))}`:'等待此会话上报上下文用量';
  return s.jsxs('span',{className:'cloudcli-context-meter','data-context-state':known?(ratio>=.9?'high':ratio>=.75?'medium':'normal'):'unknown',tabIndex:0,
    'aria-label':`${label}，${detail}`,children:[
    s.jsxs('span',{className:'cloudcli-context-ring',role:'progressbar','aria-label':'会话上下文占用',
      'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':known?Math.min(100,percent):undefined,'aria-valuetext':`${label}，${detail}`,children:[
      s.jsxs('svg',{viewBox:'0 0 32 32','aria-hidden':true,children:[
        s.jsx('circle',{cx:16,cy:16,r:13,className:'cloudcli-context-track'}),
        s.jsx('circle',{cx:16,cy:16,r:13,pathLength:100,className:'cloudcli-context-progress',strokeDasharray:`${progress*100} 100`,transform:'rotate(-90 16 16)'}),
      ]}),
      s.jsx('span',{className:'cloudcli-context-value','aria-hidden':true,children:known?`${Math.min(999,percent)}%`:'—'}),
    ]}),
    s.jsxs('span',{className:'cloudcli-context-tooltip',role:'tooltip',children:[s.jsx('strong',{children:label}),s.jsx('span',{children:detail})]}),
  ]});
}

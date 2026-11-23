// Pure presentation accounting, shared by the usage cards and their regression test.
export function cloudcliTokenDetailRows(usage = {}, breakdown = {}) {
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const read = (...values) => values.find(valid);
  const input = read(usage.inputTokens, breakdown.input);
  const output = read(usage.outputTokens, breakdown.output);
  const cached = read(usage.cacheReadTokens);
  const creation = read(usage.cacheCreationTokens);
  const reasoning = read(usage.reasoningTokens);
  const used = read(usage.used, valid(input) && valid(output) ? input + output : undefined);
  const format = value => valid(value) ? value.toLocaleString('zh-CN') : '—';
  const ratio = valid(input) && input > 0 && valid(cached) && cached <= input ? cached / input : null;
  return [
    {label:'总 Token', value:format(used)},
    {label:'输入 Token', value:format(input)},
    {label:'缓存命中', value:format(cached)},
    {label:'缓存命中率', value:ratio === null ? '—' : (ratio * 100).toFixed(1) + '%'},
    {label:'缓存写入', value:format(creation)},
    {label:'输出 Token', value:format(output)},
    {label:'其中推理 Token', value:format(reasoning)},
  ];
}
function CloudcliTokenUsageContent({data}) {
  const usage=data.tokenUsage||{}, codex=data.provider==='codex';
  const format=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value.toLocaleString('zh-CN'):'—';
  const cards=[{title:codex?'会话累计消耗':data.provider==='claude'?'最近一次请求用量':'Token 用量',usage,breakdown:data.tokenBreakdown},
    ...(codex?[{title:'最近一次请求',usage:usage.lastUsage||{}}]:[])];
  const contextUsed=usage.contextUsed??(codex?undefined:usage.used);
  return s.jsxs('div',{className:'cloudcli-token-details',children:[
    ...cards.map(card=>s.jsxs('section',{'aria-label':card.title,children:[
      s.jsx('h3',{children:card.title}),
      s.jsx('dl',{children:cloudcliTokenDetailRows(card.usage,card.breakdown).map(row=>s.jsxs('div',{className:'cloudcli-token-row',children:[s.jsx('dt',{children:row.label}),s.jsx('dd',{children:row.value})]},row.label))})
    ]},card.title)),
    s.jsxs('section',{'aria-label':'当前上下文',children:[s.jsx('h3',{children:'当前上下文'}),s.jsxs('dl',{children:[
      s.jsxs('div',{className:'cloudcli-token-row',children:[s.jsx('dt',{children:'上下文占用'}),s.jsx('dd',{children:format(contextUsed)})]}),
      s.jsxs('div',{className:'cloudcli-token-row',children:[s.jsx('dt',{children:'上下文窗口'}),s.jsx('dd',{children:format(usage.total)})]})
    ]})]}),
    s.jsx('p',{className:'cloudcli-token-note',children:'缓存命中已计入输入，推理已计入输出，不重复相加。缓存写入按上游单独上报；— 表示未提供数据。'+(codex?' 累计消耗与当前上下文占用是不同统计。':' 此处显示最近一次请求，非会话累计消耗。')}),
    s.jsxs('div',{className:'cloudcli-token-model',children:[s.jsx('span',{children:d2(data.provider,data.provider||'Unknown')}),s.jsx('span',{children:data.model||'Unknown'})]})
  ]});
}

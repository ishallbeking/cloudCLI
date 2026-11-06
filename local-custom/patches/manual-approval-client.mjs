import fs from 'node:fs/promises';
export async function patchManualApprovals(client) {
  function replace(before,after) {
    if(client.split(before).length!==2)throw new Error(`Manual approval upstream changed: ${before.slice(0,100)}`);
    client=client.replace(before,after);
  }
  // Retain all provider-specific question widgets and existing decision actions.
  replace('function UYe({pendingPermissionRequests:e,', 'function CloudcliInlinePermissionRequests({pendingPermissionRequests:e,');
  replace('s.jsx(UYe,{pendingPermissionRequests:e,providerLabel:d,handlePermissionDecision:t,handleGrantToolPermission:n})',
    's.jsx(CloudcliManualApprovals,{pendingPermissionRequests:e,providerLabel:d,handlePermissionDecision:t,handleGrantToolPermission:n})');
  const start=client.indexOf('function CloudcliInlinePermissionRequests('),end=client.indexOf('const qYe=',start);
  if(start<0||end<0||end-start>7000)throw new Error('Manual approval card boundaries changed');
  let card=client.slice(start,end);
  const summary='c&&s.jsxs("details",{className:"mt-2",children:';
  if(card.split(summary).length!==2)throw new Error('Manual approval input summary changed');
  card=card.replace(summary,'s.jsx(CloudcliApprovalSummary,{request:i}),'+summary);
  // Keep the command-based remembered rule available without competing with
  // the human-readable approval reason in the main card.
  const rule='p&&s.jsxs("div",{className:"mt-1 text-xs text-muted-foreground",children:["Allow rule: ",s.jsx("code",{className:"rounded bg-muted px-1 py-0.5 text-xs",children:p})]})';
  if(card.split(rule).length!==2)throw new Error('Manual approval rule display changed');
  card=card.replace(rule,'p&&s.jsxs("details",{className:"mt-1 text-xs text-muted-foreground",children:[s.jsx("summary",{className:"cursor-pointer",children:"查看授权规则"}),s.jsx("code",{className:"rounded bg-muted px-1 py-0.5 text-xs",children:p})]})');
  for(const [before,after] of [['"Permission required"','"等待确认"'],['"Tool: "','"操作："'],['"View tool input"','"查看完整请求"'],['"Deny"','"拒绝"'],['"Allow & remember"','"允许并记住规则"'],['"Allow once"','"仅允许这一次"']])card=card.replace(before,after);
  client=client.slice(0,start)+card+client.slice(end);
  client+='\n'+await fs.readFile(new URL('./manual-approval-client.js',import.meta.url),'utf8');
  return client;
}

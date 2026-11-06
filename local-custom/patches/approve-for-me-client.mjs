// Codex-native automatic review; separate from Claude's `auto` mode.
export function patchApproveForMeClient(client) {
  function replaceOnce(before, after) {
    if (client.split(before).length !== 2) throw new Error(`Approve for me client upstream changed: ${before.slice(0, 90)}`);
    client = client.replace(before, after);
  }
  replaceOnce('codex:["default","acceptEdits","bypassPermissions"]',
    'codex:["default","approveForMe","acceptEdits","bypassPermissions"]');
  replaceOnce('yv=e=>aZe[e]??oZe;',
    'yv=e=>e==="approveForMe"?{...aZe.auto,label:"Approve for me"}:aZe[e]??oZe;');
  replaceOnce('function sZe({permissionMode:e,permissionModes:t,onSelectPermissionMode:n,providerLabel:r}){const{t:a}=Te("chat"),',
    'function sZe({permissionMode:e,permissionModes:t,onSelectPermissionMode:n,providerLabel:r}){const{t:a,i18n:cloudcliApprovalI18n}=Te("chat"),');
  // Existing menu already persists values per provider/session and cycles by Tab.
  // Supply translations through the same labels/descriptions as other modes.
  replaceOnce('m=x=>a(`codex.modes.${x}`,{defaultValue:yv(x).label||x})',
    'm=x=>x==="approveForMe"?(/^zh\\b/i.test(cloudcliApprovalI18n.resolvedLanguage||cloudcliApprovalI18n.language||document.documentElement.lang||navigator.language)?"Approve for me（自动审核）":"Approve for me"):a(`codex.modes.${x}`,{defaultValue:yv(x).label||x})');
  replaceOnce('description:a(`codex.descriptions.${x}`,{defaultValue:""})||void 0',
    'description:x==="approveForMe"?(/^zh\\b/i.test(cloudcliApprovalI18n.resolvedLanguage||cloudcliApprovalI18n.language||document.documentElement.lang||navigator.language)?"在工作区沙箱内运行；需要额外权限时由 Codex 自动审核，可批准或拒绝。":"Run in the workspace sandbox. Codex automatically reviews requests for additional permissions and may approve or deny them."):a(`codex.descriptions.${x}`,{defaultValue:""})||void 0');
  return client;
}

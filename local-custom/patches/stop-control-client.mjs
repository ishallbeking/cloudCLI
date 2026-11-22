import fs from 'node:fs/promises';
export async function patchStopControl(client) {
  const replace=(before,after)=>{
    if(client.split(before).length!==2)throw Error('Stop control anchor changed: '+before.slice(0,90));
    client=client.replace(before,after);
  };
  // Report delivery to the caller; a closed socket used to discard Stop silently.
  replace('v&&v.readyState===WebSocket.OPEN?v.send(JSON.stringify(b)):console.warn("WebSocket not connected")',
    'if(v&&v.readyState===WebSocket.OPEN){try{v.send(JSON.stringify(b));return true}catch{}}console.warn("WebSocket not connected");return false');
  replace('Cr=f.useCallback(()=>{if(!p)return;',
    'Cr=f.useCallback(()=>{if(!p){cloudcliStopControl.unavailable(t?.id||n);return;}');
  replace('h({type:"chat.abort",sessionId:Pe})', 'cloudcliRequestStop(Pe,h)');
  // Scope confirmations/errors to the viewed session, after rejecting stale run events.
  replace('T=typeof E.sessionId=="string"&&E.sessionId||A;if(T&&typeof E.seq=="number")',
    'T=typeof E.sessionId=="string"&&E.sessionId||A;cloudcliStopControl.observe({...E,sessionId:T});if(T&&typeof E.seq=="number")');
  replace('function lZe({pendingPermissionRequests:e,', 'function lZe({cloudcliSessionId,pendingPermissionRequests:e,');
  replace('s.jsx(lZe,{pendingPermissionRequests:', 's.jsx(lZe,{cloudcliSessionId:n?.id||ue,pendingPermissionRequests:');
  replace('s.jsxs(CloudcliComposerInput,{onSubmit:',
    's.jsxs(CloudcliComposerInput,{cloudcliSessionId,cloudcliAbortHandler:o,onSubmit:');
  client+='\n'+(await fs.readFile(new URL('./stop-control-state.js',import.meta.url),'utf8')).replace('export function','function');
  client+='\n'+await fs.readFile(new URL('./stop-control-client.js',import.meta.url),'utf8');
  return client;
}

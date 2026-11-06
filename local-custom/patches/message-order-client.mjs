// Called by the existing file-tree/question builder before hashing the asset.
import fs from 'node:fs/promises';
export async function patchMessageOrder(client) {
  const replace = (before, after) => {
    if (client.split(before).length !== 2) throw new Error(`Message order upstream changed: ${before.slice(0, 90)}`);
    client = client.replace(before, after);
  };
  client += '\n' + (await fs.readFile(new URL('./codex-message-order.js', import.meta.url), 'utf8')).replaceAll('export ', '');
  replace('function Oye(e,t){', 'function Oye(e,t){if(cloudcliIsCodexHistory(e,t))return cloudcliMergeCodexMessages(e,t);');
  replace('function mz(e,t){', 'function mz(e,t){if(cloudcliIsCodexHistory(e,t))return cloudcliCodexPending(e,t);');
  replace('let S=[...x.realtimeMessages,k];', 'let S=k.provider==="codex"?cloudcliCodexUpsert(x,k):[...x.realtimeMessages,k];');
  replace('function xN(e,t,n){const r=`local_', 'function xN(e,t,n){const r=e.id||`local_');
  replace('const Wi=Yn,zc={type:"user",', 'const Wi=Yn,zc={id:`local_${Date.now()}_${Math.random().toString(36).slice(2,12)}`,type:"user",');
  replace('options:{...Ue?.options??et(Ln),attachments:Yn}', 'options:{...Ue?.options??et(Ln),attachments:Yn,clientMessageId:zc.id}');
  // The old display adapter dropped message identity before React chose a key.
  replace('x={displayText:m.displayText,commandName:m.commandName,',
    'x={id:m.id,messageId:m.id,turnId:m.turnId,parentUserMessageId:m.parentUserMessageId,isStreaming:m.isStreaming,displayText:m.displayText,commandName:m.commandName,');
  replace('function rT({lazyRows:e,timestamp:t,initiallyNearViewport:n,children:r})',
    'function rT({lazyRows:e,timestamp:t,initiallyNearViewport:n,children:r,messageId:cloudcliMessageId})');
  replace('ref:c,"data-message-timestamp":t||void 0,style:u?',
    'ref:c,"data-message-timestamp":t||void 0,"data-message-row-id":cloudcliMessageId,style:u?');
  const rowPattern='lazyRows:xe,timestamp:K.timestamp,initiallyNearViewport:re,';
  if (client.split(rowPattern).length !== 3) throw new Error('Unexpected lazy message rows');
  client=client.replaceAll(rowPattern,'lazyRows:xe,timestamp:K.timestamp,messageId:K.id||K.messages?.[0]?.id,initiallyNearViewport:re,');
  replace('j=E=>{if(!E.kind)return;const A=k.current,',
    'j=E=>{if(!E.kind||((E.provider||n)==="codex"&&!cloudcliAcceptRunEvent(E)))return;const A=k.current,');
  // The sequence and run id must be read from the SAME cursor. The upstream
  // per-session lastSeq ref can still contain a larger previous-run value.
  replace('sessionId:n.id,lastSeq:p.current.get(n.id)??0',
    'sessionId:n.id,...cloudcliRunCursor(n.id,p.current.get(n.id)??0)');
  replace('sessionId:n.id,lastSeq:P.current.get(n.id)??0',
    'sessionId:n.id,...cloudcliRunCursor(n.id,P.current.get(n.id)??0)');
  replace('E.isProcessing?m?.(T):h?.(T,{ifStartedBefore:p.current.get(T)})',
    'E.isProcessing?m?.(T,{statusText:E.statusText,canInterrupt:E.canInterrupt!==false}):h?.(T,{ifStartedBefore:p.current.get(T)})');
  return client;
}

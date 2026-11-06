import fs from 'node:fs/promises';
export async function patchContextUsage(client){
  const before='s.jsx(JYe,{disabled:!G.trim(),onSchedule:q}),s.jsx(eZe,{effort:u,';
  const after='s.jsx(JYe,{disabled:!G.trim(),onSchedule:q}),s.jsx(CloudcliContextUsageRing,{usage:y,providerLabel:d}),s.jsx(eZe,{effort:u,';
  if(client.split(before).length!==2)throw new Error('Context ring composer position changed');
  client=client.replace(before,after);
  const initial='f.useEffect(()=>{if(!n?.id){T(null);return}(async()=>{try{const Xe=await ke.providers.sessionTokenUsage(n.id);if(Xe.ok){const bt=await Xe.json();T(bt.data??null)}else T(null)}catch(Xe){console.error("Failed to fetch initial token usage:",Xe)}})()},[n?.id]);';
  const guarded='f.useEffect(()=>{let cancelled=false;T(null);if(!n?.id)return;(async()=>{try{const Xe=await ke.providers.sessionTokenUsage(n.id);if(Xe.ok){const bt=await Xe.json();if(!cancelled)T(previous=>previous??bt.data??null)}}catch(Xe){if(!cancelled)console.error("Failed to fetch initial token usage:",Xe)}})();return()=>{cancelled=true}},[n?.id]);';
  if(client.split(initial).length!==2)throw new Error('Context usage session loading changed');
  return client.replace(initial,guarded)+'\n'+await fs.readFile(new URL('./context-usage-client.js',import.meta.url),'utf8');
}

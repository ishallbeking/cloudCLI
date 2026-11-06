import fs from 'node:fs/promises';
export async function patchConversationNavigation(client) {
  const replace = (before, after) => {
    if (client.split(before).length !== 2) throw new Error(`Navigation upstream changed: ${before.slice(0,100)}`);
    client = client.replace(before,after);
  };
  client += '\n' + await fs.readFile(new URL('./conversation-navigation-client.js',import.meta.url),'utf8');
  replace('children:r,messageId:cloudcliMessageId})', 'children:r,messageId:cloudcliMessageId,messageIds:cloudcliMessageIds})');
  replace('"data-message-row-id":cloudcliMessageId,style:', '"data-message-row-id":cloudcliMessageId,"data-message-row-ids":cloudcliMessageIds?JSON.stringify(cloudcliMessageIds):void 0,style:');
  const groupedRows = 'messageId:K.id||K.messages?.[0]?.id,initiallyNearViewport:re,';
  if (client.split(groupedRows).length !== 3) throw new Error('Unexpected navigation group rows');
  client = client.replaceAll(groupedRows,'messageId:K.id||K.messages?.[0]?.id,messageIds:K.messages?.map(message=>message.id).filter(Boolean),initiallyNearViewport:re,');

  replace('},[Ie,$e]),Fe=f.useCallback(ze=>{', `},[Ie,$e]),cloudcliNav=useCloudcliNavigation({sessionId:me,active:e,scrollRef:V,messages:Ae,
    suspend:()=>{Z.current=true;je.current=false;pe.current=true;E(true)},release:()=>{Z.current=false},
    resume:()=>{Z.current=false;pe.current=false;E(false);requestAnimationFrame(()=>requestAnimationFrame(()=>{const pane=V.current;if(pane)pane.scrollTop=pane.scrollHeight}))}}),Fe=f.useCallback(ze=>{`);
  replace('const Ke=f.useCallback(()=>{const ze=V.current;', 'const Ke=f.useCallback(()=>{if(cloudcliNav.isViewing()){cloudcliNav.resume();return}const ze=V.current;');
  replace('Ct=f.useCallback(()=>{Ke(),R&&', 'Ct=f.useCallback(()=>{cloudcliNav.reset();Z.current=false;Ke();requestAnimationFrame(Ke);R&&');
  replace('an=f.useCallback(async()=>{if(!e)return;const ze=V.current;', 'an=f.useCallback(async()=>{if(!e)return;if(cloudcliNav.isViewing()||cloudcliNav.loading){E(true);return}const ze=V.current;');
  // Do not preserve a live-tail scroll position over a deliberate navigation jump.
  replace('if(nn.current=e,!e||!V.current)return;const Xe=V.current;', 'if(nn.current=e,!e||!V.current||cloudcliNav.view)return;const Xe=V.current;');
  replace('e&&(!V.current||Ae.length===0||ne.current||y||xe.current||Z.current||j||', 'e&&(!V.current||Ae.length===0||cloudcliNav.view||cloudcliNav.loading||ne.current||y||xe.current||Z.current||j||');
  replace('const Rn=f.useCallback(async()=>{if(!e||!n||!t||q)return;', 'const Rn=f.useCallback(async()=>{if(!e||!n||!t||q)return;cloudcliNav.reset();Z.current=false;');
  replace('dn=f.useCallback(ze=>{const Xe=Ae.indexOf(ze);', 'dn=f.useCallback(ze=>{if(ze.id){cloudcliNav.jump(ze.id);return}const Xe=Ae.indexOf(ze);');
  replace('return{chatMessages:Ae,addMessage:Fe,sessionActivity:ue,', 'return{cloudcliNavigation:cloudcliNav,cloudcliLiveMessages:Ae,chatMessages:cloudcliNav.view?.messages||Ae,addMessage:Fe,sessionActivity:ue,');
  replace('isLoadingMoreMessages:y,hasMoreMessages:k,totalMessages:C,isUserScrolledUp:j,', 'isLoadingMoreMessages:cloudcliNav.view?cloudcliNav.loading:y,hasMoreMessages:cloudcliNav.view?cloudcliNav.view.hasBefore:k,totalMessages:cloudcliNav.view?.total||C,isUserScrolledUp:j,');
  replace('visibleMessageCount:D,visibleMessages:Bn,loadEarlierMessages:Kn,revealMessage:dn,', 'visibleMessageCount:cloudcliNav.view?.messages.length||D,visibleMessages:cloudcliNav.view?.messages||Bn,loadEarlierMessages:cloudcliNav.view?cloudcliNav.before:Kn,revealMessage:dn,');
  replace('createDiff:Zt,scrollContainerRef:an,scrollToBottom:nn,scrollToBottomAndReset:Bn,handleScroll:Rn,requestLatestMessages:Kt}=nxe(', 'createDiff:Zt,scrollContainerRef:an,scrollToBottom:nn,scrollToBottomAndReset:Bn,handleScroll:Rn,requestLatestMessages:Kt,cloudcliNavigation:cloudcliNavigation,cloudcliLiveMessages:cloudcliLiveMessages}=nxe(');
  replace('s.jsx(CloudcliCodexQuestions,{sessionId:ue||n?.id,', 's.jsx(CloudcliConversationRail,{sessionId:n?.id||ue,active:e,scrollRef:an,messages:cloudcliLiveMessages,navigation:cloudcliNavigation},"navigation-"+(n?.id||ue||"new")),s.jsx(CloudcliCodexQuestions,{sessionId:ue||n?.id,');
  return client;
}

// Used by the composer and realtime adapter. Never replay a stop after reconnect:
// a later turn on the same session must not receive an old cancellation request.
export function createCloudcliStopControl({setTimer=setTimeout,clearTimer=clearTimeout,timeout=12000}={}) {
  const states=new Map(),timers=new Map(),listeners=new Set();
  const notify=()=>listeners.forEach(listener=>listener());
  const clear=sessionId=>{
    clearTimer(timers.get(sessionId));timers.delete(sessionId);
    if(states.delete(sessionId))notify();
  };
  const put=(sessionId,value)=>{
    clearTimer(timers.get(sessionId));timers.delete(sessionId);
    states.set(sessionId,value);
    if(states.size>32)clear(states.keys().next().value);
    notify();
  };
  const fail=(sessionId,runId,text)=>put(sessionId,{phase:'error',runId,text});
  return {
    get:sessionId=>states.get(sessionId)||null,
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    unavailable:sessionId=>{if(sessionId)fail(sessionId,null,'当前生成由其他客户端运行，请在启动它的终端或客户端停止。');},
    request(sessionId,runId,send) {
      if(!sessionId||states.get(sessionId)?.phase==='pending')return;
      put(sessionId,{phase:'pending',runId,text:'正在停止，等待确认…'});
      let sent=false;
      try{sent=send({type:'chat.abort',sessionId})===true;}catch{}
      if(!sent){fail(sessionId,runId,'连接已断开，停止请求未发出。连接恢复后请再次点击停止。');return;}
      // A mocked/synchronous transport can complete during send().
      if(states.get(sessionId)?.phase!=='pending')return;
      timers.set(sessionId,setTimer(()=>fail(sessionId,runId,'尚未收到停止确认，请检查连接后重试。'),timeout));
    },
    observe(event) {
      const sessionId=event.sessionId,state=states.get(sessionId);
      if(!state)return;
      if(state.runId&&event.runId&&state.runId!==event.runId){
        if(event.kind==='chat_subscribed'||event.kind==='status')clear(sessionId);
        return;
      }
      if(event.kind==='complete'||event.kind==='chat_subscribed'&&event.isProcessing===false)clear(sessionId);
      else if(event.kind==='protocol_error')fail(sessionId,state.runId,String(event.error||'停止请求失败，请重试。'));
    },
  };
}

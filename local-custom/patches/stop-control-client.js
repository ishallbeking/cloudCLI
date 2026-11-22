const cloudcliStopControl=createCloudcliStopControl();
function cloudcliRequestStop(sessionId,send) {
  cloudcliStopControl.request(sessionId,cloudcliRunCursor(sessionId).runId,send);
}
function CloudcliStopFeedback({sessionId,state}) {
  if(!state)return null;
  return s.jsx('div',{className:'cloudcli-stop-feedback','data-phase':state.phase,role:state.phase==='error'?'alert':'status',children:state.text});
}

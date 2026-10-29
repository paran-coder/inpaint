export function connectionControls({phase='idle',connected=false,hasSession=false,usageLimited=false}={}){
  const busy=phase==='connecting',ready=connected&&phase==='ready';
  const label=busy?'연결 중…':phase==='error'?'연결 오류':usageLimited&&hasSession?'사용 제한':ready?'AI 연결됨':hasSession?'다시 연결':'AI 연결';
  return {label,busy,disabled:busy||(ready&&!usageLimited),disconnectDisabled:!hasSession&&!busy};
}
export function paintConnectionControls(state){
  const model=connectionControls(state),connect=document.querySelector('#ai-connect'),disconnect=document.querySelector('#ai-disconnect');
  connect.textContent=model.label;connect.disabled=model.disabled;connect.setAttribute('aria-busy',String(model.busy));connect.title=state.hint||model.label;
  disconnect.hidden=false;disconnect.disabled=model.disconnectDisabled;
}

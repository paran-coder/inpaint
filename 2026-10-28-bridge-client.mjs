const PAGE=crypto.randomUUID().replaceAll('-','');
const STORAGE='inpaint.bridge.v1',CLIENT='inpaint.bridge.client.v1',BASE='http://127.0.0.1:4182';
let credentials=null,socket=null,opening=null,phase='idle',message='',intentional=false,unloading=false,connectSerial=0,retryTimer=null,retries=0;
function store(value){try{if(value)sessionStorage.setItem(STORAGE,JSON.stringify(value));else sessionStorage.removeItem(STORAGE);}catch{}}
try{const value=JSON.parse(sessionStorage.getItem(STORAGE)||'null');if(/^[A-Za-z0-9_-]{43}$/.test(value?.token||''))credentials=value;
  const hash=new URLSearchParams(location.hash.slice(1));if(/^[A-Za-z0-9_-]{43}$/.test(hash.get('bridge_token')||'')&&hash.get('bridge_port')==='4182'){credentials={token:hash.get('bridge_token')};store(credentials);hash.delete('bridge_token');hash.delete('bridge_port');history.replaceState(null,'',location.pathname+location.search+(hash.size?'#'+hash:''));}
}catch{}
function emit(next,text=''){phase=next;message=text;window.dispatchEvent(new CustomEvent('inpaint-ai-connection',{detail:{phase,message}}));}
export const bridgeState=()=>({phase,message,hasSession:!!credentials});
function unavailable(text='AI 연결 버튼으로 이 컴퓨터의 브릿지를 연결해주세요.'){const error=Error(text);error.name='BridgeUnavailableError';return error;}
async function ensureSocket(){
  if(unloading)throw unavailable();if(socket?.readyState===WebSocket.OPEN)return;if(opening)return opening;if(!credentials)throw unavailable();
  const saved=credentials;
  opening=(async()=>{
    const ping=await fetch(BASE+'/bridge/ping',{headers:{Authorization:'Bearer '+saved.token,'X-Inpaint-Tab':PAGE},cache:'no-store',signal:AbortSignal.timeout(8000)});if(!ping.ok)throw unavailable('브릿지 세션이 종료되었습니다. AI 연결을 다시 눌러주세요.');
    if(credentials!==saved||intentional||unloading)throw unavailable();
    await new Promise((resolve,reject)=>{const ws=new WebSocket('ws://127.0.0.1:4182/bridge/lease',['inpaint.v1','auth.'+saved.token,'page.'+PAGE]);socket=ws;let settled=false;const timer=setTimeout(()=>{ws.close();reject(unavailable('로컬 연결 권한과 브릿지 실행 상태를 확인해주세요.'));},8000);
      ws.onopen=()=>{if(intentional||unloading||credentials!==saved){ws.close();clearTimeout(timer);reject(unavailable());return;}settled=true;clearTimeout(timer);retries=0;emit('ready');resolve();};
      ws.onerror=()=>{if(!settled){clearTimeout(timer);reject(unavailable('브릿지 연결을 열지 못했습니다. 로컬 네트워크 접근을 허용했는지 확인해주세요.'));}};
      ws.onclose=()=>{clearTimeout(timer);if(socket!==ws)return;socket=null;if(!settled)reject(unavailable());if(!intentional&&!unloading&&credentials){emit('error','AI 연결이 끊겼습니다. 다시 연결하고 있습니다.');scheduleReconnect();}};
    });
  })().catch(error=>{if(credentials===saved&&!intentional)emit('error',error.message);throw error;}).finally(()=>{if(credentials===saved)opening=null;});return opening;
}
function scheduleReconnect(){clearTimeout(retryTimer);if(retries++>=20)return;retryTimer=setTimeout(()=>{if(!intentional&&!unloading&&credentials)ensureSocket().catch(()=>scheduleReconnect());},1000);}
export async function connectBridge(){
  if(socket?.readyState===WebSocket.OPEN){emit('ready');return;}
  intentional=false;unloading=false;clearTimeout(retryTimer);const id=++connectSerial;socket?.close();socket=null;opening=null;credentials=null;store(null);emit('connecting','AI를 연결하고 있습니다…');
  let client;try{client=sessionStorage.getItem(CLIENT);}catch{}if(!/^[a-f0-9]{32}$/.test(client||'')){client=crypto.randomUUID().replaceAll('-','');try{sessionStorage.setItem(CLIENT,client);}catch{}}
  // This invocation is initiated by the user's AI-connect click. OS/browser confirmation remains browser-controlled.
  location.href='inpaint-ai://connect?client='+client;
  const started=Date.now();while(Date.now()-started<30000){if(id!==connectSerial)throw unavailable('연결이 취소되었습니다.');
    try{const response=await fetch(BASE+'/bridge/pair?client='+client,{cache:'no-store',signal:AbortSignal.timeout(2000)});if(response.ok){const result=await response.json();if(!/^[A-Za-z0-9_-]{43}$/.test(result.token||''))throw unavailable();if(id!==connectSerial)throw unavailable();credentials={token:result.token};store(credentials);await ensureSocket();return;}}catch{}
    await new Promise(r=>setTimeout(r,500));
  }emit('error','브릿지를 먼저 등록하고, 브라우저의 앱 실행·로컬 연결 확인을 허용해주세요.');throw unavailable(message);
}
export async function disconnectBridge(){
  intentional=true;connectSerial++;clearTimeout(retryTimer);const saved=credentials;credentials=null;store(null);socket?.close();socket=null;opening=null;let confirmed=!saved;
  if(saved)try{const r=await fetch(BASE+'/bridge/disconnect',{method:'POST',headers:{Authorization:'Bearer '+saved.token,'X-Inpaint-Tab':PAGE},signal:AbortSignal.timeout(4000)});confirmed=r.ok;}catch{}
  emit('idle',confirmed?'AI 연결을 해제했습니다.':'웹 연결은 해제됐습니다. 브릿지는 마지막 연결 종료 후 자동 정리됩니다.');return confirmed;
}
export async function apiFetch(resource,options={}){
  if(!/^\/api\/(?:status|progress|image|cancel)(?:\?|$)/.test(resource))throw unavailable('허용되지 않은 AI 요청입니다.');
  await ensureSocket();const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+credentials.token);headers.set('X-Inpaint-Tab',PAGE);return fetch(BASE+resource,{...options,headers,cache:'no-store'});
}
window.addEventListener('pagehide',()=>{unloading=true;clearTimeout(retryTimer);socket?.close();});
window.addEventListener('pageshow',event=>{unloading=false;if(event.persisted&&credentials){intentional=false;ensureSocket().catch(()=>{});}});

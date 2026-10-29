import {matchColorRGBA,blendSubjectEdges,contextOverlay} from './2026-10-28-harmonize.mjs';
import {apiFetch,connectBridge,disconnectBridge,bridgeState} from './2026-10-28-bridge-client.mjs';
import {sessionStore} from './2026-10-28-storage.mjs';
import {layerCommand,recoverCheckerboard,deleteIntent,resizeDimensions,isAdditionRequest,fitAddition,overRGBA,blendRGBA,featherInside,History,requestGeometry,selectionClickIntent} from './2026-10-28-core.mjs';
import {removeBackground} from './2026-10-28-background.mjs';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const canvas=$('#canvas'),overlay=$('#overlay'),stage=$('#stage'),frame=$('#canvas-frame');
let state=null,history=null,tool='move',mode='edit',zoom=1,pan={x:0,y:0},drag=null,space=false;
let connected=false,processing=false,generating=false,controller=null,pending=null,showOriginal=false,toastTimer,serial=0,revision=0,requestSerial=0;
let cursorPosition=null,importTarget=null;
let connectionState=null;
let progressTimer=null,generationStarted=0,currentRequestId=null,cancelling=false;
function stopProgress(){clearInterval(progressTimer);progressTimer=null;}
function startProgress(){stopProgress();generationStarted=Date.now();let polling=false;const tick=async()=>{if(!generating)return;$('#busy-elapsed').textContent=`${Math.floor((Date.now()-generationStarted)/1000)}초 경과`;if(polling)return;polling=true;try{const r=await apiFetch('/api/progress?requestId='+encodeURIComponent(currentRequestId));const p=await r.json();if(generating&&p.active&&p.requestId===currentRequestId)$('#busy-message').textContent=({preparation:'이미지 준비 및 연결 확인 중',generation:'이미지 생성 중',result:'결과 처리 중'})[p.stage]||'이미지 생성 중';}catch{}finally{polling=false;}};progressTimer=setInterval(tick,1000);tick();}
const modeDrafts={edit:'',composite:'',generate:''};
const contourCache=new WeakMap();
const brushCursor=document.createElement('div');brushCursor.id='brush-cursor';brushCursor.hidden=true;brushCursor.setAttribute('aria-hidden','true');stage.append(brushCursor);overlay.tabIndex=0;
const modeCopy={
  edit:{title:'어떻게 바꿀까요?',placeholder:'예: 선택한 부분을 따뜻한 햇살이 드는 창문으로 바꿔줘.',action:'선택 영역 수정',hint:'수정할 영역을 선택하고 변경할 내용을 입력하세요.',chips:[['물체 지우기','선택한 물체를 지우고 주변 배경으로 자연스럽게 채워줘.'],['식물 추가','선택한 부분에 자연스러운 초록 식물을 추가해줘.'],['조명 바꾸기','선택한 부분을 따뜻한 조명으로 바꿔줘.']]},
  composite:{title:'장면에 어떻게 어우러질까요?',placeholder:'예: 배치한 제품의 색감과 조명을 배경에 맞추고 바닥에 부드러운 그림자를 더해줘.',action:'배경과 어우르기',hint:'이미지를 불러와 배치한 뒤 바로 합성하세요.',chips:[['조명 맞추기','배치한 이미지의 조명 방향과 색온도를 배경에 맞춰줘.'],['그림자 추가','배치한 대상 아래에 자연스러운 접지 그림자를 더해줘.'],['색감 통일','배치한 대상과 배경의 색감과 대비를 자연스럽게 맞춰줘.']]},
  generate:{title:'어떤 장면을 만들까요?',placeholder:'예: 아침 햇살이 비치는 미니멀한 거실 장면. 크림색 벽과 초록색 소파, 자연스러운 사진.',action:'새 이미지 생성',hint:'선택 영역 없이 새로운 이미지를 만듭니다.',chips:[['제품 사진','부드러운 스튜디오 조명 아래 놓인 세련된 향수 제품 사진 장면.'],['실내 공간','따뜻한 햇살과 식물이 어우러진 미니멀한 실내 장면.'],['자연 풍경','안개 낀 산과 호수가 보이는 평화로운 자연 풍경 장면.']]}
};
const toolInfo={move:['이동','레이어를 드래그해 배치하세요'],brush:['브러시 선택','수정할 부분을 칠해주세요'],rect:['사각형 선택','드래그하여 영역을 선택하세요'],lasso:['올가미 선택','원하는 영역의 테두리를 그려주세요'],erase:['배경 지우기','현재 레이어의 배경을 지웁니다'],restore:['원본 복원','현재 레이어의 원본을 복원합니다'],protect:['보호 영역','AI가 바꾸면 안 되는 부분을 칠해주세요']};
function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function copy(c){const n=makeCanvas(c.width,c.height);n.getContext('2d').drawImage(c,0,0);return n;}
function pixels(c){return c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height);}
function alpha(c){const d=pixels(c).data,a=new Uint8ClampedArray(c.width*c.height);for(let i=0;i<a.length;i++)a[i]=d[i*4+3];return a;}
function fromPixels(data,w,h){const c=makeCanvas(w,h);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),w,h),0,0);return c;}
function active(){return state?.layers.find(l=>l.id===state.active);}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,6500);}
function snapshot(){return state;}
function commit(next=state,message,label){state={...next,action:label||message||toolInfo[tool][0]};history.push(state);history.trim();revision++;render();if(message)toast(message);}
function updateLayer(changes){state=Object.keys(changes).every(k=>["x","y","width","height","rotation"].includes(k))?layerCommand(state,"transform",{layer:state.active,changes}):{...state,layers:state.layers.map(l=>l.id===state.active?{...l,...changes}:l)};}
function drawLayer(ctx,l){if(!l.visible)return;ctx.save();ctx.globalAlpha=l.opacity;ctx.translate(l.x+l.width/2,l.y+l.height/2);ctx.rotate(l.rotation*Math.PI/180);ctx.drawImage(l.bitmap,-l.width/2,-l.height/2,l.width,l.height);ctx.restore();}
function flatten(doc=state){const c=makeCanvas(doc.width,doc.height),x=c.getContext('2d');doc.layers.forEach(l=>drawLayer(x,l));return c;}
function blankMask(){return makeCanvas(state.width,state.height);}
function countMask(c){const a=alpha(c);let n=0;for(const v of a)if(v)n++;return n;}
function layer(bitmap,name,extra={}){return {id:++serial,name,bitmap,original:bitmap,x:0,y:0,width:bitmap.width,height:bitmap.height,rotation:0,visible:true,opacity:1,...extra};}
function initialize(bitmap,name='새 캔버스',preserveRequest=false,original=bitmap,empty=false){
  if(generating&&!preserveRequest)cancelGeneration();pending=null;revision++;
  const l=layer(bitmap,empty?'레이어 1':name,{original,empty});state={width:bitmap.width,height:bitmap.height,name,layers:[l],active:l.id,selection:makeCanvas(bitmap.width,bitmap.height),protection:makeCanvas(bitmap.width,bitmap.height)};
  history=new History({...state,layers:[],active:null,action:'빈 캔버스'});state={...state,action:empty?'빈 레이어 추가':'이미지 불러오기'};history.push(state);pan={x:0,y:0};tool='move';$('#welcome').hidden=true;frame.hidden=false;fit();render();
}
function fit(){if(!state)return;zoom=Math.min((stage.clientWidth-100)/state.width,(stage.clientHeight-150)/state.height,1);zoom=Math.max(.05,zoom);pan={x:0,y:0};view();}
function view(){if(!state)return;frame.style.width=(pending?.result.width||state.width)+'px';frame.style.height=(pending?.result.height||state.height)+'px';frame.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;$('#zoom-label').textContent=Math.round(zoom*100)+'%';drawOverlay();}
function point(e){const b=overlay.getBoundingClientRect();return {x:(e.clientX-b.left)/b.width*state.width,y:(e.clientY-b.top)/b.height*state.height};}
function localPoint(l,p){const r=-l.rotation*Math.PI/180,dx=p.x-l.x-l.width/2,dy=p.y-l.y-l.height/2;return {x:((dx*Math.cos(r)-dy*Math.sin(r))+l.width/2)*l.bitmap.width/l.width,y:((dx*Math.sin(r)+dy*Math.cos(r))+l.height/2)*l.bitmap.height/l.height};}
function worldPoint(l,x,y){const r=l.rotation*Math.PI/180;return {x:l.x+l.width/2+x*Math.cos(r)-y*Math.sin(r),y:l.y+l.height/2+x*Math.sin(r)+y*Math.cos(r)};}
function layerCorners(l){return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>worldPoint(l,a*l.width/2,b*l.height/2));}
function transformHit(l,p){
  if(!l?.visible||l.contextPatch)return {type:'move',cursor:'move'};
  const corners=layerCorners(l),corner=corners.findIndex(a=>Math.hypot(a.x-p.x,a.y-p.y)<12/zoom);
  if(corner>=0){
    const a=corners[corner],angle=((Math.atan2(a.y-l.y-l.height/2,a.x-l.x-l.width/2)*180/Math.PI)%180+180)%180;
    return {type:'resize',cursor:['ew-resize','nwse-resize','ns-resize','nesw-resize'][Math.round(angle/45)%4]};
  }
  const rot=worldPoint(l,0,-l.height/2-28/zoom);
  return Math.hypot(rot.x-p.x,rot.y-p.y)<12/zoom?{type:'rotate',cursor:'grab'}:{type:'move',cursor:'move'};
}
function selectionPath(mask){
  if(contourCache.has(mask))return contourCache.get(mask);
  const data=alpha(mask),w=mask.width,h=mask.height,p=new Path2D(),edges=new Map(),stride=w+1;
  const line=(x,y,a,b)=>{const key=y*stride+x,list=edges.get(key)||[];list.push(b*stride+a);edges.set(key,list);};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(data[i]<128)continue;
    if(y===0||data[i-w]<128)line(x,y,x+1,y);
    if(y===h-1||data[i+w]<128)line(x+1,y+1,x,y+1);
    if(x===0||data[i-1]<128)line(x,y+1,x,y);
    if(x===w-1||data[i+1]<128)line(x+1,y,x+1,y+1);
  }
  for(const [start,list] of edges){while(list.length){p.moveTo(start%stride,Math.floor(start/stride));let at=start;do{const links=edges.get(at);if(!links?.length)break;at=links.pop();p.lineTo(at%stride,Math.floor(at/stride));}while(at!==start);if(at===start)p.closePath();}}
  contourCache.set(mask,p);return p;
}
function updateCursor(){
  if(space)overlay.style.cursor=drag?.type==='pan'?'grabbing':'grab';
  else if(tool==='move'){
    const hit=state&&cursorPosition?transformHit(active(),point({clientX:cursorPosition.x,clientY:cursorPosition.y})):null;
    overlay.style.cursor=drag?.type==='rotate'?'grabbing':drag?.cursor||hit?.cursor||'move';
  }else overlay.style.cursor=['brush','erase','restore','protect'].includes(tool)?'none':'crosshair';
  const visible=state&&cursorPosition&&['brush','erase','restore','protect'].includes(tool)&&!space&&!pending&&!generating&&!processing;
  brushCursor.hidden=!visible;if(!visible)return;
  const b=stage.getBoundingClientRect(),size=Number($('#brush-size').value)*zoom;
  brushCursor.style.left=(cursorPosition.x-b.left)+'px';brushCursor.style.top=(cursorPosition.y-b.top)+'px';brushCursor.style.width=size+'px';brushCursor.style.height=size+'px';
}
function drawOverlay(){
  if(!state)return;if(overlay.width!==state.width||overlay.height!==state.height){overlay.width=state.width;overlay.height=state.height;}
  const x=overlay.getContext('2d');x.clearRect(0,0,overlay.width,overlay.height);
  if(pending)return;
  for(const [mask,color] of [[state.protection,'#bda0ff']]){
    const tint=copy(mask),t=tint.getContext('2d');t.globalCompositeOperation='source-in';t.fillStyle=color;t.fillRect(0,0,tint.width,tint.height);x.globalAlpha=.32;x.drawImage(tint,0,0);
  }
  x.globalAlpha=1;
  x.save();x.lineWidth=2/zoom;x.strokeStyle='#101010';x.stroke(selectionPath(state.selection));x.strokeStyle='#fff';x.setLineDash([5/zoom,5/zoom]);x.stroke(selectionPath(state.selection));x.restore();
  if(drag?.shape){const s=drag.shape;x.save();x.strokeStyle='#e1ff9e';x.lineWidth=1.5/zoom;x.setLineDash([6/zoom,4/zoom]);x.beginPath();if(tool==='rect')x.rect(s.start.x,s.start.y,s.end.x-s.start.x,s.end.y-s.start.y);else{drag.points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));}x.stroke();x.restore();}
  const l=active();if(tool==='move' && l?.visible&&!l.contextPatch){
    const pts=layerCorners(l);x.strokeStyle='#d5f778aa';x.lineWidth=1.5/zoom;x.beginPath();pts.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.stroke();
    for(const p of pts){x.fillStyle='#e2ff99';x.fillRect(p.x-4/zoom,p.y-4/zoom,8/zoom,8/zoom);}
    const top=worldPoint(l,0,-l.height/2),rot=worldPoint(l,0,-l.height/2-28/zoom);x.beginPath();x.moveTo(top.x,top.y);x.lineTo(rot.x,rot.y);x.stroke();x.beginPath();x.arc(rot.x,rot.y,5/zoom,0,Math.PI*2);x.fill();
  }updateCursor();
}
function drawCanvas(){if(!state)return;const w=pending?.result.width||state.width,h=pending?.result.height||state.height;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const x=canvas.getContext('2d');x.clearRect(0,0,canvas.width,canvas.height);if(pending)x.drawImage(showOriginal?pending.before:pending.result,0,0);else state.layers.forEach(l=>drawLayer(x,l));drawOverlay();}
function updateAvailability(){
  $('#local-harmonize').disabled=!hasBackdrop()||processing||generating||!!pending;
  $('#ai-harmonize').disabled=!hasBackdrop()||processing||generating||!!pending;
  $('#edit-intent').disabled=processing||generating||!!pending;
  const has=!!state,selection=has&&countMask(state.selection)>0;
  $('#generate').disabled=!connected||processing||generating||!!pending||(!has&&mode!=='generate')||(mode==='edit'&&!selection)||(mode==='composite'&&!hasBackdrop());
  $('#generation-help').textContent=generating?'Codex 생성 중입니다. 결과가 도착하면 비교할 수 있습니다.':!connected?(connectionState?.provider==='api'?'API 연결 설정을 확인해주세요.':'AI 연결을 누르거나 연결 도움말에서 Codex 상태를 확인해주세요.'):connectionState?.usageLimited?'구독 사용 제한입니다. 해제 후 다시 시도하거나 연결 상태를 다시 확인해주세요.':mode==='edit'&&!selection?'브러시·사각형·올가미로 수정할 영역을 선택해주세요.':mode==='composite'?'배치 후 실행 · 대상 주변도 보정하며 추가 AI 사용량이 소모됩니다.':'결과를 확인한 후 적용할 수 있습니다.';
  $('#remove-bg').disabled=!active()||processing||generating||!!pending;
  $$('[data-action="undo"]').forEach(b=>b.disabled=!history?.canUndo||processing||generating||!!pending);
  $$('[data-action="redo"]').forEach(b=>b.disabled=!history?.canRedo||processing||generating||!!pending);
  $$('[data-action="export"]').forEach(b=>b.disabled=!has||processing||generating);
  $('#result-panel').hidden=!pending;$('#result-panel>span').textContent=pending?.notice||'생성 결과 미리보기';
  const undoName=history?.canUndo?history.states[history.index]?.action:'',redoName=history?.canRedo?history.states[history.index+1]?.action:'';
  $('#history-status').textContent=undoName?`최근 작업: ${undoName}`:'편집 이력 없음';
  $$('[data-action="undo"]').forEach(b=>b.title=undoName?`실행 취소: ${undoName} (Ctrl+Z)`:'되돌릴 작업 없음');
  $$('[data-action="redo"]').forEach(b=>b.title=redoName?`다시 실행: ${redoName} (Ctrl+Shift+Z)`:'다시 실행할 작업 없음');
}


let layerDragId=null,layerPointer=null,suppressLayerClick=false;
function clearLayerDrop(){document.querySelectorAll('.drop-above,.drop-below,.drag-source,.trash-over').forEach(e=>e.classList.remove('drop-above','drop-below','drag-source','trash-over'));}
function executeLayerCommand(command,payload){
  if(!state||locked())return;
  const next=layerCommand(state,command,payload);if(next===state)return;
  commit(next,null,command==='delete'?'레이어 삭제':'레이어 순서 변경');
  $('#layers').focus({preventScroll:true});
}
const trash=$('[data-action="delete-layer"]');
function layerDropTarget(e){
  const target=document.elementFromPoint(e.clientX,e.clientY);
  if(target?.closest('[data-action="delete-layer"]'))return {command:'delete',payload:{layer:layerDragId}};
  const row=target?.closest('[data-layer-id]');if(!row||Number(row.dataset.layerId)===layerDragId)return null;
  return {command:'moveTo',payload:{layer:layerDragId,target:Number(row.dataset.layerId),position:e.clientY<row.getBoundingClientRect().top+row.offsetHeight/2?'above':'below'},row};
}
document.addEventListener('pointermove',e=>{
  const d=layerPointer;if(!d||e.pointerId!==d.pointer)return;
  if(!d.moving&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<6)return;
  d.moving=true;layerDragId=d.layer;e.preventDefault();clearLayerDrop();
  d.row.classList.add('drag-source');const target=layerDropTarget(e);
  if(target?.command==='delete')trash.classList.add('trash-over');
  else if(target?.row)target.row.classList.add(target.payload.position==='above'?'drop-above':'drop-below');
  const list=$('#layers'),b=list.getBoundingClientRect();if(e.clientX>=b.left&&e.clientX<=b.right){if(e.clientY<b.top+24)list.scrollTop-=12;else if(e.clientY>b.bottom-24)list.scrollTop+=12;}
},{passive:false});
document.addEventListener('pointerup',e=>{
  const d=layerPointer;if(!d||e.pointerId!==d.pointer)return;const target=d.moving?layerDropTarget(e):null;
  layerPointer=null;layerDragId=null;clearLayerDrop();
  if(d.moving){suppressLayerClick=true;setTimeout(()=>suppressLayerClick=false,0);e.preventDefault();if(target)executeLayerCommand(target.command,target.payload);}
});
const cancelLayerDrag=()=>{layerPointer=null;layerDragId=null;clearLayerDrop();};
document.addEventListener('pointercancel',cancelLayerDrag);window.addEventListener('blur',cancelLayerDrag);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&layerPointer){cancelLayerDrag();e.preventDefault();e.stopImmediatePropagation();}});

function renderLayers(){
  $('#layer-count').textContent=state?.layers.length||0;
  const container=$('#layers');container.replaceChildren();
  if(!state){const empty=document.createElement('div');empty.className='empty-layers';empty.textContent='이미지를 열면 레이어가 여기에 표시됩니다.';container.append(empty);return;}
  for(const l of [...state.layers].reverse()){
    const row=document.createElement('div');row.className='layer-item'+(l.id===state.active?' selected':'');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',l.name+' 레이어 선택');
    const thumb=makeCanvas(60,48),ctx=thumb.getContext('2d');const s=Math.min(60/l.bitmap.width,48/l.bitmap.height);ctx.drawImage(l.bitmap,(60-l.bitmap.width*s)/2,(48-l.bitmap.height*s)/2,l.bitmap.width*s,l.bitmap.height*s);row.append(thumb);
    const label=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=l.name;detail.textContent=l.empty?'빈 레이어 · 이미지 불러오기':`${Math.round(l.width)} × ${Math.round(l.height)} · ${Math.round(l.opacity*100)}%`;label.append(name,detail);row.append(label);
    const eye=document.createElement('button');eye.textContent=l.visible?'◉':'○';eye.title=l.visible?'레이어 숨기기':'레이어 표시';eye.setAttribute('aria-label',`${l.name} ${l.visible?'숨기기':'표시'}`);eye.addEventListener('click',e=>{e.stopPropagation();if(locked())return;commit({...state,layers:state.layers.map(a=>a.id===l.id?{...a,visible:!a.visible}:a)});});row.append(eye);

    row.draggable=false;row.dataset.layerId=l.id;
    row.addEventListener('pointerdown',e=>{if(e.button!==0||processing||generating||pending||e.target.closest('button'))return;layerPointer={layer:l.id,x:e.clientX,y:e.clientY,pointer:e.pointerId,row,moving:false};row.setPointerCapture(e.pointerId);});
    row.addEventListener('keydown',e=>{if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const i=state.layers.findIndex(a=>a.id===l.id),target=state.layers[i+(e.key==='ArrowUp'?1:-1)];if(target)executeLayerCommand('moveTo',{layer:l.id,target:target.id,position:e.key==='ArrowUp'?'above':'below'});});
    const select=()=>{if(suppressLayerClick||locked())return;tool='move';state={...state,active:l.id};render();$('#layers').focus({preventScroll:true});};row.addEventListener('click',select);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();select();}});container.append(row);
  }
}
function render(){
  scheduleSave();
  const info=toolInfo[tool];$('#tool-name').textContent=info[0];$('#tool-hint').textContent=info[1];
  $$('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});
  $$('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===(mode==='generate'?'generate':'edit'));b.setAttribute('aria-pressed',String(b.dataset.mode===(mode==='generate'?'generate':'edit')));});
  const additionMode=mode==='edit'&&$('#edit-intent').value==='add';$('#edit-intent-help').textContent=mode==='composite'?'첨부 이미지 주변의 배경·조명·그림자도 바뀔 수 있습니다.':additionMode?'대상과 그림자만 새 레이어로 추가합니다. 불투명한 배경 결과는 적용하지 않습니다.':'주의: 바닥·벽을 포함한 선택 영역 전체를 다시 만듭니다. 배경 색과 질감이 바뀔 수 있습니다.';
  const text=additionMode?{...modeCopy.edit,title:'무엇을 추가할까요?',hint:'선택한 위치에 대상과 그림자만 추가합니다. 배경을 바꾸려면 작업 방식을 변경하세요.',chips:[['강아지 추가','선택한 위치에 작은 강아지 한 마리를 추가해줘.'],['화분 추가','선택한 위치에 작은 화분 하나를 추가해줘.'],['소품 추가','선택한 위치에 책 한 권을 추가해줘.']]}:modeCopy[mode];$('#prompt-heading').textContent=text.title;$('#prompt').placeholder=additionMode?'예: 선택한 위치에 작은 강아지 한 마리를 추가해줘.':text.placeholder;$('#mode-help').textContent=text.hint;$('#generate-label').textContent=mode==='edit'&&$('#edit-intent').value==='add'?'대상 추가':text.action;
  $('#edit-options').hidden=mode==='generate';$('#composite-options').hidden=mode!=='composite';$('#generation-options').hidden=mode!=='generate';$('#edit-mask-settings').hidden=mode==='composite';
  $$('.prompt-chips button').forEach((b,i)=>{b.textContent=text.chips[i][0];b.dataset.prompt=text.chips[i][1];});
  $('#composite-target').textContent=active()?.contextPatch?'배경 포함 보정 레이어입니다. 배치를 바꾸려면 원본 대상 레이어를 선택하세요.':active()&&!active().empty?`${active().name} · 이동·크기 조절 가능`:'빈 레이어를 만들고 합성할 이미지를 불러오세요.';
  $('#document-name').textContent=state?.name||'새로운 가능성을 그려보세요';
  $('#document-size').textContent=state?`${pending?.result.width||state.width} × ${pending?.result.height||state.height} px`:'이미지를 열어 시작하세요';
  $('#compare').textContent=showOriginal?'결과 보기':'원본 보기';
  const n=state?countMask(state.selection):0;$('#selection-count').textContent=n?`선택 ${n.toLocaleString()} px`:'선택 영역 없음';
  const l=active();$('#layer-settings').hidden=!l;
  $('#layer-import').hidden=!l?.empty;$('#harmonize-controls').hidden=!l||l.empty||l.contextPatch;$('#local-harmonize').disabled=!hasBackdrop()||processing||generating||!!pending;$('#ai-harmonize').disabled=!hasBackdrop()||processing||generating||!!pending;for(const id of ['layer-x','layer-y','layer-width','layer-height','layer-rotation'])$('#'+id).disabled=!!l?.contextPatch;
  if(l){$('#opacity').value=l.opacity*100;$('#opacity-value').textContent=Math.round(l.opacity*100)+'%';$('#layer-x').value=Math.round(l.x);$('#layer-y').value=Math.round(l.y);$('#layer-width').value=Math.round(l.width);$('#layer-height').value=Math.round(l.height);$('#layer-rotation').value=Math.round(l.rotation);}
  renderLayers();drawCanvas();view();updateAvailability();updateCursor();
  $('.brush-option').hidden=!['brush','erase','restore','protect'].includes(tool);$('.selection-mode').hidden=!['brush','rect','lasso','protect'].includes(tool);
}
function locked(){if(processing||generating||pending){toast('현재 작업을 완료하거나 취소한 후 편집해주세요.');return true;}return false;}
function setTool(next){if(drag||locked())return;tool=next;render();}
function selectMode(next){modeDrafts[mode]=$('#prompt').value;if(next==='composite')$('#edit-intent').value='composite';mode=next==='edit'&&$('#edit-intent').value==='composite'?'composite':next;$('#prompt').value=modeDrafts[mode]||'';render();}
$('#edit-intent').addEventListener('change',()=>{if(locked())return;selectMode($('#edit-intent').value==='composite'?'composite':'edit');});
function maskOperation(shape,which='selection'){
  const current=copy(state[which]),ctx=current.getContext('2d');
  const op=$('#selection-mode').value;
  if(op==='replace' && which==='selection')ctx.clearRect(0,0,current.width,current.height);
  ctx.globalCompositeOperation=op==='subtract'?'destination-out':'source-over';ctx.drawImage(shape,0,0);
  state={...state,[which]:current};
}
function stroke(c,a,b,size,color='white') {const x=c.getContext('2d');x.strokeStyle=color;x.fillStyle=color;x.lineWidth=size;x.lineCap='round';x.lineJoin='round';x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke();x.beginPath();x.arc(b.x,b.y,size/2,0,Math.PI*2);x.fill();}
function paintTo(p){
  const d=drag,size=Number($('#brush-size').value);
  if(['brush','protect'].includes(tool)){
    stroke(d.stroke,d.last,p,size);state=d.base;maskOperation(d.stroke,tool==='protect'?'protection':'selection');
  }else{
    const l=d.layer,a=localPoint(l,d.last),b=localPoint(l,p);stroke(d.stroke,a,b,size*l.bitmap.width/l.width);
    const mask=alpha(d.stroke),source=pixels(d.layer.bitmap).data,original=pixels(d.layer.original).data;
    let data;
    if(tool==='restore') data=blendRGBA(source,original,mask);
    else {data=new Uint8ClampedArray(source);for(let i=0;i<mask.length;i++)data[i*4+3]=source[i*4+3]*(1-mask[i]/255);}
    state=d.base;updateLayer({bitmap:fromPixels(data,l.bitmap.width,l.bitmap.height)});
  }
  d.last=p;drawCanvas();
}
overlay.addEventListener('pointerdown',e=>{
  if(e.button!==0||!state||locked())return;e.preventDefault();overlay.focus({preventScroll:true});overlay.setPointerCapture(e.pointerId);
  const p=point(e),l=active();drag={base:snapshot(),start:p,last:p,client:{x:e.clientX,y:e.clientY},pan:{...pan}};
  if(space){drag.type='pan';return;}
  if(['move','brush','rect','lasso'].includes(tool)&&$('#selection-mode').value==='replace'&&countMask(state.selection)){
    const x=Math.floor(p.x),y=Math.floor(p.y),inside=x>=0&&y>=0&&x<state.width&&y<state.height&&state.selection.getContext('2d').getImageData(x,y,1,1).data[3]>0;
    drag.selectionClick={inside,moved:false};
  }
  if(tool==='move'){
    if(!l||l.contextPatch){drag=null;return;}
    const hit=transformHit(l,p);drag.type=hit.type;drag.cursor=hit.cursor;drag.layer=l;if(drag.type!=='move')drag.selectionClick=null;updateCursor();
    drag.distance=Math.hypot(p.x-l.x-l.width/2,p.y-l.y-l.height/2);drag.angle=Math.atan2(p.y-l.y-l.height/2,p.x-l.x-l.width/2);return;
  }
  if(['rect','lasso'].includes(tool)){drag.type='shape';drag.shape={start:p,end:p};drag.points=[p];return;}
  if(['erase','restore'].includes(tool)&&!l){drag=null;return;}
  drag.type='paint';drag.layer=l;drag.stroke=['erase','restore'].includes(tool)?makeCanvas(l.bitmap.width,l.bitmap.height):blankMask();if(!drag.selectionClick)paintTo(p);
});
overlay.addEventListener('pointermove',e=>{
  cursorPosition={x:e.clientX,y:e.clientY};updateCursor();
  if(!drag||!state)return;const p=point(e),d=drag;
  if(d.selectionClick&&!d.selectionClick.moved){if(Math.hypot(e.clientX-d.client.x,e.clientY-d.client.y)<3)return;d.selectionClick.moved=true;}
  if(d.type==='pan'){pan={x:d.pan.x+e.clientX-d.client.x,y:d.pan.y+e.clientY-d.client.y};view();return;}
  if(['move','resize','rotate'].includes(d.type)){
    if(Math.hypot(p.x-d.start.x,p.y-d.start.y)<.01)return;
    state=d.base;const l=d.layer;
    if(d.type==='move')updateLayer({x:l.x+p.x-d.start.x,y:l.y+p.y-d.start.y});
    if(d.type==='resize'){const ratio=Math.max(.02,Math.min(8,Math.hypot(p.x-l.x-l.width/2,p.y-l.y-l.height/2)/Math.max(1,d.distance)));const w=Math.min(8192,l.width*ratio),h=w/l.width*l.height;updateLayer({width:w,height:h,x:l.x+(l.width-w)/2,y:l.y+(l.height-h)/2});}
    if(d.type==='rotate'){const angle=Math.atan2(p.y-l.y-l.height/2,p.x-l.x-l.width/2);updateLayer({rotation:l.rotation+(angle-d.angle)*180/Math.PI});}
    drawCanvas();return;
  }
  if(d.type==='shape'){d.shape.end=p;d.points.push(p);drawOverlay();return;}
  if(d.type==='paint')paintTo(p);
});
function endPointer(e,cancelled=false){
  if(!drag)return;const d=drag;
  if(cancelled){state=d.base;drag=null;render();return;}
  if(d.selectionClick&&!d.selectionClick.moved){
    const intent=selectionClickIntent('replace',true,d.selectionClick.inside,Math.hypot(e.clientX-d.client.x,e.clientY-d.client.y));
    if(intent!=='draw'){state=d.base;drag=null;if(intent==='clear')commit({...state,selection:blankMask()},null,'선택 해제');else render();return;}
  }
  if(d.type==='shape'&&(tool==='rect'?Math.hypot(d.shape.end.x-d.start.x,d.shape.end.y-d.start.y)<1:!d.points.some(p=>Math.hypot(p.x-d.start.x,p.y-d.start.y)>=1))){drag=null;render();return;}
  if(d.type==='shape'){
    const shape=blankMask(),x=shape.getContext('2d');x.fillStyle='white';x.beginPath();
    if(tool==='rect')x.rect(d.start.x,d.start.y,d.shape.end.x-d.start.x,d.shape.end.y-d.start.y);
    else{d.points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();}x.fill();maskOperation(shape);
  }
  drag=null;if(d.type!=='pan'&&state!==d.base)commit(state,null,{move:'레이어 이동',resize:'레이어 크기 변경',rotate:'레이어 회전'}[d.type]||toolInfo[tool][0]);else render();
}
overlay.addEventListener('pointerup',e=>endPointer(e));overlay.addEventListener('pointercancel',e=>endPointer(e,true));
overlay.addEventListener('pointerleave',()=>{cursorPosition=null;updateCursor();});
stage.addEventListener('pointerdown',e=>{if(!state||e.target!==stage||e.button!==0||locked())return;if(!space&&($('#selection-mode').value!=='replace'||!countMask(state.selection)))return;stage.setPointerCapture(e.pointerId);drag={type:space?'pan':'outside-click',base:state,client:{x:e.clientX,y:e.clientY},pan:{...pan},...(!space?{selectionClick:{inside:false,moved:false}}:{})};});
stage.addEventListener('pointermove',e=>{if(drag?.type==='pan'&&e.target===stage){pan={x:drag.pan.x+e.clientX-drag.client.x,y:drag.pan.y+e.clientY-drag.client.y};view();}});
stage.addEventListener('pointerup',e=>{if(['pan','outside-click'].includes(drag?.type))endPointer(e);});
stage.addEventListener('wheel',e=>{if(!state)return;e.preventDefault();if(generating||drag)return;const old=zoom;zoom=Math.max(.05,Math.min(4,zoom*(e.deltaY<0?1.12:1/1.12)));const box=stage.getBoundingClientRect(),dx=e.ctrlKey?-pan.x:e.clientX-box.left-box.width/2-pan.x,dy=e.ctrlKey?-pan.y:e.clientY-box.top-box.height/2-pan.y;pan.x-=dx*(zoom/old-1);pan.y-=dy*(zoom/old-1);view();updateCursor();},{passive:false});

async function decodeFile(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('PNG, JPG 또는 WEBP 이미지를 선택해주세요.');
  if(file.size>20*1024*1024)throw Error('20MB 이하 이미지를 선택해주세요.');
  const bitmap=await createImageBitmap(file);const ratio=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));const c=makeCanvas(Math.max(1,Math.round(bitmap.width*ratio)),Math.max(1,Math.round(bitmap.height*ratio)));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();if(ratio<1)toast('작업 성능을 위해 긴 변을 2048px로 줄였습니다. 원본 파일은 그대로입니다.');return c;
}
async function loadFile(file,add,targetId=null){
  if(!file||locked())return;
  if(!add&&state&&!confirm('현재 작업을 새 이미지로 바꿀까요? 저장할 내용이 있으면 취소 후 PNG를 먼저 내보내세요.'))return;
  processing=true;updateAvailability();
  try{
    let c=await decodeFile(file);const original=c;
    if(add && $('#auto-bg').checked){$('#bg-help').textContent='첨부 이미지의 배경을 제거하고 있습니다…';try{c=await removeBackground(c,$('#bg-engine').value,Number($('#tolerance').value),s=>$('#bg-help').textContent=s);}catch(error){toast(error.message+' 원본 이미지를 배치합니다.');$('#bg-help').textContent=error.message;}}
    if(!add||!state)initialize(c,file.name.replace(/\.[^.]+$/,''),false,original);
    else{const s=Math.min(state.width*.65/c.width,state.height*.65/c.height,1);const target=state.layers.find(l=>l.id===targetId&&l.empty);const l=layer(c,file.name,{...(target?{id:target.id}:{}),empty:false,original,width:c.width*s,height:c.height*s,x:(state.width-c.width*s)/2,y:(state.height-c.height*s)/2});commit({...state,layers:target?state.layers.map(a=>a.id===target.id?l:a):[...state.layers,l],active:l.id,selection:blankMask()},null,'이미지 불러오기');tool='move';selectMode('composite');}
  }catch(error){toast(error.message);}finally{processing=false;updateAvailability();}
}
$('#open-input').addEventListener('change',e=>{loadFile(e.target.files[0],false);e.target.value='';});$('#add-input').addEventListener('change',e=>{loadFile(e.target.files[0],true,importTarget);importTarget=null;e.target.value='';});
stage.addEventListener('dragover',e=>{e.preventDefault();stage.classList.add('drag-over');});stage.addEventListener('dragleave',()=>stage.classList.remove('drag-over'));stage.addEventListener('drop',e=>{e.preventDefault();stage.classList.remove('drag-over');loadFile(e.dataTransfer.files[0],!!state);});

function selectionErase(restore=false){
  const l=active();if(!l||locked())return;if(!countMask(state.selection)){toast('먼저 영역을 선택해주세요.');return;}
  const maskCanvas=makeCanvas(l.bitmap.width,l.bitmap.height),x=maskCanvas.getContext('2d');
  // Inverse layer transform maps document selection into native layer pixels.
  x.scale(l.bitmap.width/l.width,l.bitmap.height/l.height);x.translate(l.width/2,l.height/2);x.rotate(-l.rotation*Math.PI/180);x.translate(-l.x-l.width/2,-l.y-l.height/2);x.drawImage(state.selection,0,0);
  const mask=alpha(maskCanvas),a=pixels(l.bitmap).data;let out;
  if(restore)out=blendRGBA(a,pixels(l.original).data,mask);
  else{out=new Uint8ClampedArray(a);for(let i=0;i<mask.length;i++)out[i*4+3]=a[i*4+3]*(1-mask[i]/255);}
  updateLayer({bitmap:fromPixels(out,l.bitmap.width,l.bitmap.height)});commit(state,restore?'선택 영역을 원본으로 복원했습니다.':'선택 영역을 투명하게 지웠습니다.');
}
async function removeBg(){
  if(!active()||locked())return;const l=active();processing=true;updateAvailability();
  try{const result=await removeBackground(l.bitmap,$('#bg-engine').value,Number($('#tolerance').value),s=>$('#bg-help').textContent=s);updateLayer({bitmap:result});commit(state,'배경 제거 완료 · 복원 브러시로 다시 살릴 수 있습니다.');$('#bg-help').textContent='배경 제거가 완료되었습니다. 지우기·복원 도구로 가장자리를 보정하세요.';}
  catch(error){toast(error.message);$('#bg-help').textContent=error.message;}
  finally{processing=false;updateAvailability();}
}

async function imageFromURL(url){const img=new Image();img.src=url;await img.decode();return img;}

function hasBackdrop(doc=state,l=active()){
  if(!doc||!l||l.empty||l.contextPatch||!l.visible)return false;
  const i=doc.layers.findIndex(a=>a.id===l.id);return doc.layers.slice(0,i).some(a=>a.visible&&a.opacity>0&&!a.empty);
}
function targetSpace(bitmap,l){
  const c=makeCanvas(l.bitmap.width,l.bitmap.height),x=c.getContext('2d');
  x.scale(l.bitmap.width/l.width,l.bitmap.height/l.height);x.translate(l.width/2,l.height/2);x.rotate(-l.rotation*Math.PI/180);x.translate(-l.x-l.width/2,-l.y-l.height/2);x.drawImage(bitmap,0,0);return c;
}
async function previewHarmonize(){
  if(locked())return;const doc=state,l=active();if(!hasBackdrop(doc,l)){toast('배경 위에 놓인 대상 레이어를 선택해주세요.');return;}
  const rev=revision;processing=true;updateAvailability();
  try{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const index=doc.layers.findIndex(a=>a.id===l.id),background=flatten({...doc,layers:doc.layers.slice(0,index)}),ref=targetSpace(background,l);
    const input=pixels(l.bitmap).data,reference=pixels(ref).data,strength=Number($('#harmonize-strength').value)/100;
    let matched=matchColorRGBA(input,reference,strength);matched=blendSubjectEdges(matched,reference,l.bitmap.width,l.bitmap.height,strength*.45);
    const protection=alpha(targetSpace(doc.protection,l)),all=new Uint8ClampedArray(protection.length).fill(255);
    matched=blendRGBA(input,matched,all,protection);
    const bitmap=fromPixels(matched,l.bitmap.width,l.bitmap.height),edited={...doc,layers:doc.layers.map(a=>a.id===l.id?{...a,bitmap}:a.contextPatch&&a.sourceLayerId===l.id?{...a,visible:false}:a)};
    if(rev!==revision)return;
    pending={before:flatten(doc),result:flatten(edited),operation:'local-harmonize',layerEdit:{id:l.id,bitmap},notice:'색감·경계 맞춤 미리보기 · 무료 로컬 처리'};showOriginal=false;render();toast('원본과 비교한 뒤 적용하세요. 접지 그림자는 AI로 어우르기를 사용하세요.');
  }catch(error){toast(error.message);}finally{processing=false;updateAvailability();}
}
function prepareHarmonize(){
  if(locked())return;if(!hasBackdrop()){toast('배경 위에 놓인 대상 레이어를 선택해주세요.');return;}
  $('#edit-intent').value='composite';selectMode('composite');
  $('#prompt').value='현재 대상의 위치·크기·형태와 정체성을 유지하고, 배경의 광원 방향·색온도·명암에 맞춰 자연스럽게 어우러지게 해줘. 실제 접촉면에 맞는 접지 그림자와 필요한 약한 반사를 추가하고 주변 재질은 최대한 유지해줘.';
  modeDrafts.composite=$('#prompt').value;render();$('#composite-options').scrollIntoView({block:'nearest'});toast('배치를 먼저 마친 뒤 배경과 어우르기를 누르세요. 추가 AI 요청으로 사용량이 소모됩니다.');
}

function editMask(doc,operation){
  let mask=alpha(doc.selection);
  if(operation==='composite'){
    const l=doc.layers.find(a=>a.id===doc.active);if(!l)throw Error('합성할 레이어를 선택해주세요.');
    const c=makeCanvas(doc.width,doc.height),x=c.getContext('2d');x.translate(l.x+l.width/2,l.y+l.height/2);x.rotate(l.rotation*Math.PI/180);x.fillStyle='white';const margin=Number($('#composite-margin').value);x.fillRect(-l.width/2-margin,-l.height/2-margin,l.width+margin*2,l.height+margin*2);mask=alpha(c);
  }
  return featherInside(mask,doc.width,doc.height,operation==='composite'?8:Number($('#feather').value));
}
async function generate(){
  if($('#generate').disabled)return;const prompt=$('#prompt').value.trim();if(!prompt){toast('원하는 이미지나 수정 내용을 입력해주세요.');$('#prompt').focus();return;}
  if(mode==='edit'&&$('#edit-intent').value==='replace'&&isAdditionRequest(prompt)){$('#edit-intent').value='add';render();toast('추가 요청을 감지해 배경 유지 방식으로 전환했습니다. 내용을 확인한 뒤 대상 추가를 눌러주세요.');return;}
  const operation=mode,doc=state,rev=revision,id=++requestSerial,adding=mode==='edit'&&$('#edit-intent').value==='add',targetId=active()?.empty?active().id:null;currentRequestId=crypto.randomUUID();generating=true;controller=new AbortController();$('#busy-message').textContent='이미지 준비 중';$('#busy-panel').hidden=false;startProgress();updateAvailability();
  try{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(id!==requestSerial)return;
  if(operation==='composite'&&!hasBackdrop(doc,active()))throw Error('배경 위에 놓인 대상 레이어를 선택해주세요.');
  const geometry=doc?requestGeometry(doc.width,doc.height):null;
  const before=doc?flatten(doc):makeCanvas(1024,1024);
  const allowed=operation==='generate'?null:editMask(doc,operation),protectedPixels=doc?alpha(doc.protection):null;
  if(allowed && !allowed.some((v,i)=>v && !protectedPixels[i])){throw Error('보호 영역 밖에 수정할 영역이 없습니다.');}
  const payload={addition:adding,requestId:currentRequestId,mode:operation==='generate'?'generate':'edit',prompt,quality:$('#quality').value,size:$('#generation-size').value};
  if(operation!=='generate'){
    const input=makeCanvas(geometry.width,geometry.height),inputCtx=input.getContext('2d');inputCtx.drawImage(before,geometry.x,geometry.y,geometry.drawWidth,geometry.drawHeight);
    payload.image=input.toDataURL('image/png');payload.size=geometry.size;
    const m=makeCanvas(doc.width,doc.height),data=m.getContext('2d').createImageData(doc.width,doc.height);
    for(let i=0;i<allowed.length;i++){const k=i*4;data.data[k]=data.data[k+1]=data.data[k+2]=255;data.data[k+3]=255-Math.round(allowed[i]*(1-protectedPixels[i]/255));}
    m.getContext('2d').putImageData(data,0,0);
    const paddedMask=makeCanvas(geometry.width,geometry.height),mx=paddedMask.getContext('2d');mx.fillStyle='white';mx.fillRect(0,0,paddedMask.width,paddedMask.height);mx.clearRect(geometry.x,geometry.y,geometry.drawWidth,geometry.drawHeight);mx.drawImage(m,geometry.x,geometry.y,geometry.drawWidth,geometry.drawHeight);payload.mask=paddedMask.toDataURL('image/png');
    const guide=copy(input),tint=pixels(paddedMask);for(let i=0;i<tint.data.length;i+=4){tint.data[i]=255;tint.data[i+1]=0;tint.data[i+2]=255;tint.data[i+3]=255-tint.data[i+3];}const tintCanvas=fromPixels(tint.data,geometry.width,geometry.height);guide.getContext('2d').globalAlpha=.4;guide.getContext('2d').drawImage(tintCanvas,0,0);payload.guide=guide.toDataURL('image/png');
    payload.prompt=operation==='composite'?`Use the first image as the exact approved layout. HARMONIZE the already placed subject with the scene. Preserve its exact position, scale, silhouette, identity and camera perspective. Match the scene light direction, color temperature, exposure and local contrast. Add physically plausible contact shadow, ambient occlusion and only appropriate subtle reflections on the actual receiving surface. Preserve existing floor/wall texture; do not replace the room or create an unrelated lighting setup. ${connectionState?.provider==='codex'?'Image 2 is the region guide; image 3 is the subject reference.':'The second image is the subject reference.'} Modify only the mask area. User request: ${prompt}`:`Edit only the indicated region; preserve composition and unmasked details. User request: ${prompt}`;
    if(adding)payload.prompt=`ADD ONLY the requested subject and its soft contact shadow. Keep the whole subject within the indicated region with padding around all extremities. Use the scene ONLY as perspective and lighting reference. Generate the complete isolated subject centered with transparent padding. The application will fit it to the selected region. Use actual alpha transparency; never paint checkerboard squares or a fake transparency pattern. Do not draw the background or magenta guide. User request: ${prompt}`;
    if(operation==='composite'&&active())payload.reference=active().bitmap.toDataURL('image/png');
  }
  $('#busy-message').textContent='연결 확인 및 전송 중';
    const response=await apiFetch('/api/image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
    const body=await response.json();if(!response.ok){if(body.code==='USAGE_LIMIT'){connectionState={...connectionState,usageLimited:true};$('#connection-badge').textContent='Codex 사용 제한';$('#generation-help').textContent='구독 사용 제한입니다. 제한 해제 후 다시 시도해주세요.';}throw Error(body.error||'이미지를 생성하지 못했습니다.');}
    if(body.imageVerified)checkConnection();if(body.timings){const t=body.timings;$('#generation-timing').hidden=false;$('#generation-timing').textContent=`최근 생성 ${(t.totalMs/1000).toFixed(1)}초 · Codex ${(t.codexMs/1000).toFixed(1)}초 · 결과 회수 ${(t.retrievalMs/1000).toFixed(1)}초`;}
    stopProgress();$('#busy-message').textContent='결과 처리 중';const image=await imageFromURL(body.image);
    if(id!==requestSerial||rev!==revision)return;
    let result,addition=null,additionPlacement=null,contextPatch=null,notice=null,comparison=before;
    if(operation==='generate'){
      result=makeCanvas(image.width,image.height);result.getContext('2d').drawImage(image,0,0);
      comparison=makeCanvas(image.width,image.height);
      if(doc){const s=Math.min(image.width/doc.width,image.height/doc.height);comparison.getContext('2d').drawImage(before,(image.width-doc.width*s)/2,(image.height-doc.height*s)/2,doc.width*s,doc.height*s);}
    }else{
      const generated=makeCanvas(doc.width,doc.height),sx=image.width/geometry.width,sy=image.height/geometry.height;
      generated.getContext('2d').drawImage(image,geometry.x*sx,geometry.y*sy,geometry.drawWidth*sx,geometry.drawHeight*sy,0,0,doc.width,doc.height);
      if(adding){
        // Inspect the full returned PNG before cropping document padding.
        const full=makeCanvas(image.width,image.height);full.getContext('2d').drawImage(image,0,0);
        const recovered=recoverCheckerboard(pixels(full).data,image.width,image.height);
        if(recovered){full.getContext('2d').putImageData(new ImageData(recovered,image.width,image.height),0,0);notice='체크무늬 배경 보정 · 털과 그림자를 확인하세요';}
        const placement=fitAddition(pixels(full).data,image.width,image.height,allowed,doc.width,doc.height,protectedPixels),s=placement.source;
        addition=makeCanvas(s.width,s.height);addition.getContext('2d').drawImage(full,s.x,s.y,s.width,s.height,0,0,s.width,s.height);
        additionPlacement={x:placement.x,y:placement.y,width:placement.width,height:placement.height};
        const overlay=makeCanvas(doc.width,doc.height);overlay.getContext('2d').drawImage(addition,placement.x,placement.y,placement.width,placement.height);
        result=fromPixels(overRGBA(pixels(before).data,pixels(overlay).data),doc.width,doc.height);
      }else if(operation==='composite'){const rgba=contextOverlay(pixels(generated).data,allowed,protectedPixels);contextPatch=fromPixels(rgba,doc.width,doc.height);result=fromPixels(overRGBA(pixels(before).data,rgba),doc.width,doc.height);notice='AI 조화 미리보기 · 대상 주변의 배경도 보정됩니다';}else result=fromPixels(blendRGBA(pixels(before).data,pixels(generated).data,allowed,protectedPixels),doc.width,doc.height);
    }
    if(!state){initialize(makeCanvas(result.width,result.height),'AI 이미지',true);}
    pending={before:comparison,result,operation,addition,additionPlacement,contextPatch,sourceLayerId:active()?.id,notice,targetId};showOriginal=false;render();if(operation==='generate'){zoom=Math.max(.05,Math.min(1,(stage.clientWidth-100)/result.width,(stage.clientHeight-150)/result.height));pan={x:0,y:0};view();}toast('결과를 비교하고 마음에 들면 적용해주세요.');
  }catch(error){if(error.name!=='AbortError')toast(error.message);}
  finally{if(id===requestSerial){generating=false;controller=null;stopProgress();$('#busy-panel').hidden=true;updateAvailability();}}
}
async function cancelGeneration(){if(cancelling||!generating)return;cancelling=true;let confirmed=false;const cancelledId=currentRequestId;requestSerial++;controller?.abort();controller=null;stopProgress();$('#busy-message').textContent='취소 완료 확인 중';updateAvailability();
  try{const cancel=await apiFetch('/api/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:cancelledId})});if(!cancel.ok)throw Error();while(true){const response=await apiFetch('/api/progress?requestId='+encodeURIComponent(cancelledId));if(!response.ok)throw Error();const p=await response.json();if(!p.active){confirmed=true;break;}await new Promise(r=>setTimeout(r,500));}toast('생성 대기를 취소했습니다. 이미 시작된 생성에는 사용량이 반영될 수 있습니다.');}
  catch{toast('서버의 취소 완료를 확인하지 못했습니다. 연결 상태를 다시 확인해주세요.');}
  finally{cancelling=false;if(confirmed){generating=false;$('#busy-panel').hidden=true;$('[data-action="cancel-generation"]').textContent='생성 취소';}else{$('#busy-message').textContent='취소 완료 미확인';$('[data-action="cancel-generation"]').textContent='취소 상태 다시 확인';}updateAvailability();}
}
function applyResult(){
  if(!pending)return;
  if(pending.layerEdit){const {id,bitmap}=pending.layerEdit;pending=null;tool='move';commit({...state,layers:state.layers.map(l=>l.id===id?{...l,bitmap}:l.contextPatch&&l.sourceLayerId===id?{...l,visible:false}:l),active:id},'대상의 색감과 경계를 맞췄습니다. 조명·그림자는 AI로 어우르기에서 보정하세요.');return;}
  if(pending.contextPatch){const {contextPatch,sourceLayerId}=pending;pending=null;const l=layer(contextPatch,'AI 조화 보정 · 배경 포함',{contextPatch:true,sourceLayerId});commit({...state,layers:[...state.layers,l],active:l.id,selection:blankMask()},'AI 조화를 별도 레이어로 적용했습니다. 배치를 바꾸려면 원본 대상 레이어를 선택하세요.');return;}
  if(pending.addition){const {addition,targetId,additionPlacement}=pending;pending=null;const l=layer(addition,'AI 추가 대상',{...(targetId?{id:targetId}:{}),...additionPlacement});tool='move';commit({...state,layers:[...state.layers.filter(a=>a.id!==targetId),l],active:l.id,selection:blankMask()},'선택 영역 안에 배치했습니다. 모서리를 드래그해 크기를 조절하세요.');return;}const result=pending.result,operation=pending.operation;pending=null;
  const l=layer(result,operation==='generate'?'AI 생성 이미지':'AI 편집 결과');
  // Keep previous layers for recovery, hide them to avoid double-compositing transparent pixels.
  commit({...state,width:result.width,height:result.height,layers:[...state.layers.map(a=>({...a,visible:false})),l],active:l.id,selection:makeCanvas(result.width,result.height),protection:operation==='generate'?makeCanvas(result.width,result.height):state.protection},'결과를 적용했습니다. 이전 레이어는 숨김 상태로 보관했습니다.');
}
function exportPNG(){if(!state)return;const c=pending?pending.result:flatten();c.toBlob(blob=>{if(!blob){toast('PNG를 만들지 못했습니다.');return;}const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`2026-10-28-${state.name.replace(/[<>:"/\\|?*]/g,'-')}-v1.5.4.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('PNG를 내보냈습니다. 원본 파일은 변경하지 않았습니다.');},'image/png');}

function sample(){
  if(locked())return;if(state&&!confirm('현재 작업을 샘플로 바꿀까요? 필요한 결과는 먼저 내보내세요.'))return;
  const c=makeCanvas(1200,900),x=c.getContext('2d');
  const wall=x.createLinearGradient(0,0,1200,850);wall.addColorStop(0,'#eee8da');wall.addColorStop(1,'#b7baa7');x.fillStyle=wall;x.fillRect(0,0,1200,900);
  x.fillStyle='#b9a68a';x.fillRect(0,705,1200,195);x.fillStyle='#d4c4ac';x.fillRect(0,710,1200,5);
  for(let i=0;i<8;i++){x.strokeStyle='#aa957c55';x.beginPath();x.moveTo(i*180-300,900);x.lineTo(i*165+20,715);x.stroke();}
  x.save();x.shadowColor='#28371e44';x.shadowBlur=25;x.shadowOffsetX=15;x.shadowOffsetY=20;x.fillStyle='#efe9db';x.fillRect(100,85,380,520);x.restore();
  const sky=x.createLinearGradient(100,85,480,600);sky.addColorStop(0,'#c2d2c1');sky.addColorStop(.65,'#e2e1cb');sky.addColorStop(1,'#b9c4a4');x.fillStyle=sky;x.fillRect(115,100,350,490);
  x.fillStyle='#99ae8d';x.beginPath();x.moveTo(115,440);x.bezierCurveTo(230,250,350,510,465,320);x.lineTo(465,590);x.lineTo(115,590);x.fill();
  x.fillStyle='#647f68';x.beginPath();x.moveTo(115,560);x.bezierCurveTo(260,390,350,560,465,450);x.lineTo(465,590);x.lineTo(115,590);x.fill();x.fillStyle='#f4efe2';x.fillRect(282,95,12,505);x.fillRect(112,330,355,12);
  x.save();x.globalAlpha=.14;x.fillStyle='#fff9d3';x.beginPath();x.moveTo(115,600);x.lineTo(465,600);x.lineTo(950,900);x.lineTo(330,900);x.fill();x.restore();
  x.fillStyle='#5b6d52';x.beginPath();x.roundRect(590,425,340,205,45);x.fill();x.fillStyle='#738265';x.beginPath();x.roundRect(545,550,430,125,35);x.fill();x.fillStyle='#4f6347';x.beginPath();x.roundRect(545,630,430,55,16);x.fill();x.fillStyle='#634c35';x.fillRect(588,678,16,90);x.fillRect(921,678,16,90);
  x.save();x.shadowColor='#2b331933';x.shadowBlur=30;x.fillStyle='#9c8666';x.beginPath();x.ellipse(475,765,135,45,0,0,Math.PI*2);x.fill();x.restore();x.fillStyle='#715b42';x.fillRect(466,780,16,87);x.fillStyle='#d6cfb9';x.beginPath();x.ellipse(475,758,135,41,0,0,Math.PI*2);x.fill();
  x.fillStyle='#b7784e';x.beginPath();x.roundRect(1040,650,80,115,[4,4,25,25]);x.fill();
  for(let i=0;i<8;i++){const px=1080+Math.sin(i*2)*55,py=440+i*24;x.strokeStyle='#546744';x.lineWidth=4;x.beginPath();x.moveTo(1080,660);x.quadraticCurveTo(px,py+80,px,py);x.stroke();x.fillStyle=['#4c6645','#697e53','#85966a'][i%3];x.beginPath();x.ellipse(px,py,18,45,Math.sin(i)*.9,0,Math.PI*2);x.fill();}
  x.fillStyle='#69765c';x.font='12px sans-serif';x.fillText('INPAINT STUDIO  /  SAMPLE SCENE',38,865);
  initialize(c,'햇살이 머무는 방');toast('샘플을 열었습니다. 사각형 도구로 의자나 창문을 선택해보세요.');
}

const actions={
  'connection-info':()=>$('#connection-dialog').showModal(),
  'local-harmonize':previewHarmonize,'ai-harmonize':prepareHarmonize,
  open:()=>{if(!locked())$('#open-input').click();},add:()=>{if(!locked())$('#add-input').click();},new:()=>{if(!locked())$('#new-dialog').showModal();},sample,export:exportPNG,help:()=>window.open('/2026-10-28-user-manual.html','_blank','noopener'),
  'new-layer':()=>{if(locked())return;if(!state){initialize(makeCanvas(1024,1024),'새 캔버스',false,undefined,true);$('#edit-intent').value='add';selectMode('edit');return;}const l=layer(blankMask(),`레이어 ${serial+1}`,{empty:true});$('#edit-intent').value='add';selectMode('edit');commit({...state,layers:[...state.layers,l],active:l.id},null,'빈 레이어 추가');},
  'import-layer':()=>{if(locked())return;if(!state||!active()?.empty)actions['new-layer']();importTarget=state.active;$('#add-input').click();},
  undo:()=>{if(history&&!locked()){state=history.undo();revision++;render();}},redo:()=>{if(history&&!locked()){state=history.redo();revision++;render();}},
  'clear-selection':()=>{if(state&&!locked()&&countMask(state.selection))commit({...state,selection:blankMask()},null,'선택 해제');},'clear-protection':()=>{if(state&&!locked()&&countMask(state.protection))commit({...state,protection:blankMask()},null,'보호 영역 해제');},
  'zoom-in':()=>{if(state){zoom=Math.min(4,zoom*1.2);view();}},'zoom-out':()=>{if(state){zoom=Math.max(.05,zoom/1.2);view();}},fit,
  'erase-selection':()=>selectionErase(false),'restore-selection':()=>selectionErase(true),
  'delete-layer':()=>executeLayerCommand('delete',{layer:state?.active}),
  'cancel-generation':cancelGeneration,'discard-result':()=>{pending=null;fit();render();toast('생성 결과를 폐기했습니다.');},'apply-result':applyResult,
};
$$('[data-action]').forEach(b=>b.addEventListener('click',()=>actions[b.dataset.action]?.()));
$$('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>{if(locked())return;selectMode(b.dataset.mode);}));
$$('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('#prompt').value=b.dataset.prompt;$('#prompt').focus();}));
function brushSize(value){const size=Math.max(1,Math.min(500,Math.round(Number(value)||1)));$('#brush-size').value=size;$('#brush-number').value=size;updateCursor();}
$('#brush-size').addEventListener('input',e=>brushSize(e.target.value));
$('#brush-number').addEventListener('change',e=>{brushSize(e.target.value);overlay.focus({preventScroll:true});});
$('#composite-margin').addEventListener('input',e=>$('#margin-value').textContent=e.target.value+' px');
$('#feather').addEventListener('input',e=>$('#feather-value').textContent=e.target.value+' px');
$('#tolerance').addEventListener('input',e=>$('#tolerance-value').textContent=e.target.value);
$('#opacity').addEventListener('input',e=>{if(!active()||locked())return;updateLayer({opacity:Number(e.target.value)/100});$('#opacity-value').textContent=e.target.value+'%';drawCanvas();});
$('#opacity').addEventListener('change',()=>{if(state&&!locked())commit(state,null,'불투명도 변경');});
for(const [id,key] of [['layer-x','x'],['layer-y','y'],['layer-width','width'],['layer-height','height'],['layer-rotation','rotation']])$('#'+id).addEventListener('change',e=>{
  const l=active();if(!l||locked())return;const n=Number(e.target.value);if(!Number.isFinite(n)||Math.abs(n)>8192||(['width','height'].includes(key)&&n<1)){toast('올바른 범위의 숫자를 입력해주세요.');render();return;}
  try{updateLayer(['width','height'].includes(key)?resizeDimensions(l,key,n,$('#aspect-lock').checked):{[key]:n});commit(state,null,'이미지 크기·위치 변경');}catch(error){toast(error.message);render();}
});
$('#bg-engine').addEventListener('change',e=>$('#bg-help').textContent=e.target.value==='portrait'?'인물용 MODNet · 최초 약 26MB와 실행 라이브러리 다운로드. 실행 시 브라우저에 캐시되며, 사진은 업로드하지 않습니다.':'단색 모드는 테두리에 연결된 비슷한 색만 지웁니다. 복잡한 배경은 수동으로 보정하세요.');
$('#remove-bg').addEventListener('click',removeBg);$('#generate').addEventListener('click',generate);
$('#compare').addEventListener('click',()=>{showOriginal=!showOriginal;$('#compare').textContent=showOriginal?'결과 보기':'원본 보기';drawCanvas();});
$('#new-dialog').addEventListener('close',()=>{if($('#new-dialog').returnValue!=='create')return;const w=Number($('#new-width').value),h=Number($('#new-height').value);if(w<64||w>2048||h<64||h>2048)return;initialize(makeCanvas(w,h),'새 캔버스',false,undefined,true);});
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select')||$('dialog[open]'))return;
  if(drag){e.preventDefault();if(e.key==='Escape')endPointer(e,true);return;}
  if(e.code==='Space'){space=true;e.preventDefault();overlay.style.cursor='grab';return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();actions[e.shiftKey?'redo':'undo']();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();exportPNG();return;}
  if(e.key==='Delete'||e.key==='Backspace'){if(state){e.preventDefault();if(deleteIntent(!!e.target.closest('#layers'),!!countMask(state.selection))==='selection')selectionErase();else actions['delete-layer']();}return;}
  if((e.code==='BracketLeft'||e.code==='BracketRight')&&['brush','erase','restore','protect'].includes(tool)){e.preventDefault();brushSize(Number($('#brush-size').value)+(e.code==='BracketRight'?10:-10));return;}
  const keys={v:'move',b:'brush',m:'rect',l:'lasso',e:'erase',r:'restore',p:'protect'};if(keys[e.key.toLowerCase()])setTool(keys[e.key.toLowerCase()]);
  if(e.key.toLowerCase()==='o')actions.open();if(e.key==='Escape'&&!generating){if(pending)actions['discard-result']();else actions['clear-selection']();}
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;overlay.style.cursor=tool==='move'?'move':['brush','erase','restore','protect'].includes(tool)?'none':'crosshair';updateCursor();}});
window.addEventListener('blur',()=>{space=false;if(drag){state=drag.base;drag=null;render();}});
window.addEventListener('beforeunload',e=>{if(pending||generating||(state&&history?.canUndo)){e.preventDefault();e.returnValue='';}});
new ResizeObserver(()=>{if(state)view();}).observe(stage);
let connectionCheck=null;
function updateAiControls(){const b=bridgeState();$('#ai-connect').textContent=b.phase==='connecting'?'AI를 연결하고 있습니다…':connected&&b.phase==='ready'?'AI 연결됨':b.phase==='ready'?'상태 확인':'AI 연결';$('#ai-connect').disabled=b.phase==='connecting'||(connected&&b.phase==='ready');$('#ai-disconnect').hidden=!b.hasSession&&b.phase!=='connecting';}
function checkConnection(force=false){
  if(connectionCheck)return connectionCheck;
  connectionCheck=(async()=>{try{const response=await apiFetch('/api/status'+(force?'?refresh=1':''));if(!response.ok)throw Error();const data=await response.json();connectionState=data;connected=!!data.connected;
    $('#connection-badge').textContent=data.usageLimited?'Codex 사용 제한':data.imageVerified?'Codex 이미지 사용 가능':connected?'Codex 로그인됨':data.installed?'Codex 로그인 필요':'Codex 설치 필요';$('#connection-badge').classList.toggle('connected',connected);
    $('#connection-badge').title=data.imageVerified?'현재 브릿지에서 실제 이미지 실행을 확인했습니다.':'로그인 확인이며, 실제 이미지 도구·한도는 생성 시 확인합니다.';
    $('.connection-caption').textContent='ChatGPT 구독';$('.privacy-note').textContent='생성을 누르면 이미지가 PC의 Codex를 통해 OpenAI로 전송되며 구독 사용량이 소모됩니다.';
    $('#codex-installed').textContent=data.installed?'설치됨 · '+(data.version||''):'설치 확인 필요';$('#codex-login').textContent=data.loggedIn?'ChatGPT 로그인됨':'ChatGPT 로그인 필요';$('#codex-image').textContent=data.imageVerified?'실제 이미지 실행 확인됨':'첫 생성에서 확인';
  }catch(error){connected=false;$('#connection-badge').title=error.message||'로컬 연결을 확인해주세요.';$('#connection-badge').textContent=bridgeState().hasSession?'AI 연결 끊김':'AI 연결 필요';$('#connection-badge').classList.remove('connected');for(const id of ['codex-installed','codex-login','codex-image'])$('#'+id).textContent='AI 연결 후 확인';}})().finally(()=>{connectionCheck=null;updateAvailability();updateAiControls();});return connectionCheck;
}
$('#ai-connect').addEventListener('click',async()=>{try{await connectBridge();await checkConnection();if(!connected)$('#connection-dialog').showModal();}catch(error){toast(error.message);if(!$('#connection-dialog').open)$('#connection-dialog').showModal();}finally{updateAiControls();}});
$('#ai-disconnect').addEventListener('click',async()=>{if(generating){requestSerial++;controller?.abort();controller=null;generating=false;stopProgress();$('#busy-panel').hidden=true;}await disconnectBridge();connected=false;$('#connection-badge').textContent='AI 연결 해제됨';$('#connection-badge').classList.remove('connected');updateAvailability();updateAiControls();toast('AI 연결을 해제했습니다. 편집 내용은 유지됩니다.');});
window.addEventListener('inpaint-ai-connection',event=>{updateAiControls();if(event.detail.phase==='ready')void checkConnection();else if(event.detail.phase==='error'||event.detail.phase==='idle'){connected=false;$('#connection-badge').textContent=event.detail.phase==='error'?'AI 연결 끊김':'AI 연결 필요';$('#connection-badge').classList.remove('connected');updateAvailability();}});
$('#refresh-connection').addEventListener('click',async e=>{e.target.disabled=true;try{await checkConnection(true);}finally{e.target.disabled=false;}});


let saveTimer,saveQueue=Promise.resolve(),storageReady=false,savedSession=null,restoring=false;
function canvasBlob(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('이미지 저장 실패')),'image/png'));}
async function packDocument(doc){return {...doc,selection:await canvasBlob(doc.selection),protection:await canvasBlob(doc.protection),layers:await Promise.all(doc.layers.map(async l=>({...l,bitmap:await canvasBlob(l.bitmap),original:await canvasBlob(l.original)})))};}
async function unpackCanvas(blob){const image=await createImageBitmap(blob);const c=makeCanvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);image.close();return c;}
async function unpackDocument(doc){return {...doc,selection:await unpackCanvas(doc.selection),protection:await unpackCanvas(doc.protection),layers:await Promise.all(doc.layers.map(async l=>({...l,bitmap:await unpackCanvas(l.bitmap),original:await unpackCanvas(l.original)})))};}
function scheduleSave(){if(!storageReady||restoring||!state)return;clearTimeout(saveTimer);$('#save-status').textContent='브라우저 저장 대기 중';saveTimer=setTimeout(()=>{const doc=state,result=pending,drafts={...modeDrafts,[mode]:$('#prompt').value},selectedMode=mode,editIntent=$('#edit-intent').value;$('#save-status').textContent='브라우저에 저장 중…';saveQueue=saveQueue.catch(()=>{}).then(async()=>{const data={version:1,savedAt:Date.now(),doc:await packDocument(doc),mode:selectedMode,editIntent,drafts,pending:result?{operation:result.operation,layerEdit:result.layerEdit?{id:result.layerEdit.id,bitmap:await canvasBlob(result.layerEdit.bitmap)}:null,contextPatch:result.contextPatch?await canvasBlob(result.contextPatch):null,sourceLayerId:result.sourceLayerId,targetId:result.targetId,notice:result.notice,additionPlacement:result.additionPlacement,addition:result.addition?await canvasBlob(result.addition):null,before:await canvasBlob(result.before),result:await canvasBlob(result.result)}:null};await sessionStore(data);savedSession=data;$('#restore-session').hidden=true;$('#save-status').textContent='브라우저에 자동 저장됨';}).catch(()=>{$('#save-status').textContent='자동 저장 실패 · PNG를 내보내주세요';});},600);}
async function restoreAvailable(){try{savedSession=await sessionStore();$('#restore-session').hidden=!savedSession;$('#save-status').textContent=savedSession?'저장된 작업이 있습니다. 복구 버튼을 눌러주세요.':'편집하면 이 브라우저에 자동 저장됩니다.';}catch{$('#save-status').textContent='브라우저 저장을 사용할 수 없습니다.';}finally{storageReady=true;if(state)scheduleSave();}}
$('#restore-session').addEventListener('click',async()=>{if(!savedSession||locked())return;if(state&&!confirm('현재 작업을 저장된 작업으로 교체할까요?'))return;const chosenSession=savedSession;restoring=true;clearTimeout(saveTimer);processing=true;updateAvailability();try{await saveQueue.catch(()=>{});const saved=chosenSession,doc=await unpackDocument(saved.doc),result=saved.pending?{...saved.pending,layerEdit:saved.pending.layerEdit?{id:saved.pending.layerEdit.id,bitmap:await unpackCanvas(saved.pending.layerEdit.bitmap)}:null,contextPatch:saved.pending.contextPatch?await unpackCanvas(saved.pending.contextPatch):null,addition:saved.pending.addition?await unpackCanvas(saved.pending.addition):null,before:await unpackCanvas(saved.pending.before),result:await unpackCanvas(saved.pending.result)}:null;state=doc;pending=result;history=new History({...doc,action:'저장된 작업 복구'});serial=Math.max(serial,...doc.layers.map(l=>l.id));Object.assign(modeDrafts,saved.drafts);mode=saved.mode||'edit';$('#edit-intent').value=saved.editIntent||(mode==='composite'?'composite':'add');$('#prompt').value=modeDrafts[mode]||'';revision++;$('#welcome').hidden=true;frame.hidden=false;$('#restore-session').hidden=true;$('#save-status').textContent='저장된 작업 복구됨';fit();render();toast('레이어·선택·보호 영역을 복구했습니다. 이전 실행 취소 이력은 새로 시작합니다.');}catch{toast('저장된 작업을 복구하지 못했습니다.');}finally{processing=false;restoring=false;updateAvailability();scheduleSave();}});
$('#prompt').addEventListener('input',scheduleSave);

render();checkConnection();restoreAvailable();

$('#harmonize-strength').addEventListener('input',e=>$('#harmonize-value').textContent=e.target.value+'%');

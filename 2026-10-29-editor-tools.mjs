import {IDENTITY_QUAD,validQuad,renderLayer,exportOptions,refineMask} from './2026-10-29-layer-effects.mjs';

export function mountEditorTools(api){
  const $=s=>document.querySelector(s);
  const help=(anchor,text)=>`<a class="help-link" href="/2026-10-28-user-manual.html#${anchor}" target="_blank" rel="noopener" aria-label="${text} 도움말" title="${text}">?</a>`;
  const range=(id,title,min,max,value,unit='')=>`<label class="effect-row" for="${id}"><span>${title}</span><output id="${id}-value">${value}${unit}</output></label><input class="wide-range" id="${id}" type="range" min="${min}" max="${max}" value="${value}" data-unit="${unit}">`;
  const panel=document.createElement('div');panel.id='advanced-layer-tools';
  panel.innerHTML=`<details class="effect-group"><summary>레이어 마스크 ${help('mask','원본을 보존하며 숨기기·복원')}</summary><div class="effect-body"><div class="effect-actions"><button id="mask-create">선택을 마스크로</button><button id="mask-invert">반전</button></div><label class="effect-check"><input id="mask-enabled" type="checkbox">마스크 사용</label><div class="effect-actions"><button id="mask-hide">브러시로 숨기기</button><button id="mask-reveal">브러시로 복원</button></div><button id="mask-clear" class="effect-reset">마스크 제거</button><p id="mask-status" class="option-note" role="status">마스크 없음</p></div></details>
  <details class="effect-group"><summary>색감 조절 ${help('adjustments','레이어별 밝기·색온도·채도')}</summary><div class="effect-body">${range('tone-brightness','밝기',-100,100,0)}${range('tone-temperature','색온도',-100,100,0)}${range('tone-saturation','채도',-100,100,0)}<button id="tone-reset" class="effect-reset">색감 초기화</button></div></details>
  <details class="effect-group"><summary>그림자 ${help('shadow','방향·거리·흐림·불투명도')}</summary><div class="effect-body"><label class="effect-check"><input id="shadow-enabled" type="checkbox">그림자 사용</label>${range('shadow-angle','방향',-180,180,45,'°')}${range('shadow-distance','거리',0,300,20,' px')}${range('shadow-blur','흐림',0,200,16,' px')}${range('shadow-opacity','불투명도',0,100,30,'%')}<button id="shadow-reset" class="effect-reset">그림자 초기화</button></div></details>
  <details class="effect-group"><summary>변형 ${help('perspective','원근 조절·좌우 반전')}</summary><div class="effect-body"><div class="effect-actions"><button id="flip-layer">좌우 반전</button><button id="perspective-open">원근 조절</button></div><button id="perspective-reset" class="effect-reset">원근 초기화</button></div></details>`;
  $('#layer-settings').append(panel);
  const refine=document.createElement('button');refine.id='selection-refine';refine.className='text-button';refine.textContent='선택 다듬기';$('.optionsbar').append(refine);
  const dialogs=document.createElement('div');dialogs.innerHTML=`
  <dialog id="refine-dialog" aria-labelledby="refine-title"><h2 id="refine-title">선택 영역 다듬기</h2><p>점선으로 표시되는 선택 범위가 바뀝니다. 적용 전 취소할 수 있습니다.</p><label class="effect-row">방식<select id="refine-operation"><option value="expand">확대</option><option value="contract">축소</option><option value="smooth">경계 부드럽게</option></select></label>${range('refine-radius','반경',1,64,8,' px')}<p id="refine-status" class="option-note" role="status"></p><div class="dialog-actions"><button id="refine-cancel" class="quiet">취소</button><button id="refine-apply" class="primary">적용</button></div></dialog>
  <dialog id="perspective-dialog" aria-labelledby="perspective-title"><h2 id="perspective-title">원근 조절</h2><p>네 모서리를 안쪽으로 드래그해 배경의 각도에 맞추세요. 원본과 마스크는 보존됩니다.</p><canvas id="perspective-preview" width="480" height="360" aria-label="원근 미리보기: 모서리를 드래그하거나 아래 숫자를 입력하세요"></canvas><div class="quad-inputs">${['왼쪽 위','오른쪽 위','오른쪽 아래','왼쪽 아래'].map((title,i)=>`<fieldset><legend>${title}</legend><label>X %<input type="number" min="0" max="100" step="1" data-quad="${i}" data-axis="0"></label><label>Y %<input type="number" min="0" max="100" step="1" data-quad="${i}" data-axis="1"></label></fieldset>`).join('')}</div><p id="perspective-status" class="option-note" role="status"></p><div class="dialog-actions"><button id="perspective-default" class="quiet">원근 초기화</button><button id="perspective-cancel" class="quiet">취소</button><button id="perspective-apply" class="primary">적용</button></div></dialog>
  <dialog id="export-dialog" aria-labelledby="export-title"><h2 id="export-title">이미지 내보내기</h2><label class="effect-row">파일 형식<select id="export-format"><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WEBP</option></select></label><div class="dimension-inputs"><label>너비 (px)<input id="export-width" type="number" min="1" max="8192"></label><label>높이 (px)<input id="export-height" type="number" min="1" max="8192"></label></div><label class="effect-check"><input id="export-lock" type="checkbox" checked>가로·세로 비율 유지</label>${range('export-quality','품질',1,100,90,'%')}<label class="effect-check"><input id="export-transparent" type="checkbox" checked>투명 배경 유지</label><label class="effect-row">배경 색<input id="export-background" type="color" value="#ffffff"></label><img id="export-preview" alt="내보낼 이미지 미리보기"><p id="export-status" class="option-note" role="status"></p><div class="dialog-actions"><button id="export-cancel" class="quiet">취소</button><button id="export-save" class="primary">파일 저장</button></div></dialog>`;
  document.body.append(dialogs);
  const change=(changes,label)=>api.change(changes,label);
  $('#mask-create').onclick=()=>api.mask('create');$('#mask-invert').onclick=()=>api.mask('invert');$('#mask-clear').onclick=()=>api.mask('clear');
  $('#mask-enabled').onchange=e=>change({maskEnabled:e.target.checked},'마스크 사용 변경');
  $('#mask-hide').onclick=()=>api.mask('hide');$('#mask-reveal').onclick=()=>api.mask('reveal');
  const defaults={enabled:false,angle:45,distance:20,blur:16,opacity:30};
  for(const [prefix,keys,field,label] of [['tone',['brightness','temperature','saturation'],'adjustments','색감 조절'],['shadow',['angle','distance','blur','opacity'],'shadow','그림자 조절']]){
    for(const key of keys){const input=$(`#${prefix}-${key}`);input.oninput=()=>{
      // Keep the focused control in place while previewing the layer.
      $(`#${prefix}-${key}-value`).textContent=input.value+input.dataset.unit;
      const l=api.active();if(!l)return;api.preview({[field]:{...(field==='shadow'?defaults:{}),...l[field],[key]:Number(input.value)}});
    };input.onchange=()=>api.finish(label);}
  }
  $('#tone-reset').onclick=()=>change({adjustments:{brightness:0,temperature:0,saturation:0}},'색감 초기화');
  $('#shadow-enabled').onchange=e=>change({shadow:{...defaults,...api.active()?.shadow,enabled:e.target.checked}},'그림자 사용 변경');
  $('#shadow-reset').onclick=()=>change({shadow:{...defaults}},'그림자 초기화');
  $('#flip-layer').onclick=()=>change({flipX:!api.active()?.flipX},'좌우 반전');
  $('#perspective-reset').onclick=()=>change({quad:null},'원근 초기화');
  let refining=null,refined=null;
  function refinePreview(){
    if(!refining)return;try{const radius=Number($('#refine-radius').value);$('#refine-radius-value').textContent=radius+' px';refined=refineMask(refining.alpha,refining.width,refining.height,$('#refine-operation').value,radius);api.selectionPreview(refined);$('#refine-status').textContent='선택 범위 미리보기';}catch(e){$('#refine-status').textContent=e.message;}
  }
  refine.onclick=()=>{refining=api.selectionStart();if(!refining)return;refinePreview();$('#refine-dialog').showModal();};
  $('#refine-operation').onchange=refinePreview;$('#refine-radius').oninput=refinePreview;
  function closeRefine(apply){if(!refining)return;api.selectionFinish(apply);refining=null;refined=null;$('#refine-dialog').close();}
  $('#refine-apply').onclick=()=>closeRefine(true);$('#refine-cancel').onclick=()=>closeRefine(false);
  $('#refine-dialog').addEventListener('cancel',e=>{e.preventDefault();closeRefine(false);});
  let perspective=null,quad=null,corner=-1,previewQueued=false;
  const preview=$('#perspective-preview'),pad=18;
  function drawPerspective(){
    previewQueued=false;if(!perspective)return;
    const x=preview.getContext('2d'),w=preview.width-2*pad,h=preview.height-2*pad;x.clearRect(0,0,preview.width,preview.height);
    renderLayer(x,{...perspective,x:pad,y:pad,width:w,height:h,rotation:0,quad,shadow:{enabled:false},visible:true,opacity:1});
    x.strokeStyle='#d5f778';x.lineWidth=2;x.beginPath();quad.forEach(([a,b],i)=>i?x.lineTo(pad+a*w,pad+b*h):x.moveTo(pad+a*w,pad+b*h));x.closePath();x.stroke();
    quad.forEach(([a,b])=>{x.fillStyle='#d5f778';x.fillRect(pad+a*w-5,pad+b*h-5,10,10);});
    document.querySelectorAll('[data-quad]').forEach(input=>input.value=Math.round(quad[Number(input.dataset.quad)][Number(input.dataset.axis)]*100));
  }
  const schedulePerspective=()=>{if(!previewQueued){previewQueued=true;requestAnimationFrame(drawPerspective);}};
  $('#perspective-open').onclick=()=>{if(api.locked()||!api.active()||api.active().contextPatch)return;perspective=api.active();quad=(perspective.quad||IDENTITY_QUAD).map(p=>[...p]);const scale=Math.min(444/perspective.bitmap.width,440/perspective.bitmap.height);preview.width=Math.max(1,Math.round(perspective.bitmap.width*scale))+2*pad;preview.height=Math.max(1,Math.round(perspective.bitmap.height*scale))+2*pad;drawPerspective();$('#perspective-status').textContent='미리보기 · 적용해야 편집 내용에 반영됩니다.';$('#perspective-dialog').showModal();};
  const p=e=>{const b=preview.getBoundingClientRect();return {x:(e.clientX-b.left)*preview.width/b.width,y:(e.clientY-b.top)*preview.height/b.height};};
  preview.onpointerdown=e=>{const a=p(e);corner=quad.findIndex(([u,v])=>Math.hypot(a.x-pad-u*(preview.width-2*pad),a.y-pad-v*(preview.height-2*pad))<20);if(corner>=0){e.preventDefault();preview.setPointerCapture(e.pointerId);}};
  preview.onpointermove=e=>{if(corner<0)return;const a=p(e),q=quad.map(v=>[...v]);q[corner]=[Math.min(1,Math.max(0,(a.x-pad)/(preview.width-2*pad))),Math.min(1,Math.max(0,(a.y-pad)/(preview.height-2*pad)))];if(validQuad(q)){quad=q;schedulePerspective();$('#perspective-status').textContent='원근 미리보기';}else $('#perspective-status').textContent='모서리가 겹치지 않게 조절해주세요.';};
  preview.onpointerup=preview.onpointercancel=()=>{corner=-1;};
  document.querySelectorAll('[data-quad]').forEach(input=>input.onchange=()=>{const q=quad.map(v=>[...v]);q[Number(input.dataset.quad)][Number(input.dataset.axis)]=Number(input.value)/100;if(validQuad(q)){quad=q;drawPerspective();}else{drawPerspective();$('#perspective-status').textContent='유효한 사각형이 되도록 0~100 안에서 입력하세요.';}});
  $('#perspective-default').onclick=()=>{quad=IDENTITY_QUAD.map(p=>[...p]);drawPerspective();};
  function closePerspective(apply){if(apply&&perspective){const q=quad.map(p=>[...p]);document.querySelectorAll('[data-quad]').forEach(input=>q[Number(input.dataset.quad)][Number(input.dataset.axis)]=Number(input.value)/100);if(!validQuad(q)){$('#perspective-status').textContent='유효한 사각형이 되도록 모서리를 조절해주세요.';return;}change({quad:q},'원근 조절');}perspective=null;corner=-1;$('#perspective-dialog').close();}
  $('#perspective-apply').onclick=()=>closePerspective(true);$('#perspective-cancel').onclick=()=>closePerspective(false);$('#perspective-dialog').addEventListener('cancel',e=>{e.preventDefault();closePerspective(false);});
  let exportSource=null,exportBlob=null,exportURL=null,exportRevision=0;
  function options(){return exportOptions($('#export-format').value,Number($('#export-width').value),Number($('#export-height').value),Number($('#export-quality').value),$('#export-transparent').checked);}
  async function exportPreview(){
    const id=++exportRevision;$('#export-save').disabled=true;exportBlob=null;
    const format=$('#export-format').value;$('#export-quality').disabled=format==='png';$('#export-transparent').disabled=format==='jpg';$('#export-background').disabled=format!=='jpg'&&$('#export-transparent').checked;$('#export-quality-value').textContent=$('#export-quality').value+'%';
    try{const o=options(),c=document.createElement('canvas');c.width=o.width;c.height=o.height;const x=c.getContext('2d');if(!o.transparent){x.fillStyle=$('#export-background').value;x.fillRect(0,0,c.width,c.height);}x.imageSmoothingQuality='high';x.drawImage(exportSource,0,0,c.width,c.height);
      const blob=await new Promise(resolve=>c.toBlob(resolve,o.mime,o.quality));if(id!==exportRevision)return;if(!blob||blob.type!==o.mime)throw Error('이 브라우저가 선택한 형식의 저장을 지원하지 않습니다. PNG를 선택하세요.');
      if(exportURL)URL.revokeObjectURL(exportURL);exportBlob=blob;exportURL=URL.createObjectURL(blob);$('#export-preview').src=exportURL;$('#export-status').textContent=`${o.width} × ${o.height} px · ${(blob.size/1024).toFixed(1)} KB${o.format==='jpg'?' · 투명 영역은 배경 색으로 채워집니다.':''}`;$('#export-save').disabled=false;
    }catch(error){$('#export-status').textContent=error.message;}
  }
  for(const id of ['export-format','export-quality','export-transparent','export-background'])$('#'+id).onchange=exportPreview;
  for(const axis of ['width','height'])$('#export-'+axis).onchange=()=>{if($('#export-lock').checked&&exportSource){const other=axis==='width'?'height':'width';$('#export-'+other).value=Math.max(1,Math.round(Number($('#export-'+axis).value)*exportSource[other]/exportSource[axis]));}exportPreview();};
  const closeExport=()=>{$('#export-dialog').close();exportRevision++;exportBlob=null;exportSource=null;$('#export-preview').removeAttribute('src');if(exportURL)URL.revokeObjectURL(exportURL);exportURL=null;};
  $('#export-cancel').onclick=closeExport;$('#export-dialog').addEventListener('cancel',e=>{e.preventDefault();closeExport();});
  $('#export-save').onclick=()=>{if(!exportBlob)return;const a=document.createElement('a'),url=URL.createObjectURL(exportBlob);a.href=url;a.download=`2026-10-29-${api.doc().name.replace(/[<>:"/\\|?*]/g,'-')}-v1.6.0.${$('#export-format').value}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);closeExport();};
  return {
    openExport(){exportSource=api.flatten();if(!exportSource)return;$('#export-width').value=exportSource.width;$('#export-height').value=exportSource.height;$('#export-dialog').showModal();exportPreview();},
    sync(){
      const l=api.active(),disabled=!l||l.empty||l.contextPatch||api.busy();panel.hidden=!l||l.empty||l.contextPatch;$('#flip-layer').setAttribute('aria-pressed',String(!!l?.flipX));
      panel.querySelectorAll('button,input').forEach(el=>el.disabled=disabled);
      if(l){for(const k of ['brightness','temperature','saturation']){$('#tone-'+k).value=l.adjustments?.[k]||0;$('#tone-'+k+'-value').textContent=l.adjustments?.[k]||0;}
        const shadow={...defaults,...l.shadow};for(const k of ['angle','distance','blur','opacity']){$('#shadow-'+k).value=shadow[k];$('#shadow-'+k+'-value').textContent=shadow[k]+$('#shadow-'+k).dataset.unit;}
        $('#shadow-enabled').checked=shadow.enabled;$('#mask-enabled').checked=!!l.mask&&l.maskEnabled!==false;$('#mask-enabled').disabled=disabled||!l.mask;$('#mask-invert').disabled=$('#mask-clear').disabled=disabled||!l.mask;$('#mask-status').textContent=l.mask?(l.maskEnabled===false?'마스크 꺼짐 · 원본 표시':'마스크 사용 중 · 지우기(E)·복원(R)으로 보정'):'마스크 없음 · 선택이 없으면 전체 표시 마스크를 만듭니다.';
      }refine.disabled=!api.doc()||api.busy();
    }
  };
}

// Pure image operations. Masks are one byte per pixel, 255 means editable.
// PhotoCraft's layer.moveTo / layer.delete semantics: one structural operation,
// independent of selection masks. UI gestures all use this shared entry point.
export function layerCommand(doc,command,p={}){
  const source=doc.layers.find(l=>l.id===p.layer);if(!source)return doc;
  if(command==='transform'){
    const changes=p.changes||{},keys=Object.keys(changes);
    if(!keys.length||keys.some(k=>!['x','y','width','height','rotation'].includes(k)||!Number.isFinite(changes[k])||(['width','height'].includes(k)&&changes[k]<=0)))return doc;
    if(keys.every(k=>source[k]===changes[k]))return doc;
    return {...doc,layers:doc.layers.map(l=>l.id===source.id?{...l,...changes}:l.contextPatch&&l.sourceLayerId===source.id?{...l,visible:false}:l)};
  }
  if(command==='delete'){
    const layers=doc.layers.filter(l=>l.id!==source.id).map(l=>l.contextPatch&&l.sourceLayerId===source.id?{...l,visible:false}:l);
    return {...doc,layers,active:doc.active===source.id?layers.at(-1)?.id:doc.active};
  }
  if(command!=='moveTo'||source.id===p.target||!['above','below'].includes(p.position))return doc;
  const layers=doc.layers.filter(l=>l.id!==source.id),target=layers.findIndex(l=>l.id===p.target);
  if(target<0)return doc;
  layers.splice(target+(p.position==='above'?1:0),0,source);
  return layers.every((l,i)=>l===doc.layers[i])?doc:{...doc,layers};
}

// Narrow recovery for a painted neutral checkerboard, not semantic segmentation.
// Requires two neutral border tones and repeated alternation, then removes only
// connected backdrop pixels. Never runs on genuine transparent outputs.
export function recoverCheckerboard(rgba,width,height){
  if(rgba.length!==width*height*4||width<32||height<32)return null;
  const hist=new Uint32Array(64),border=[];
  const tone=p=>{const i=p*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2];return {chroma:Math.max(r,g,b)-Math.min(r,g,b),v:(r+g+b)/3};};
  let transparent=0;for(let p=0;p<width*height;p++)if(rgba[p*4+3]<250)transparent++;
  if(transparent>width*height*.001)return null;
  for(let x=0;x<width;x++)border.push(x,(height-1)*width+x);
  for(let y=1;y<height-1;y++)border.push(y*width,y*width+width-1);
  let neutral=0;for(const p of border){const t=tone(p);if(t.chroma<=12&&t.v>=80){hist[Math.min(63,t.v>>2)]++;neutral++;}}
  if(neutral<border.length*.94)return null;
  let peak=0;for(let i=1;i<64;i++)if(hist[i]>hist[peak])peak=i;
  let other=-1;for(let i=20;i<64;i++)if(Math.abs(i-peak)>=8&&(other<0||hist[i]>hist[other]))other=i;
  if(other<0||hist[other]<neutral*.08||hist[peak]<neutral*.08)return null;
  const dark=Math.min(peak,other)*4,light=Math.max(peak,other)*4,mid=(dark+light)/2;
  let transitions=0,last=null;
  for(let x=0;x<width;x++){const t=tone(x);if(t.chroma>12)continue;const side=t.v>mid;if(last!==null&&side!==last)transitions++;last=side;}
  if(transitions<6)return null;
  const n=width*height,removed=new Uint8Array(n),queue=new Uint32Array(n);let tail=0,head=0;
  const visit=p=>{if(removed[p])return;const t=tone(p);if(t.chroma>18)return;removed[p]=1;queue[tail++]=p;};
  border.forEach(visit);
  while(head<tail){const p=queue[head++],x=p%width;if(x)visit(p-1);if(x<width-1)visit(p+1);if(p>=width)visit(p-width);if(p<n-width)visit(p+width);}
  // Keep the dominant object; stray dark symbols on a fake checkerboard must not
  // become huge subject bounds. Enclosed neutral details remain in the object.
  const seen=new Uint8Array(n),labels=new Uint32Array(n);let label=0,best=0,bestCount=0;
  for(let start=0;start<n;start++){
    if(removed[start]||seen[start])continue;label++;tail=1;head=0;queue[0]=start;seen[start]=1;let count=0;
    while(head<tail){const p=queue[head++],x=p%width;labels[p]=label;count++;
      for(const q of [x?p-1:-1,x<width-1?p+1:-1,p>=width?p-width:-1,p<n-width?p+width:-1])if(q>=0&&!removed[q]&&!seen[q]){seen[q]=1;queue[tail++]=q;}
    }
    if(count>bestCount){bestCount=count;best=label;}
  }
  if(bestCount<n*.003||bestCount>n*.65)return null;
  const out=new Uint8ClampedArray(rgba);for(let p=0;p<n;p++)if(labels[p]!==best)out[p*4+3]=0;
  return out;
}

export function deleteIntent(layerFocus,hasSelection){return layerFocus||!hasSelection?'layer':'selection';}
export function resizeDimensions(layer,key,value,locked=true){
  if(!['width','height'].includes(key)||!Number.isFinite(value)||value<1||value>8192)throw Error('크기는 1~8192 px 범위로 입력해주세요.');
  const ratio=value/layer[key],other=key==='width'?'height':'width';
  const result={[key]:value,[other]:locked?layer[other]*ratio:layer[other]};
  if(result[other]<1||result[other]>8192)throw Error('비율을 유지한 크기가 허용 범위를 벗어납니다.');
  return {width:result.width,height:result.height};
}
export function isAdditionRequest(prompt){
  const text=prompt.replace(/(?:추가|넣지|배치)(?:하지\s*|하진\s*)?(?:말고|말아|마세요|마|않\S*)/g,'').replace(/\b(?:do not|don't|never)\s+(?:add|insert|place)\b/gi,'');
  return /추가|넣어|넣고|배치해|\b(?:add|insert|place)\b/i.test(text);
}
export function selectionClickIntent(mode,hasSelection,inside,distance){
  if(mode!=='replace'||!hasSelection||distance>=3)return 'draw';
  return inside?'keep':'clear';
}
export function requestGeometry(width,height) {
  const options=[[1024,1024],[1536,1024],[1024,1536]];
  const [w,h]=options.reduce((best,cur)=>Math.abs(Math.log(width/height/(cur[0]/cur[1])))<Math.abs(Math.log(width/height/(best[0]/best[1])))?cur:best);
  const scale=Math.min(w/width,h/height),drawWidth=width*scale,drawHeight=height*scale;
  return {width:w,height:h,size:`${w}x${h}`,drawWidth,drawHeight,x:(w-drawWidth)/2,y:(h-drawHeight)/2};
}
export function blendRGBA(original, generated, mask, protection) {
  if(original.length!==generated.length || mask.length!==original.length/4) throw new Error('이미지와 마스크 크기가 다릅니다.');
  const out = new Uint8ClampedArray(original);
  for(let p=0;p<mask.length;p++) {
    const m=(mask[p]/255)*(1-(protection?.[p]||0)/255), i=p*4;
    if(!m) continue;
    const a=original[i+3]/255*(1-m), b=generated[i+3]/255*m, alpha=a+b;
    for(let c=0;c<3;c++) out[i+c]=alpha ? (original[i+c]*a+generated[i+c]*b)/alpha : 0;
    out[i+3]=alpha*255;
  }
  return out;
}

// Fit the entire transparent subject into a safe rectangle inside the selection.
// Histogram rectangles keep irregular selections and protected pixels intact.
export function fitAddition(rgba,sourceWidth,sourceHeight,mask,width,height,protection) {
  if(rgba.length!==sourceWidth*sourceHeight*4||mask.length!==width*height)throw Error('이미지와 마스크 크기가 다릅니다.');
  let left=sourceWidth,top=sourceHeight,right=-1,bottom=-1,transparent=0,visible=0;
  for(let y=0;y<sourceHeight;y++)for(let x=0;x<sourceWidth;x++){
    const a=rgba[(y*sourceWidth+x)*4+3];if(a<8)transparent++;if(a>8)visible++;
    if(a){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  }
  if(transparent<Math.max(1,sourceWidth*sourceHeight*.01))throw Error('투명 배경 결과가 아닙니다. 원본 배경을 보호하기 위해 적용하지 않았습니다.');
  if(!visible)throw Error('추가할 대상이 없는 결과입니다.');
  const sw=right-left+1,sh=bottom-top+1,heights=new Uint32Array(width);
  let best=null,bestScale=0;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){const p=y*width+x;heights[x]=mask[p]>=128&&!(protection?.[p])?heights[x]+1:0;}
    const stack=[];
    for(let x=0;x<=width;x++){
      const h=x===width?0:heights[x];let start=x;
      while(stack.length&&stack[stack.length-1].h>h){
        const bar=stack.pop(),w=x-bar.x,scale=Math.min(w/sw,bar.h/sh);start=bar.x;
        if(scale>bestScale){bestScale=scale;best={x:bar.x,y:y-bar.h+1,width:w,height:bar.h};}
      }
      if(h&&(!stack.length||stack[stack.length-1].h<h))stack.push({x:start,h});
    }
  }
  if(!best)throw Error('대상을 배치할 수 있는 선택 영역이 없습니다. 보호 영역을 확인해주세요.');
  const scale=Math.min(1,bestScale)*.96,w=sw*scale,h=sh*scale;
  return {source:{x:left,y:top,width:sw,height:sh},x:best.x+(best.width-w)/2,y:best.y+(best.height-h)/2,width:w,height:h};
}

export function additionRGBA(generated,mask,protection) {
  if(generated.length!==mask.length*4)throw Error('이미지와 마스크 크기가 다릅니다.');
  let transparent=0,visible=0;
  for(let p=0;p<mask.length;p++){const a=generated[p*4+3];if(a<8)transparent++;if(a>8)visible++;if(a>128&&!mask[p])throw Error('대상이 선택 영역 밖으로 나왔습니다. 영역을 넓혀 다시 생성해주세요.');}
  if(transparent<Math.max(1,mask.length*.01))throw Error('투명 배경 결과가 아닙니다. 원본 배경을 보호하기 위해 적용하지 않았습니다.');
  if(!visible)throw Error('추가할 대상이 없는 결과입니다.');
  const out=new Uint8ClampedArray(generated);
  for(let p=0;p<mask.length;p++)out[p*4+3]*=mask[p]/255*(1-(protection?.[p]||0)/255);
  return out;
}
export function overRGBA(original,overlay) {
  if(original.length!==overlay.length)throw Error('이미지 크기가 다릅니다.');
  const out=new Uint8ClampedArray(original);
  for(let i=0;i<out.length;i+=4){const a=overlay[i+3]/255;if(!a)continue;const b=original[i+3]/255*(1-a),alpha=a+b;for(let c=0;c<3;c++)out[i+c]=alpha?(overlay[i+c]*a+original[i+c]*b)/alpha:0;out[i+3]=alpha*255;}
  return out;
}
export function featherInside(mask,width,height,radius) {
  if(!radius) return new Uint8ClampedArray(mask);
  // A distance transform fades only inward: never expands the allowed mask.
  const d = new Float32Array(mask.length), max=radius+1;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=y*width+x;
    d[i]=!mask[i] ? 0 : Math.min(max, x?max:1, y?max:1, x===width-1?1:max, y===height-1?1:max);
    if(mask[i]) d[i]=Math.min(d[i],x?d[i-1]+1:max,y?d[i-width]+1:max);
  }
  for(let y=height-1;y>=0;y--) for(let x=width-1;x>=0;x--) {
    const i=y*width+x;
    d[i]=Math.min(d[i],x<width-1?d[i+1]+1:max,y<height-1?d[i+width]+1:max);
  }
  return Uint8ClampedArray.from(mask,(a,i)=>a*Math.min(1,d[i]/max));
}

export function removeBorderBackground(rgba,width,height,tolerance=35) {
  if(rgba.length!==width*height*4) throw new Error('잘못된 이미지 크기');
  const out=new Uint8ClampedArray(rgba), visited=new Uint8Array(width*height), queue=new Int32Array(width*height);
  const corners=[0,width-1,(height-1)*width,width*height-1].map(p=>rgba.slice(p*4,p*4+3));
  const close=p=>corners.some(c=>Math.hypot(rgba[p*4]-c[0],rgba[p*4+1]-c[1],rgba[p*4+2]-c[2])<=tolerance);
  let head=0,tail=0;
  const add=p=>{ if(!visited[p]) {visited[p]=1; if(close(p)||!rgba[p*4+3]) queue[tail++]=p;} };
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
  for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  while(head<tail) {
    const p=queue[head++], x=p%width;
    out[p*4+3]=0;
    if(x) add(p-1); if(x<width-1) add(p+1);
    if(p>=width) add(p-width); if(p<width*(height-1)) add(p+width);
  }
  return out;
}

export class History {
  constructor(initial,limit=20) {this.states=[initial];this.index=0;this.limit=limit;}
  get canUndo(){return this.index>0;}
  get canRedo(){return this.index<this.states.length-1;}
  push(state) {this.states=this.states.slice(0,this.index+1);this.states.push(state);if(this.states.length>this.limit)this.states.shift();this.index=this.states.length-1;return state;}
  undo(){if(this.canUndo)this.index--;return this.states[this.index];}
  redo(){if(this.canRedo)this.index++;return this.states[this.index];}
  // Unique canvases are shared across immutable snapshots; trim old history by real pixels.
  trim(bytes=192*1024*1024) {
    const size=()=>{const seen=new Set();for(const s of this.states)for(const l of s.layers||[])for(const c of [l.bitmap,l.original])if(c)seen.add(c);for(const s of this.states)for(const c of [s.selection,s.protection])if(c)seen.add(c);return [...seen].reduce((n,c)=>n+c.width*c.height*4,0);};
    while(this.states.length>1 && this.index>0 && size()>bytes){this.states.shift();this.index--;}
  }
}

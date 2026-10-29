// Browser adaptation informed by PhotoCraft's mask/effect ordering and quad maps.
// Source links and differences are recorded in the v1.6.0 review document.
const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
export const IDENTITY_QUAD=[[0,0],[1,0],[1,1],[0,1]];
export function adjustRGBA(source,{brightness=0,temperature=0,saturation=0}={}){
  const out=new Uint8ClampedArray(source),gain=2**(clamp(brightness,-100,100)/100),warm=clamp(temperature,-100,100)*.35,sat=1+clamp(saturation,-100,100)/100;
  if(!brightness&&!temperature&&!saturation)return out;
  for(let i=0;i<out.length;i+=4){
    const r=source[i]*gain+warm,g=source[i+1]*gain,b=source[i+2]*gain-warm,y=.2126*r+.7152*g+.0722*b;
    out[i]=y+(r-y)*sat;out[i+1]=y+(g-y)*sat;out[i+2]=y+(b-y)*sat;
  }return out;
}
export function maskRGBA(source,mask){
  const out=new Uint8ClampedArray(source);if(!mask)return out;
  if(mask.length*4!==out.length)throw Error('마스크 크기가 이미지와 다릅니다.');
  for(let i=0;i<mask.length;i++)out[i*4+3]=source[i*4+3]*mask[i]/255;
  return out;
}
// Color analysis may use effective mask alpha, but saved native pixels retain
// source alpha so the live mask is applied exactly once by the renderer.
export function retainNativeAlpha(source,edited,effective){
  const out=new Uint8ClampedArray(edited);
  for(let i=0;i<out.length;i+=4){out[i+3]=source[i+3];if(!effective[i+3]){out[i]=source[i];out[i+1]=source[i+1];out[i+2]=source[i+2];}}
  return out;
}
// Separable squared Euclidean distance transform; O(width × height), independent of radius.
function distances(seed,w,h){
  const tmp=new Float64Array(w*h),out=new Float64Array(w*h),length=Math.max(w,h),f=new Float64Array(length),d=new Float64Array(length),v=new Int32Array(length),z=new Float64Array(length+1);
  const line=n=>{let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
    for(let q=1;q<n;q++){let s;do{s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));if(s<=z[k])k--;else break;}while(k>=0);k++;v[k]=q;z[k]=s;z[k+1]=Infinity;}
    k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}
  };
  for(let y=0;y<h;y++){for(let x=0;x<w;x++)f[x]=seed[y*w+x]?0:1e12;line(w);for(let x=0;x<w;x++)tmp[y*w+x]=d[x];}
  for(let x=0;x<w;x++){for(let y=0;y<h;y++)f[y]=tmp[y*w+x];line(h);for(let y=0;y<h;y++)out[y*w+x]=Math.sqrt(d[y]);}
  return out;
}
function boxBlur(mask,w,h,r){
  const tmp=new Float32Array(mask.length),out=new Uint8ClampedArray(mask.length),span=2*r+1;
  for(let y=0;y<h;y++){let sum=0;for(let x=-r;x<=r;x++)sum+=mask[y*w+clamp(x,0,w-1)];for(let x=0;x<w;x++){tmp[y*w+x]=sum/span;sum+=mask[y*w+clamp(x+r+1,0,w-1)]-mask[y*w+clamp(x-r,0,w-1)];}}
  for(let x=0;x<w;x++){let sum=0;for(let y=-r;y<=r;y++)sum+=tmp[clamp(y,0,h-1)*w+x];for(let y=0;y<h;y++){out[y*w+x]=sum/span;sum+=tmp[clamp(y+r+1,0,h-1)*w+x]-tmp[clamp(y-r,0,h-1)*w+x];}}return out;
}
export function refineMask(mask,w,h,operation,radius){
  if(mask.length!==w*h||w<1||h<1||!Number.isFinite(radius)||radius<0||radius>64||!['expand','contract','smooth'].includes(operation))throw Error('선택 다듬기 설정을 확인해주세요.');
  const r=Math.round(radius);if(!r)return new Uint8ClampedArray(mask);
  if(operation==='smooth')return boxBlur(boxBlur(mask,w,h,r),w,h,r);
  const seeds=Uint8Array.from(mask,v=>operation==='contract'?v<=127:v>=128),dist=distances(seeds,w,h),out=new Uint8ClampedArray(mask.length);
  for(let i=0;i<mask.length;i++){const coverage=255*clamp(r+1-dist[i],0,1);out[i]=operation==='expand'?Math.max(mask[i],coverage):Math.min(mask[i],255-coverage);}return out;
}
export function validQuad(q){
  if(!Array.isArray(q)||q.length!==4||q.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1)))return false;
  let sign=0;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<.0001)return false;if(sign&&sign*cross<0)return false;sign=cross;}
  return sign>0;
}
export function quadMatrix(q){
  if(!validQuad(q))throw Error('모서리가 겹치거나 뒤집히지 않게 조절해주세요.');
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q,dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  let g=0,h=0;if(Math.abs(dx3)+Math.abs(dy3)>1e-12){const det=dx1*dy2-dx2*dy1;if(Math.abs(det)<1e-12)throw Error('원근 영역이 너무 작습니다.');g=(dx3*dy2-dx2*dy3)/det;h=(dx1*dy3-dx3*dy1)/det;}
  return [x1-x0+g*x1,x3-x0+h*x3,x0,y1-y0+g*y1,y3-y0+h*y3,y0,g,h,1];
}
export function mapPoint(m,x,y){const z=m[6]*x+m[7]*y+m[8];return {x:(m[0]*x+m[1]*y+m[2])/z,y:(m[3]*x+m[4]*y+m[5])/z};}
export function invertMatrix(m){
  const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d,det=a*A+b*D+c*G;
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)throw Error('원근 영역이 너무 작습니다.');return [A,B,C,D,E,F,G,H,I].map(v=>v/det);
}
export function warpRGBA(source,w,h,quad=IDENTITY_QUAD,flip=false){
  const inv=invertMatrix(quadMatrix(quad)),out=new Uint8ClampedArray(source.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const uv=mapPoint(inv,(x+.5)/w,(y+.5)/h);if(uv.x<0||uv.x>1||uv.y<0||uv.y>1)continue;
    const sx=clamp((flip?1-uv.x:uv.x)*w-.5,0,w-1),sy=clamp(uv.y*h-.5,0,h-1),x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0,at=(y*w+x)*4;
    let a=0,r=0,g=0,b=0;
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){const k=(Math.min(h-1,y0+j)*w+Math.min(w-1,x0+i))*4,weight=(i?fx:1-fx)*(j?fy:1-fy),alpha=source[k+3]*weight;a+=alpha;r+=source[k]*alpha;g+=source[k+1]*alpha;b+=source[k+2]*alpha;}
    if(a>0){out[at]=r/a;out[at+1]=g/a;out[at+2]=b/a;out[at+3]=a;}
  }return out;
}
export function exportOptions(format,width,height,quality,transparent){
  if(!['png','jpg','webp'].includes(format)||![width,height].every(n=>Number.isInteger(n)&&n>=1&&n<=8192)||width*height>33554432||!Number.isFinite(quality)||quality<1||quality>100)throw Error('출력 크기(최대 8192px·32MP)와 품질(1~100)을 확인해주세요.');
  return {format,width,height,quality:quality/100,transparent:format!=='jpg'&&!!transparent,mime:{png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[format]};
}

const imageCache=new WeakMap();
export function renderedBitmap(layer){
  const {bitmap,mask,maskEnabled=true,adjustments={},quad,flipX=false}=layer;
  const key=JSON.stringify([adjustments,quad,flipX,maskEnabled]),cached=imageCache.get(bitmap);
  if(cached&&cached.key===key&&cached.mask===mask)return cached.canvas;
  if(!mask&&!quad&&!flipX&&!Object.values(adjustments).some(Boolean))return bitmap;
  const w=bitmap.width,h=bitmap.height,ctx=bitmap.getContext('2d',{willReadFrequently:true});
  let data=adjustRGBA(ctx.getImageData(0,0,w,h).data,adjustments);
  if(mask&&maskEnabled){const rgba=mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;data=maskRGBA(data,Uint8ClampedArray.from({length:w*h},(_,i)=>rgba[i*4+3]));}
  if(quad||flipX)data=warpRGBA(data,w,h,quad||IDENTITY_QUAD,flipX);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').putImageData(new ImageData(data,w,h),0,0);imageCache.set(bitmap,{key,mask,canvas});return canvas;
}
export function renderLayer(ctx,layer){
  if(!layer.visible)return;
  const bitmap=renderedBitmap(layer);ctx.save();ctx.globalAlpha=layer.opacity;
  ctx.translate(layer.x+layer.width/2,layer.y+layer.height/2);ctx.rotate(layer.rotation*Math.PI/180);
  const s=layer.shadow;
  if(s?.enabled){ctx.shadowColor=`rgba(0,0,0,${clamp(s.opacity,0,100)/100})`;ctx.shadowBlur=clamp(s.blur,0,200);ctx.shadowOffsetX=Math.cos(s.angle*Math.PI/180)*clamp(s.distance,0,300);ctx.shadowOffsetY=Math.sin(s.angle*Math.PI/180)*clamp(s.distance,0,300);}
  ctx.drawImage(bitmap,-layer.width/2,-layer.height/2,layer.width,layer.height);ctx.restore();
}

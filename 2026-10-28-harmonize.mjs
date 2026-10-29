// Adapted from PhotoCraft tone::match_color and poisson::seamless_clone (MIT).
// Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors.
// See 2026-10-28-third-party-notices.txt for license and adaptation details.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function toLab(r,g,b){
 const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
 r=linear(r);g=linear(g);b=linear(b);
 const f=v=>v>.008856?Math.cbrt(v):7.787*v+16/116;
 const x=f((.4124564*r+.3575761*g+.1804375*b)/.95047),y=f(.2126729*r+.7151522*g+.072175*b),z=f((.0193339*r+.119192*g+.9503041*b)/1.08883);
 return [116*y-16,500*(x-y),200*(y-z)];
}
function fromLab(l,a,b){
 const y=(l+16)/116,x=y+a/500,z=y-b/200,inv=v=>v**3>.008856?v**3:(v-16/116)/7.787;
 const X=.95047*inv(x),Y=inv(y),Z=1.08883*inv(z);
 const gamma=v=>clamp(v<=.0031308?12.92*v:1.055*Math.max(0,v)**(1/2.4)-.055,0,1);
 return [gamma(3.2404542*X-1.5371385*Y-.4985314*Z),gamma(-.969266*X+1.8760108*Y+.041556*Z),gamma(.0556434*X-.2040259*Y+1.0572252*Z)];
}
function stats(data){
 const sum=[0,0,0],sq=[0,0,0];let weight=0;
 const stride=Math.max(1,Math.floor(data.length/4/24000));
 for(let p=0;p<data.length/4;p+=stride){const i=p*4,w=data[i+3]/255;if(w<.1)continue;const lab=toLab(data[i]/255,data[i+1]/255,data[i+2]/255);weight+=w;for(let k=0;k<3;k++){sum[k]+=lab[k]*w;sq[k]+=lab[k]*lab[k]*w;}}
 if(!weight)return null;const mean=sum.map(v=>v/weight);return {mean,std:sq.map((v,k)=>Math.sqrt(Math.max(0,v/weight-mean[k]**2)))};
}
export function matchColorRGBA(subject,reference,strength=.3){
 if(subject.length%4||reference.length%4)throw Error('이미지 크기가 올바르지 않습니다.');
 const target=stats(subject),source=stats(reference);if(!source)throw Error('색감을 참고할 배경 레이어가 없습니다.');
 const out=new Uint8ClampedArray(subject);if(!target||!strength)return out;
 const amount=clamp(strength,0,1),shift=source.mean.map((v,k)=>clamp(v-target.mean[k],k? -6:-12,k?6:12));
 // PhotoCraft's Lab mean/std transfer and fade. Added shift/scale limits protect
 // subject colors from being replaced by the wall/floor's entire color range.
 const scales=target.std.map((v,k)=>clamp(v>1e-4?source.std[k]/v:1,.8,1.2));
 for(let i=0;i<out.length;i+=4){if(!subject[i+3])continue;const lab=toLab(subject[i]/255,subject[i+1]/255,subject[i+2]/255);
  const mapped=lab.map((v,k)=>(v-target.mean[k])*scales[k]+target.mean[k]+shift[k]);mapped[0]=clamp(mapped[0],0,100);
  const rgb=fromLab(...mapped);for(let k=0;k<3;k++)out[i+k]=subject[i+k]+(rgb[k]*255-subject[i+k])*amount;
 }
 return out;
}
// PhotoCraft's membrane formulation. This bounded implementation uses SOR on
// the supplied region; it does not port the upstream multigrid optimization.
export function seamlessClone(width,height,channels,source,destination,mask){
 const n=width*height;if(mask.length!==n||source.length!==n*channels||destination.length!==source.length)throw Error('블렌딩 크기가 다릅니다.');
 const unknown=[];for(let p=0;p<n;p++)if(mask[p])unknown.push(p);
 const out=new Float32Array(destination);
 for(let c=0;c<channels;c++){
  const h=new Float32Array(n);for(let p=0;p<n;p++)if(!mask[p])h[p]=destination[p*channels+c]-source[p*channels+c];
  for(let step=0;step<90;step++){let max=0;
   for(const p of unknown){const x=p%width;let sum=0,count=0;for(const q of [x?p-1:-1,x<width-1?p+1:-1,p>=width?p-width:-1,p<n-width?p+width:-1])if(q>=0){sum+=h[q];count++;}if(!count)continue;const delta=(sum/count-h[p])*1.6;h[p]+=delta;max=Math.max(max,Math.abs(delta));}
   if(max<.00005)break;
  }
  for(const p of unknown)out[p*channels+c]=source[p*channels+c]+h[p];
 }
 return out;
}
export function blendSubjectEdges(rgba,background,width,height,strength=.15){
 const n=width*height;if(rgba.length!==n*4||background.length!==rgba.length)throw Error('경계 보정 크기가 다릅니다.');
 if(n>1500000)return new Uint8ClampedArray(rgba);
 const src=new Float32Array(n*3),dst=new Float32Array(n*3),mask=new Uint8Array(n);let count=0;
 const neighbours=p=>{const x=p%width;return [x?p-1:-1,x<width-1?p+1:-1,p>=width?p-width:-1,p<n-width?p+width:-1].filter(q=>q>=0);};
 for(let p=0;p<n;p++){
  const alpha=rgba[p*4+3],near=neighbours(p),edge=alpha>8&&near.some(q=>rgba[q*4+3]<250);
  if(edge){mask[p]=1;count++;}
  const seed=alpha? p:near.find(q=>rgba[q*4+3]>8);
  for(let k=0;k<3;k++){
   src[p*3+k]=seed===undefined?background[p*4+k]/255:rgba[seed*4+k]/255;
   dst[p*3+k]=alpha&&!edge?src[p*3+k]:background[p*4+k]/255;
  }
 }
 if(!count)return new Uint8ClampedArray(rgba);
 const blended=seamlessClone(width,height,3,src,dst,mask),out=new Uint8ClampedArray(rgba),amount=clamp(strength,0,.3);
 for(let p=0;p<n;p++)if(mask[p])for(let k=0;k<3;k++)out[p*4+k]=rgba[p*4+k]+(clamp(blended[p*3+k],0,1)*255-rgba[p*4+k])*amount;
 return out;
}
export function contextOverlay(generated,mask,protection){
 if(generated.length!==mask.length*4)throw Error('합성 이미지 크기가 다릅니다.');
 const out=new Uint8ClampedArray(generated);for(let p=0;p<mask.length;p++)out[p*4+3]=generated[p*4+3]*(mask[p]/255)*(1-(protection?.[p]||0)/255);return out;
}

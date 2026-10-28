import {removeBorderBackground} from './2026-10-28-core.mjs';
let portraitPromise;
export async function removeBackground(bitmap,engine,tolerance,onProgress=()=>{}) {
  const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
  const data=ctx.getImageData(0,0,c.width,c.height);
  if(engine==='color') {
    onProgress('단색 배경 분석 중…');
    await new Promise(r=>setTimeout(r,30));
    data.data.set(removeBorderBackground(data.data,c.width,c.height,tolerance));
  } else {
    onProgress('인물 AI 준비 중 · 최초 약 26MB + 실행 라이브러리');
    try {
      if(!portraitPromise)portraitPromise=(async()=>{
        const {AutoModel,AutoProcessor,RawImage,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
        env.allowLocalModels=false;
        // Worker-less WASM works without cross-origin isolation and never uploads photos.
        env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
        const revision='7aaa8a2';
        const options={dtype:'fp32',device:'wasm',revision,progress_callback:p=>{if(p.status==='progress')onProgress(`인물 AI 다운로드 · ${Math.round(p.progress||0)}%`);}};
        const model=await AutoModel.from_pretrained('Xenova/modnet',options);
        const processor=await AutoProcessor.from_pretrained('Xenova/modnet',{revision});
        return {model,processor,RawImage};
      })();
      const {model,processor,RawImage}=await portraitPromise;
      onProgress('브라우저에서 인물 배경 분석 중…');
      const raw=new RawImage(new Uint8ClampedArray(data.data),c.width,c.height,4);
      const {pixel_values}=await processor(raw);
      const result=await model({input:pixel_values});
      const tensor=result.output||Object.values(result)[0];
      const matte=await RawImage.fromTensor(tensor[0].mul(255).to('uint8')).resize(c.width,c.height);
      for(let i=0;i<c.width*c.height;i++)data.data[i*4+3]=Math.round(data.data[i*4+3]*matte.data[i*matte.channels]/255);
    } catch(error) {
      portraitPromise=null;
      throw new Error('인물 AI를 실행하지 못했습니다. 인터넷 연결과 모델 다운로드를 확인하거나 단색 모드·수동 도구를 사용하세요.');
    }
  }
  ctx.putImageData(data,0,0);return c;
}

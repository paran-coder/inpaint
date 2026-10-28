import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {createCodexAdapter} from './2026-10-28-codex-adapter.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const publicFiles=new Map([
  ['/','2026-10-28-index.html'],
  ...['studio.mjs','core.mjs','background.mjs','storage.mjs','studio.css'].map(f=>['/2026-10-28-'+f,'2026-10-28-'+f]),
]);
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
function png(data) {
  if(typeof data!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(data))throw Object.assign(new Error('PNG 이미지 형식이 올바르지 않습니다.'),{status:400});
  const b=Buffer.from(data.slice(data.indexOf(',')+1),'base64');
  if(b.length<33||b.length>20*1024*1024||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.toString('ascii',12,16)!=='IHDR')throw Object.assign(new Error('PNG 이미지가 손상되었거나 20MB를 초과했습니다.'),{status:400});
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20);
  if(!width||!height||width>4096||height>4096)throw Object.assign(new Error('이미지는 최대 4096 × 4096이어야 합니다.'),{status:400});
  return {b,width,height,alpha:[4,6].includes(b[25])};
}
async function body(req) {
  let bytes=0;const chunks=[];
  for await(const c of req){bytes+=c.length;if(bytes>72*1024*1024)throw Object.assign(new Error('요청 용량이 너무 큽니다.'),{status:413});chunks.push(c);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('요청 JSON을 읽을 수 없습니다.'),{status:400});}
}

export function createApp(options={}) {
  const {apiKey=process.env.OPENAI_API_KEY||'',model=process.env.OPENAI_IMAGE_MODEL||'gpt-image-1.5',fetchImpl=fetch}=options;
  const provider=options.provider||(Object.hasOwn(options,'apiKey')?'api':process.env.INPAINT_PROVIDER||'codex');
  const codex=options.codexAdapter||createCodexAdapter();
  let usageLimited=false,currentController=null;const cancelledRequests=new Set();
  let inFlight=false,progress={active:false,stage:'idle',timings:{}};
  let stageStarted=0;
  function advance(stage){const now=Date.now();if(progress.active)progress.timings[progress.stage]=(progress.timings[progress.stage]||0)+now-stageStarted;progress.stage=stage;stageStarted=now;}
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      const host=req.headers.host||'';
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return json(403,{error:'로컬 주소로 접속해주세요.'});
      if(req.headers.origin && req.headers.origin!==`http://${host}`)return json(403,{error:'다른 사이트의 요청은 허용하지 않습니다.'});
      const pathname=new URL(req.url,`http://${host}`).pathname;
      if(pathname==='/api/cancel' && req.method==='POST'){const {requestId}=await body(req);if(typeof requestId!=='string'||requestId.length>100)return json(400,{error:'요청 식별자를 확인해주세요.'});cancelledRequests.add(requestId);if(cancelledRequests.size>100)cancelledRequests.delete(cancelledRequests.values().next().value);if(progress.requestId===requestId)currentController?.abort();return json(200,{accepted:true});}
      if(pathname==='/api/progress' && req.method==='GET'){const id=new URL(req.url,`http://${host}`).searchParams.get('requestId');return json(200,id&&id!==progress.requestId?{active:false,stage:'idle',requestId:id,timings:{}}:progress);}
      if(pathname==='/api/status' && req.method==='GET')return json(200,provider==='codex'?{...(await codex.status(new URL(req.url,`http://${host}`).searchParams.get('refresh')==='1')),appVersion:'1.4.1',usageLimited}:{connected:!!apiKey,provider:'api',model,version:'1.4.1'});
      if(pathname==='/api/image' && req.method==='POST') {
        if(provider!=='codex'&&!apiKey)return json(503,{error:'서버에 OPENAI_API_KEY가 설정되지 않았습니다. 로컬 편집은 사용할 수 있습니다.'});
        if(inFlight)return json(429,{error:'생성이 진행 중입니다. 완료 후 다시 시도하세요.'});
        const input=await body(req);if(cancelledRequests.has(input.requestId))return json(409,{error:'취소된 요청입니다.'});
        if(!['edit','generate'].includes(input.mode)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>8000)return json(400,{error:'작업 종류와 1~8000자 요청을 확인해주세요.'});
        if(provider==='codex'){
          if(inFlight)return json(429,{error:'생성이 진행 중입니다. 완료 후 다시 시도하세요.'});
          inFlight=true;progress={active:true,requestId:typeof input.requestId==='string'?input.requestId.slice(0,100):null,stage:'preparation',timings:{}};stageStarted=Date.now();const controller=new AbortController(),cancel=()=>controller.abort();currentController=controller;res.on('close',cancel);
          try{
          if(res.destroyed)return;
          const status=await codex.status();if(res.destroyed||controller.signal.aborted)return;
          if(!status.connected)return json(503,{error:status.installed?'Codex에 ChatGPT 계정으로 로그인해주세요.':'Codex CLI 설치 상태를 확인해주세요.'});
          if(input.mode==='edit'){
            const source=png(input.image),mask=png(input.mask),guide=png(input.guide);
            if(!mask.alpha||source.width!==mask.width||source.height!==mask.height||source.width!==guide.width||source.height!==guide.height)return json(400,{error:'원본·편집 영역 안내·알파 마스크 크기가 일치해야 합니다.'});
            if(input.reference)png(input.reference);
          }
          const result=await codex.generate(input,{signal:controller.signal,onProgress:advance});usageLimited=false;if(!res.destroyed)return json(200,result);}
          catch(error){const limited=/사용 한도|usage.?limit|quota|rate.?limit/i.test(error.message||'');if(limited)usageLimited=true;if(!res.destroyed)return json(error.status||502,{code:limited?'USAGE_LIMIT':'GENERATION_FAILED',error:/ENOENT|EACCES|spawn|[A-Z]:[\\/]/i.test(error.message||'')?'Codex 실행 또는 결과 회수에 실패했습니다. 설치 상태와 파일 접근 권한을 확인하세요.':error.message||'Codex 이미지 실행을 완료하지 못했습니다.'});}
          finally{advance('idle');progress.active=false;currentController=null;res.off('close',cancel);inFlight=false;}return;
        }
        const quality=['low','medium','high'].includes(input.quality)?input.quality:'medium';
        let payload,endpoint;
        if(input.mode==='edit') {
          const image=png(input.image),mask=png(input.mask);
          if(!mask.alpha||image.width!==mask.width||image.height!==mask.height)return json(400,{error:'편집 마스크는 원본과 같은 크기의 알파 PNG여야 합니다.'});
          const size=['1024x1024','1536x1024','1024x1536'].includes(input.size)?input.size:'auto';
          payload=new FormData();payload.append('model',model);payload.append('prompt',input.prompt);payload.append('quality',quality);payload.append('size',size);payload.append('output_format','png');
          payload.append('image[]',new Blob([image.b],{type:'image/png'}),'image.png');
          if(input.reference)payload.append('image[]',new Blob([png(input.reference).b],{type:'image/png'}),'reference.png');
          if(input.addition===true)payload.append('background','transparent');
          payload.append('mask',new Blob([mask.b],{type:'image/png'}),'mask.png');
          endpoint='edits';
        } else {
          const size=['1024x1024','1536x1024','1024x1536'].includes(input.size)?input.size:'1024x1024';
          payload=JSON.stringify({model,prompt:input.prompt,quality,size,output_format:'png',n:1});endpoint='generations';
        }
        if(inFlight)return json(429,{error:'생성이 진행 중입니다. 완료 후 다시 시도하세요.'});
        inFlight=true;progress={active:true,requestId:input.requestId||null,stage:'generation',timings:{}};stageStarted=Date.now();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
        currentController=controller;const disconnected=()=>controller.abort();res.on('close',disconnected);
        try {
          const upstream=await fetchImpl(`https://api.openai.com/v1/images/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,...(typeof payload==='string'?{'Content-Type':'application/json'}:{})},body:payload,signal:controller.signal});
          if(!upstream.ok){
            const message=upstream.status===401?'API 키 인증에 실패했습니다. 서버 설정을 확인하세요.':upstream.status===429?'사용량 또는 요청 한도를 확인해주세요.':upstream.status===403?'이 계정에서 이미지 모델을 사용할 수 없습니다.':upstream.status===400?'이미지 모델이 요청을 처리하지 못했습니다. 입력과 모델 설정을 확인하세요.':'이미지 서비스에 오류가 발생했습니다.';
            return json(502,{error:message});
          }
          const result=await upstream.json(),encoded=result.data?.[0]?.b64_json;
          if(typeof encoded!=='string')return json(502,{error:'이미지 서비스에서 이미지가 반환되지 않았습니다.'});
          const image=`data:image/png;base64,${encoded}`;png(image);return json(200,{image});
        } catch(error) {
          if(!res.destroyed)return json(502,{error:controller.signal.aborted?'생성 대기 시간이 초과되었거나 취소되었습니다. 작업은 유지됩니다.':'이미지 서비스에 연결하지 못했습니다. 작업은 유지됩니다.'});
        } finally {advance('idle');progress.active=false;currentController=null;clearTimeout(timer);res.off('close',disconnected);inFlight=false;}
        return;
      }
      if(req.method!=='GET')return json(405,{error:'지원하지 않는 요청입니다.'});
      const file=publicFiles.get(pathname);
      if(!file)return json(404,{error:'페이지가 없습니다.'});
      const data=await readFile(path.join(root,file));
      res.writeHead(200,{'Content-Type':types[path.extname(file)]});res.end(data);
    } catch(error) {if(!res.headersSent)json(error.status||500,{error:error.status?error.message:'서버에서 요청을 처리하지 못했습니다.'});}
  });
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||4173);
  const app=createApp();app.on('error',error=>{console.error(error.code==='EADDRINUSE'?`포트 ${port}가 사용 중입니다. 다른 PORT를 지정하세요.`:error.message);process.exitCode=1;});
  app.listen(port,'127.0.0.1',()=>console.log(`Inpaint Studio-v1.4.1\nhttp://127.0.0.1:${port}\nAI provider: ${process.env.INPAINT_PROVIDER||'codex'} · 상태는 앱에서 확인`));
}

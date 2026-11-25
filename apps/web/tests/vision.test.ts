import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeImageDirect,validateVisionRequest,MAX_VISION_BYTES,type VisionRequest} from '../lib/vision';
import type {ProviderConfig} from '../lib/types';

const image='data:image/png;base64,'+Buffer.from('\x89PNG\r\n\x1a\noriginal synthetic image fixture','latin1').toString('base64');
const request:VisionRequest={dataUrl:image,prompt:'Extract visible code and explain the diagram.',consent:true};
const config=(provider:ProviderConfig['provider']='openai'):ProviderConfig=>({provider,model:provider==='gemini'?'gemini-2.5-flash':provider==='claude'?'claude-sonnet-4-5':'gpt-4.1-mini',baseUrl:'https://untrusted-origin.invalid',configured:true});

test('PNG, JPEG and WebP signatures must match their declared image type',()=>{
 const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0,0,0]).toString('base64');
 const webp='data:image/webp;base64,'+Buffer.from('RIFF0000WEBPoriginal-fixture').toString('base64');
 assert.equal(validateVisionRequest(config(),request).mime,'image/png');
 assert.equal(validateVisionRequest(config(),{...request,dataUrl:jpeg}).mime,'image/jpeg');
 assert.equal(validateVisionRequest(config(),{...request,dataUrl:webp}).mime,'image/webp');
 assert.throws(()=>validateVisionRequest(config(),{...request,dataUrl:jpeg.replace('image/jpeg','image/png')}),/does not match/);
});

test('vision validates consent, provider, format, size and prompt before network access',async()=>{
 let calls=0;const transport:typeof fetch=async()=>{calls++;throw Error('unexpected fetch');};
 for(const invalid of [{...request,consent:false},{...request,dataUrl:'https://private.example/image.png'},{...request,dataUrl:'data:image/svg+xml;base64,PHN2Zz4='},{...request,dataUrl:'data:image/png;base64,YmFk'},{...request,prompt:''},{...request,prompt:'x'.repeat(8001)}])await assert.rejects(analyzeImageDirect(config(),invalid,'fixture-only-key',undefined,transport));
 await assert.rejects(analyzeImageDirect(config('ollama'),request,'fixture-only-key',undefined,transport),/not enabled/);
 await assert.rejects(analyzeImageDirect(config('compatible'),request,'fixture-only-key',undefined,transport),/not enabled/);
 await assert.rejects(analyzeImageDirect(config(),request,'',undefined,transport),/Connect this provider/);
 const oversized='data:image/png;base64,'+Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n','latin1'),Buffer.alloc(MAX_VISION_BYTES)]).toString('base64');
 assert.throws(()=>validateVisionRequest(config(),{...request,dataUrl:oversized}),/5 MiB/);
 assert.equal(calls,0);
});

for(const provider of ['openai','gemini','claude'] as const)test(`${provider} image adapter sends only to its official origin with faithful image payload`,async()=>{
 let calls=0;
 const transport:typeof fetch=async(url,options)=>{calls++;const parsed=new URL(String(url));const headers=options?.headers as Record<string,string>;const payload=JSON.parse(String(options?.body));assert.equal(options?.credentials,'omit');assert.equal(options?.redirect,'error');assert.equal(JSON.stringify(payload).includes('fixture-only-key'),false);assert.match(JSON.stringify(payload),/untrusted source material/);
  if(provider==='openai'){assert.equal(parsed.origin,'https://api.openai.com');assert.equal(headers.Authorization,'Bearer fixture-only-key');assert.equal(payload.model,'gpt-4.1-mini');assert.equal(payload.messages[1].content[1].image_url.url,image);return new Response(JSON.stringify({choices:[{message:{content:'Visible code: x = 42\nExplanation: a synthetic fixture.'}}]}));}
  if(provider==='gemini'){assert.equal(parsed.origin,'https://generativelanguage.googleapis.com');assert.equal(headers['x-goog-api-key'],'fixture-only-key');assert.equal(payload.contents[0].parts[1].inlineData.mimeType,'image/png');assert.equal(payload.contents[0].parts[1].inlineData.data,image.split(',')[1]);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'internal thought',thought:true},{text:'Visible code: x = 42'}]}}]}));}
  assert.equal(parsed.origin,'https://api.anthropic.com');assert.equal(headers['x-api-key'],'fixture-only-key');assert.equal(headers['anthropic-dangerous-direct-browser-access'],'true');assert.equal(payload.messages[0].content[0].source.data,image.split(',')[1]);return new Response(JSON.stringify({content:[{type:'text',text:'Visible code: x = 42'}]}));
 };
 const result=await analyzeImageDirect(config(provider),request,'fixture-only-key',undefined,transport);
 assert.equal(result.provider,provider);assert.equal(result.aiGenerated,true);assert.match(result.text,/x = 42/);assert.equal(result.text.includes('internal thought'),false);assert.equal(calls,1);
});

test('vision errors do not echo provider error contents or secrets and unsupported models stay explicit',async()=>{
 const fail:typeof fetch=async()=>new Response(JSON.stringify({error:{message:'PRIVATE-IMAGE-CONTENT fixture-only-key'}}),{status:400});
 await assert.rejects(analyzeImageDirect(config(),request,'fixture-only-key',undefined,fail),error=>{assert.match((error as Error).message,/supports images/);assert.doesNotMatch((error as Error).message,/PRIVATE-IMAGE|fixture-only-key/);return true;});
 await assert.rejects(analyzeImageDirect(config(),request,'fixture-only-key',undefined,async()=>new Response('{}')),/No image-analysis text/);
});

test('vision cancellation is passed to the upstream request and no background retry occurs',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(analyzeImageDirect(config(),request,'fixture-only-key',controller.signal,async()=>{calls++;return new Response('{}');}),error=>(error as Error).name==='AbortError');assert.equal(calls,0);
 const active=new AbortController();
 await assert.rejects(analyzeImageDirect(config(),request,'fixture-only-key',active.signal,async(_url,options)=>{calls++;assert.equal(options?.signal?.aborted,false);active.abort();assert.equal(options?.signal?.aborted,true);throw new DOMException('Aborted','AbortError');}),error=>(error as Error).name==='AbortError');assert.equal(calls,1);
});

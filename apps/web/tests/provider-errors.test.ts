import test from 'node:test';
import assert from 'node:assert/strict';
import {clearKey,generate,listModels,providerBase,setKey} from '../lib/providers';

test('upstream authentication and stream errors cannot echo credential-like contents',async()=>{
  const originalWindow=globalThis.window,originalFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'window',{value:{},configurable:true,writable:true});
  const config={provider:'openai' as const,model:'gpt-4.1-mini',baseUrl:'',configured:true};
  const sentinel='private-credential-sentinel';
  try{
    await setKey('openai','synthetic-session-key');
    let redirectMode:RequestRedirect|undefined;
    globalThis.fetch=async(_url,init)=>{
      redirectMode=init?.redirect;
      return Response.json({error:{message:sentinel}},{status:401});
    };
    await assert.rejects(generate(config,'Synthetic practice question'),error=>error instanceof Error&&/credentials/.test(error.message)&&!error.message.includes(sentinel));
    assert.equal(redirectMode,'error');
    globalThis.fetch=async()=>new Response(`data: ${JSON.stringify({error:{message:sentinel}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
    await assert.rejects(generate(config,'Synthetic practice question'),error=>error instanceof Error&&/streaming error/.test(error.message)&&!error.message.includes(sentinel));
  }finally{
    await clearKey('openai');
    globalThis.fetch=originalFetch;
    if(originalWindow===undefined)Reflect.deleteProperty(globalThis,'window');
    else Object.defineProperty(globalThis,'window',{value:originalWindow,configurable:true,writable:true});
  }
});

test('a connected compatible-provider key cannot follow an imported or edited origin',async()=>{
 const originalWindow=globalThis.window,originalFetch=globalThis.fetch;
 Object.defineProperty(globalThis,'window',{value:{},configurable:true,writable:true});
 let requests=0;
 const config={provider:'compatible' as const,model:'synthetic-model',baseUrl:'https://trusted.example.test/v1',configured:true};
 try{
  await setKey('compatible','synthetic-private-key',config.baseUrl);
  globalThis.fetch=async()=>{requests++;return Response.json({data:[]});};
  const changed={...config,baseUrl:'https://untrusted.example.test/v1'};
  await assert.rejects(generate(changed,'Synthetic question'),/origin changed/);
  await assert.rejects(listModels(changed),/origin changed/);
  assert.equal(requests,0,'The credential must never reach the changed origin');
  assert.deepEqual(await listModels(config),[]);assert.equal(requests,1);
  await setKey('compatible','synthetic-new-key',changed.baseUrl);
  assert.deepEqual(await listModels(changed),[]);assert.equal(requests,2);
 }finally{
  await clearKey('compatible');globalThis.fetch=originalFetch;
  if(originalWindow===undefined)Reflect.deleteProperty(globalThis,'window');else Object.defineProperty(globalThis,'window',{value:originalWindow,configurable:true,writable:true});
 }
});

test('provider URLs reject query or fragment credentials before a request',()=>{
 for(const baseUrl of ['https://trusted.example.test/v1?api_key=synthetic-secret','https://trusted.example.test/#synthetic-secret'])assert.throws(()=>providerBase({provider:'compatible',model:'test',baseUrl,configured:false}),/query parameters or fragments/);
});

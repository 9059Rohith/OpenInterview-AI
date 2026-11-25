import test from 'node:test';
import assert from 'node:assert/strict';
import {clearKey,generate,setKey} from '../lib/providers';

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

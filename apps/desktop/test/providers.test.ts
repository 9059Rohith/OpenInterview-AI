import {test} from 'node:test';
import assert from 'node:assert/strict';
import { compatibleBase,generate,providerPlan,checkedJson,safeUsage } from '../src/providers.js';
import {generation} from '../src/security.js';
const input={provider:'openai',model:'gpt-4.1-mini',requestId:'test-request',messages:[{role:'user',content:'Explain a queue'}]};
test('provider request destinations are fixed, keys remain in headers',()=>{
  const request=generation(input),plan=providerPlan(request,'test-secret');assert.equal(plan.url,'https://api.openai.com/v1/chat/completions');assert.equal(plan.headers.Authorization,'Bearer test-secret');assert.equal(JSON.stringify(plan.body).includes('test-secret'),false);
  assert.throws(()=>compatibleBase('http://localhost:8000'));assert.throws(()=>compatibleBase('https://user:secret@example.test'));assert.throws(()=>compatibleBase(undefined));
  assert.equal(providerPlan({...request,provider:'gemini'},'test-key').url,'https://generativelanguage.googleapis.com/v1beta/models/gpt-4.1-mini:generateContent');
});
test('generation parses provider fixture and forbids HTTP redirects',async()=>{
  const fetcher=(async(url:string|URL|Request,options?:RequestInit)=>{assert.equal(String(url),'https://api.openai.com/v1/chat/completions');assert.equal(options?.redirect,'error');return new Response(JSON.stringify({choices:[{message:{content:'A queue is FIFO.'}}],usage:{total_tokens:10}}),{status:200});}) as typeof fetch;
  const result=await generate(input,()=> 'synthetic-test-key',new AbortController().signal,undefined,fetcher);assert.equal(result.text,'A queue is FIFO.');assert.equal(result.requestId,'test-request');
});
test('provider errors are sanitized instead of exposing upstream response',async()=>{
  const fetcher=(async()=>new Response('secret-key-and-private-provider-body',{status:401})) as typeof fetch;
  await assert.rejects(()=>checkedJson('https://api.openai.com',{},fetcher),/rejected credentials/);
  await assert.rejects(()=>checkedJson('https://api.openai.com',{},(async()=>new Response('private-synthetic-transcript-not-json')) as typeof fetch),{message:'Provider returned an invalid JSON response'});
});
test('cancellation is passed to fetch and prevents response generation',async()=>{
  const controller=new AbortController();controller.abort();const fetcher=(async(_url:unknown,options?:RequestInit)=>{assert.equal(options?.signal?.aborted,true);throw new DOMException('Cancelled','AbortError');}) as typeof fetch;
  await assert.rejects(()=>generate(input,()=> 'synthetic',controller.signal,undefined,fetcher),{name:'AbortError'});
});
test('all supported adapters normalize their response',async()=>{
  for(const [provider,result]of [['gemini',{candidates:[{content:{parts:[{text:'Gemini ready'}]}}]}],['claude',{content:[{type:'text',text:'Claude ready'}]}],['ollama',{message:{content:'Ollama ready'}}]] as const){const response=await generate({...input,provider},()=> 'synthetic',new AbortController().signal,undefined,(async()=>new Response(JSON.stringify(result),{status:200}))as typeof fetch);assert.match(response.text,/ready$/);}
});
test('usage metadata returns only finite token counts, never arbitrary provider fields',()=>{assert.deepEqual(safeUsage({total_tokens:54,secret:'synthetic-must-not-leak',input_tokens:-1,output_tokens:Infinity}),{total_tokens:54});});

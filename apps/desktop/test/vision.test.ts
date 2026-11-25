import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visionInput,visionRequest} from '../src/vision.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=';
const input={provider:'openai',model:'gpt-4.1-mini',dataUrl:png,prompt:'Extract visible text.',consent:true,requestId:'vision-test'};
test('vision requires explicit consent, local data URL, image MIME and matching magic bytes',()=>{
  assert.equal(visionInput(input).model,'gpt-4.1-mini');assert.throws(()=>visionInput({...input,consent:false}),/consent/);assert.throws(()=>visionInput({...input,dataUrl:'https://attacker.test/image.png'}),/data URL/);assert.throws(()=>visionInput({...input,dataUrl:png.replace('image/png','image/svg+xml')}),/data URL/);assert.throws(()=>visionInput({...input,dataUrl:'data:image/png;base64,'+Buffer.from('not-an-image-but-long-enough').toString('base64')}),/declared format/);assert.throws(()=>visionInput({...input,provider:'claude'}),/requires OpenAI/);
});
test('vision calls exact OpenAI origin with in-memory image and sanitized result metadata',async()=>{
  const result=await visionRequest(input,'synthetic-key',new AbortController().signal,(async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(options?.redirect,'error');const body=JSON.parse(options?.body as string);assert.equal(body.messages[1].content[1].image_url.url,png);assert.equal(body.max_completion_tokens,2048);return new Response(JSON.stringify({choices:[{message:{content:'Visible diagram text.'}}],usage:{total_tokens:100,secret:'not-returned'}}));})as typeof fetch);assert.equal(result.text,'Visible diagram text.');assert.equal(result.aiGenerated,true);assert.deepEqual(result.usage,{total_tokens:100});
});
test('vision cancellation propagates and invalid provider responses do not expose content',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(()=>visionRequest(input,'synthetic',controller.signal,(async(_url,options)=>{assert.equal(options?.signal?.aborted,true);throw new DOMException('Stopped','AbortError');})as typeof fetch),{name:'AbortError'});
  await assert.rejects(()=>visionRequest(input,'synthetic',new AbortController().signal,(async()=>new Response('private-synthetic-content'))as typeof fetch),{message:'Image analysis returned an invalid JSON response'});
});

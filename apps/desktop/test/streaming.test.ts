import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateStreaming} from '../src/providers.js';
import type {Provider} from '../src/security.js';
function stream(text:string){const bytes=new TextEncoder().encode(text);let position=0;return new ReadableStream<Uint8Array>({pull(controller){if(position>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(position,position+7));position+=7;}});}
const base={model:'test-model',requestId:'stream-test',messages:[{role:'user',content:'Explain FIFO'}]};
test('all five providers parse split UTF-8 streaming boundaries and emit cumulative output',async()=>{
  for(const p of ['openai','compatible','gemini','claude','ollama'] as Provider[]){
    const events=['Queues are ','FIFO café.'].map(content=>p==='ollama'?JSON.stringify({message:{content}})+'\n':p==='claude'?'event: content_block_delta\r\ndata: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:content}})+'\r\n\r\n':p==='gemini'?'data: '+JSON.stringify({candidates:[{content:{parts:[{text:content}]}}]})+'\n\n':'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n').join('');
    const emitted:string[]=[];
    const result=await generateStreaming({...base,provider:p},()=> 'synthetic-key',new AbortController().signal,text=>emitted.push(text),'https://compatible.example/v1',(async(url,options)=>{
      const origins:Record<Provider,string>={openai:'https://api.openai.com',compatible:'https://compatible.example',gemini:'https://generativelanguage.googleapis.com',claude:'https://api.anthropic.com',ollama:'http://127.0.0.1:11434'};
      assert.equal(new URL(String(url)).origin,origins[p]);assert.equal(options?.redirect,'error');
      const body=JSON.parse(options?.body as string);if(p==='gemini')assert.match(String(url),/:streamGenerateContent\?alt=sse$/);else assert.equal(body.stream,true);
      return new Response(stream(events+(p==='openai'||p==='compatible'?'data: [DONE]\n\n':'')));
    })as typeof fetch);
    assert.equal(result.text,'Queues are FIFO café.');assert.equal(emitted.at(-1),result.text);assert.ok(emitted.length>=1);
  }
});
test('abort after first stream chunk cancels the in-flight reader',async()=>{
  const controller=new AbortController();let partial='';
  const fetcher=(async(_url,options)=>new Response(new ReadableStream({start(streamController){streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n'));options?.signal?.addEventListener('abort',()=>streamController.error(new DOMException('Stopped','AbortError')),{once:true});}})))as typeof fetch;
  await assert.rejects(()=>generateStreaming({...base,provider:'openai'},()=> 'synthetic',controller.signal,text=>{partial=text;controller.abort();},undefined,fetcher),{name:'AbortError'});
  assert.equal(partial,'Partial answer');
});
test('malformed SSE cannot leak provider response content in errors',async()=>{
  await assert.rejects(()=>generateStreaming({...base,provider:'openai'},()=> 'synthetic',new AbortController().signal,()=>{},undefined,(async()=>new Response(stream('data: private-synthetic-response\n\n')))as typeof fetch),{message:'Provider returned invalid stream data'});
});

import {generateStreaming,ollamaJson} from '../src/providers.js';
async function main(){
  const installed=await ollamaJson('tags');const selected=installed.models?.find((item:{name:string})=>item.name==='qwen2.5:0.5b');
  if(!selected)throw new Error('qwen2.5:0.5b is not installed; this check never downloads models');
  let events=0;const response=await generateStreaming({provider:'ollama',model:selected.name,requestId:'manual-local-stream',maxTokens:64,messages:[{role:'user',content:'What does FIFO stand for? Answer in one short sentence.'}]},()=>'',AbortSignal.timeout(60000),()=>events++);
  console.log(JSON.stringify({model:response.model,text:response.text,elapsedMs:response.elapsedMs,streamEvents:events}));
  const controller=new AbortController();let cancellationEvents=0;let cancelled=false;
  try{await generateStreaming({provider:'ollama',model:selected.name,requestId:'manual-local-cancel',maxTokens:256,messages:[{role:'user',content:'Explain queues in detail with several examples.'}]},()=>'',controller.signal,()=>{cancellationEvents++;controller.abort();});}catch(error){if((error as Error).name==='AbortError')cancelled=true;else throw error;}
  if(!cancelled||!cancellationEvents)throw new Error('Real local streaming cancellation failed');
  console.log(JSON.stringify({cancelled,eventsBeforeCancel:cancellationEvents}));
}
void main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});

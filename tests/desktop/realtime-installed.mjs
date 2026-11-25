import {_electron as electron} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
function pcm(wav){let offset=12;while(offset+8<wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data')return wav.subarray(offset+8,offset+8+size).toString('base64');offset+=8+size+(size%2);}throw Error('Synthetic WAV data missing');}
const fixtures={PC:pcm(await readFile('.local/realtime-pc.wav')),MIC:pcm(await readFile('.local/realtime-mic.wav'))};
const app=await electron.launch({executablePath:path.join(process.env.LOCALAPPDATA,'Programs/OpenInterview AI/OpenInterview AI.exe'),args:[],timeout:45000});
try{
 const page=await app.firstWindow();await page.getByRole('heading',{name:'Make your next interview your best one.'}).waitFor();
 const report=await page.evaluate(async fixtures=>{
  const bridge=window.openInterviewDesktop;if(bridge.version!=='0.3.0')throw Error('Installed realtime build not loaded');
  const before=(await bridge.storeGet({key:'workspace'}))?.sessions?.length??0,events=[],ids={PC:crypto.randomUUID(),MIC:crypto.randomUUID()};let began;
  const off=bridge.onEvent(event=>{if(event.type==='speech-event'&&Object.values(ids).includes(event.requestId))events.push({...event,at:performance.now()});});
  try{
   await Promise.all(['PC','MIC'].map(source=>bridge.speechStart({requestId:ids[source],source,consent:true,language:'en'})));began=performance.now();
   await Promise.all(['PC','MIC'].map(async source=>{const bytes=Uint8Array.from(atob(fixtures[source]),c=>c.charCodeAt(0));for(let index=0;index<bytes.length;index+=960){let encoded='';for(const b of bytes.subarray(index,index+960))encoded+=String.fromCharCode(b);await bridge.speechAppend({requestId:ids[source],base64:btoa(encoded)});await new Promise(resolve=>setTimeout(resolve,20));}await bridge.speechCommit({requestId:ids[source]});await bridge.speechStop({requestId:ids[source]});}));
   const after=(await bridge.storeGet({key:'workspace'}))?.sessions?.length??0;
   return {version:bridge.version,installedPackagedBridge:true,workspaceHistoryUnchanged:before===after,results:['PC','MIC'].map(source=>({source,firstPartialMs:events.find(e=>e.source===source&&e.kind==='partial')?Math.round(events.find(e=>e.source===source&&e.kind==='partial').at-began):null,text:events.find(e=>e.source===source&&e.kind==='final')?.text,errors:events.filter(e=>e.source===source&&e.kind==='error').map(e=>e.message)}))};
  }finally{off();await Promise.allSettled(Object.values(ids).map(requestId=>bridge.speechCancel({requestId})));}
 },fixtures);
 assert(report.workspaceHistoryUnchanged);for(const result of report.results){assert(result.text&&result.firstPartialMs!==null);assert.equal(result.errors.length,0);}assert.match(report.results[0].text,/idempotent/i);assert.match(report.results[1].text,/queue/i);
 await writeFile(path.join(root,'.local/realtime-installed-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('PASS: installed 0.3.0 native IPC/vault/WebSocket emits real partials and finals without modifying workspace history');
}finally{await app.close();}

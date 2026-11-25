import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=process.cwd(),profile=await mkdtemp(path.join(os.tmpdir(),'oi-realtime-ui-'));
for(const name of ['Local State','credentials.enc.json'])await copyFile(path.join(process.env.APPDATA,'OpenInterview AI',name),path.join(profile,name));
const pc=await readFile(path.join(root,'.local/realtime-pc.wav')),mic=await readFile(path.join(root,'.local/realtime-mic.wav'));
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'apps/desktop'),'--shadow-fixture'],env:{...process.env,OPENINTERVIEW_TEST_PROFILE:profile},timeout:45000});
try{
 await app.waitForEvent('window',{predicate:p=>p.url().includes('desktopShadow=1'),timeout:15000}).catch(()=>{});
 const page=app.windows().find(p=>p.url().includes('desktopShadow=1'));assert(page);await page.getByRole('textbox',{name:'Ask a question',exact:true}).waitFor();
 // This replaces only the app-owned consent dialog for synthetic tracks. No OS
 // microphone permission is granted and no physical microphone is opened.
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 await page.evaluate(async fixtures=>{
  window.qa={sources:[],events:[],started:0,finished:0,contexts:[],recorders:0};
  window.openInterviewDesktop.onEvent(event=>{if(event.type==='speech-event')window.qa.events.push({...event,at:performance.now()});});
  window.MediaRecorder=class{constructor(){window.qa.recorders++;throw Error('Desktop realtime must never create MediaRecorder');}};
  async function source(label){
   const context=new AudioContext({sampleRate:48000});await context.resume();const bytes=Uint8Array.from(atob(fixtures[label]),c=>c.charCodeAt(0));const buffer=await context.decodeAudioData(bytes.buffer);const node=context.createBufferSource();node.buffer=buffer;const dest=context.createMediaStreamDestination();node.connect(dest);const stream=dest.stream;
   if(label==='PC'){const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;stream.addTrack(canvas.captureStream(2).getVideoTracks()[0]);}
   window.qa.sources.push({label,node,stream,context,dest,duration:buffer.duration});window.qa.contexts.push(context);return stream;
  }
  Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:()=>source('PC')});Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>source('MIC')});
 },{PC:pc.toString('base64'),MIC:mic.toString('base64')});
 await page.getByLabel('Microphone',{exact:true}).check();await page.getByLabel(/I have permission to record this conversation/).check();await page.getByRole('button',{name:'Start transcription'}).click();
 await page.getByRole('button',{name:'Stop capture'}).waitFor({timeout:35000});
 await page.getByRole('tab',{name:/Transcript/}).click();
 await page.evaluate(()=>{window.qa.started=performance.now();for(const input of window.qa.sources)input.node.start();});
 await page.waitForFunction(()=>window.qa.events.some(e=>e.kind==='partial'&&e.source==='PC')&&window.qa.events.some(e=>e.kind==='partial'&&e.source==='MIC'),undefined,{timeout:20000});
 // Wait for automatic 700ms VAD commit on PC, and make a second MIC turn that
 // ends by pressing Stop rather than waiting for a new four-second file.
 await page.waitForFunction(()=>window.qa.events.filter(e=>e.kind==='final').length>=2,undefined,{timeout:20000});
 assert.match(await page.locator('.shadow-transcript-panel').innerText(),/idempotent/i);
 const before=await page.evaluate(()=>({events:window.qa.events,started:window.qa.started,recorders:window.qa.recorders,durations:window.qa.sources.map(s=>({source:s.label,duration:s.duration}))}));
 await page.evaluate(()=>new Promise(resolve=>{const input=window.qa.sources.find(s=>s.label==='PC'),original=input.node.buffer,samples=original.getChannelData(0);let end=samples.length-1;while(end>0&&Math.abs(samples[end])<.005)end--;end=Math.min(samples.length,end+Math.round(original.sampleRate*.04));const trimmed=input.context.createBuffer(1,end,original.sampleRate);trimmed.copyToChannel(samples.subarray(0,end),0);const repeat=input.context.createBufferSource();repeat.buffer=trimmed;repeat.connect(input.dest);repeat.onended=resolve;repeat.start();}));
 await page.getByRole('button',{name:'Stop capture'}).click();await expect(page.getByRole('button',{name:'Start transcription'})).toBeEnabled({timeout:20000});
 const finalDrain=await page.evaluate(()=>window.qa.events.filter(e=>e.source==='PC'&&e.kind==='final').length);
 if(finalDrain!==2){const diagnostic=await page.evaluate(()=>({events:window.qa.events,notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent)}));await writeFile(path.join(root,'.local/realtime-ui-diagnostic.json'),JSON.stringify(diagnostic,null,2));console.log(JSON.stringify(diagnostic,null,2));}
 assert.equal(finalDrain,2,'Stop must flush and finalize the last spoken turn');
 const stopped=await page.evaluate(()=>window.qa.sources.every(s=>s.stream.getTracks().every(t=>t.readyState==='ended')));assert(stopped);assert.equal(before.recorders,0);
 for(const label of ['PC','MIC']){const partial=before.events.find(e=>e.source===label&&e.kind==='partial');const final=before.events.find(e=>e.source===label&&e.kind==='final');assert(partial&&final);assert(partial.at<final.at);}
 const report={transport:'real AudioWorklet -> validated Electron IPC -> OS vault -> real OpenAI gpt-live-transcribe',noMediaRecorder:true,allTracksStopped:stopped,stopFlushedFinalTurn:true,results:['PC','MIC'].map(source=>({source,firstPartialMs:Math.round(before.events.find(e=>e.source===source&&e.kind==='partial').at-before.started),finalMs:Math.round(before.events.find(e=>e.source===source&&e.kind==='final').at-before.started),text:before.events.find(e=>e.source===source&&e.kind==='final').text}))};
 await writeFile(path.join(root,'.local/realtime-ui-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 await page.evaluate(async()=>{await Promise.all(window.qa.contexts.map(c=>c.close()));});
 console.log('PASS: actual desktop UI streams both sources with live partials, automatic VAD finals and no file recorder');
}finally{await app.close();}

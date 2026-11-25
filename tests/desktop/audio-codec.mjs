import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"import {ShadowAudioCapture} from './apps/web/lib/shadow-audio';globalThis.ShadowAudioCapture=ShadowAudioCapture;",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const report=await page.evaluate(async()=>{
  const context=new AudioContext();await context.resume();const oscillators=[];
  const make=frequency=>{const oscillator=context.createOscillator();oscillator.frequency.value=frequency;const destination=context.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();oscillators.push(oscillator);return destination.stream;};
  const computer=make(440),microphone=make(880),canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const video=canvas.captureStream(5);computer.addTrack(video.getVideoTracks()[0]);
  const files=[],recorderTracks=[];let resolveFirst;const first=new Promise(resolve=>resolveFirst=resolve);
  const capture=new window.ShadowAudioCapture({chunkMs:650,environment:{getDisplayMedia:async()=>computer,getUserMedia:async()=>microphone,createAudioStream:tracks=>new MediaStream(tracks),createRecorder:stream=>{recorderTracks.push(stream.getTracks().map(t=>t.kind));return new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});},createAudioContext:()=>new AudioContext(),setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window)},transcribe:async(blob,source)=>{
   const buffer=await blob.arrayBuffer(),header=Array.from(new Uint8Array(buffer.slice(0,4)));const decoded=await context.decodeAudioData(buffer);const samples=decoded.getChannelData(0);let energy=0,crossings=0;for(let i=1;i<samples.length;i++){energy+=samples[i]*samples[i];if(samples[i-1]<0&&samples[i]>=0)crossings++;}
   files.push({source,size:blob.size,header,duration:decoded.duration,rms:Math.sqrt(energy/samples.length),frequency:crossings/decoded.duration});
   if(files.some(f=>f.source==='PC')&&files.some(f=>f.source==='MIC'))resolveFirst();return source+' synthetic transcript';
  },onTranscript:()=>{},onError:error=>{throw error;}});
  await capture.start({pc:true,mic:true});await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(Error('No synthetic audio files')),12000))]);await capture.stop();
  const count=files.length;await new Promise(resolve=>setTimeout(resolve,800));const stopped=computer.getTracks().concat(microphone.getTracks()).every(track=>track.readyState==='ended');oscillators.forEach(o=>o.stop());await context.close();return {files,recorderTracks,stopped,noLateUploads:count===files.length};
 });
 assert(report.stopped&&report.noLateUploads);assert(report.files.length>=2);
 for(const file of report.files){assert.deepEqual(file.header,[26,69,223,163]);assert(file.duration>.02&&file.rms>.05);assert(Math.abs(file.frequency-(file.source==='PC'?440:880))<80);}
 assert(report.recorderTracks.every(tracks=>tracks.every(kind=>kind==='audio')));
 console.log(JSON.stringify(report,null,2));console.log('PASS: independent real WebM PC/MIC files decode, sources remain separate, Stop releases every track and permits no late uploads');
}finally{await browser.close();}

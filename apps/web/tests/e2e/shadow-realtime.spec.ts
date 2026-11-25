import {test,expect,type Page} from '@playwright/test';

async function desktopAudio(page:Page){
 await page.addInitScript(()=>{
  const listeners=new Set<(event:Record<string,unknown>)=>void>();
  const requests:{requestId:string;source:'PC'|'MIC';appends:number;firstAppendAt?:number;startAt:number;stopped:boolean}[]=[];
  const streams:MediaStream[]=[],contexts:AudioContext[]=[];
  const calls={requests,streams,permissions:0,chooserGesture:false,answers:[] as Record<string,unknown>[],cancelled:[] as string[],emit:(event:Record<string,unknown>)=>listeners.forEach(fn=>fn(event))};
  (window as unknown as {realtimeTest:typeof calls}).realtimeTest=calls;
  // Desktop realtime must use PCM worklets, never the browser file recorder.
  Object.defineProperty(window,'MediaRecorder',{value:class {constructor(){throw Error('Unexpected desktop MediaRecorder fallback');}}});
  let saved:unknown=null;
  const win={active:true,visible:true,compact:false,backgroundTransparency:.7,alwaysOnTop:true,fontSize:15,bounds:{x:0,y:0,width:930,height:790},captureProtection:{requested:true,platform:'win32',status:'requested',message:'Native capture exclusion requested'},shortcutRegistered:true};
  (window as unknown as {openInterviewDesktop:unknown}).openInterviewDesktop={
   platform:'win32',version:'0.3.0-test',storeGet:async()=>saved,storePut:async({value}:{value:unknown})=>{saved=value;},vaultStatus:async()=>({configured:['openai']}),getCapabilities:async()=>({}),getShadowState:async()=>win,
   requestMediaAccess:async()=>{calls.permissions++;return {granted:true};},onEvent:(fn:(event:Record<string,unknown>)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},
   speechStart:async(request:{requestId:string;source:'PC'|'MIC';consent:boolean})=>{if(request.consent!==true)throw Error('No consent');requests.push({...request,appends:0,startAt:performance.now(),stopped:false});return {ready:true,sampleRate:24000};},
   speechAppend:async({requestId,base64}:{requestId:string;base64:string})=>{const request=requests.find(r=>r.requestId===requestId)!;if(!request)throw Error('Wrong request');if(atob(base64).length%2)throw Error('PCM must be aligned');request.appends++;if(!request.firstAppendAt){request.firstAppendAt=performance.now();calls.emit({type:'speech-event',requestId,source:request.source,kind:'partial',itemId:'live-'+request.source,text:request.source==='PC'?'How would you design':'My microphone draft'});}return {accepted:true};},
   speechCommit:async()=>({accepted:true}),
   speechStop:async({requestId}:{requestId:string})=>{const request=requests.find(r=>r.requestId===requestId)!;request.stopped=true;await new Promise(r=>setTimeout(r,35));calls.emit({type:'speech-event',requestId,source:request.source,kind:'final',itemId:'tail-'+request.source,text:'Final '+request.source+' words on stop.'});return {stopped:true};},
   speechCancel:async({requestId}:{requestId:string})=>{calls.cancelled.push(requestId);return {cancelled:true};},
   providerRequest:async(request:Record<string,unknown>)=>{calls.answers.push(request);return {text:'A durable queue persists work before acknowledging.'};},cancelRequest:async()=>({}),
   transcribeAudio:async()=>{throw Error('Unexpected file transcription fallback');},
  };
  function audio(source:'PC'|'MIC'){
   const context=new AudioContext(),osc=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();contexts.push(context);gain.gain.value=.08;osc.frequency.value=source==='PC'?440:660;osc.connect(gain);gain.connect(destination);osc.start();void context.resume();
   const stream=destination.stream;if(source==='PC'){const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d')!.fillRect(0,0,32,32);stream.addTrack(canvas.captureStream(1).getVideoTracks()[0]);}streams.push(stream);return stream;
  }
  Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{calls.chooserGesture=navigator.userActivation.isActive;return audio('PC');}});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>audio('MIC')});
 });
 await page.goto('/workspace/?desktopShadow=1#shadow');
 await expect(page.getByLabel('Transcription transport')).toContainText('Desktop realtime audio');
}

test('desktop streams PC/MIC partials before stop and correlates finals without partial auto-answers',async({page})=>{
 await desktopAudio(page);await page.getByLabel('Microphone',{exact:true}).check();await page.getByLabel(/I have permission to record this conversation/).check();await page.getByLabel('Send questions, conversation and selected profile/document/session context directly to my AI provider.').check();await page.getByLabel('Auto answer',{exact:true}).check();
 await page.getByRole('button',{name:'Start transcription'}).click();
 await expect(page.getByLabel('PC live transcript')).toContainText('How would you design');await expect(page.getByLabel('MIC live transcript')).toContainText('My microphone draft');
 expect(await page.evaluate(()=>{const t=(window as any).realtimeTest;return {answers:t.answers.length,gesture:t.chooserGesture,permissions:t.permissions,frames:t.requests.every((r:any)=>r.appends>0&&r.firstAppendAt-r.startAt<4000)};})).toEqual({answers:0,gesture:true,permissions:1,frames:true});
 await page.evaluate(()=>{const t=(window as any).realtimeTest,pc=t.requests.find((r:any)=>r.source==='PC'),mic=t.requests.find((r:any)=>r.source==='MIC');t.emit({type:'speech-event',requestId:'stale-request',source:'PC',kind:'partial',itemId:'stale',text:'Ignored stale text'});t.emit({type:'speech-event',requestId:pc.requestId,source:'MIC',kind:'partial',itemId:'wrong',text:'Ignored wrong source'});t.emit({type:'speech-event',requestId:pc.requestId,source:'PC',kind:'partial',itemId:'live-PC',text:'How would you design a queue?'});t.emit({type:'speech-event',requestId:mic.requestId,source:'MIC',kind:'final',itemId:'live-MIC',text:'Why should the microphone stay separate?'});t.emit({type:'speech-event',requestId:pc.requestId,source:'PC',kind:'final',itemId:'live-PC',text:'How would you design a queue?'});t.emit({type:'speech-event',requestId:pc.requestId,source:'PC',kind:'final',itemId:'live-PC',text:'How would you design a queue?'});});
 await expect(page.getByLabel('Scrollable answer')).toContainText('A durable queue persists');expect(await page.evaluate(()=>(window as any).realtimeTest.answers.length)).toBe(1);
 await page.getByRole('button',{name:'Stop capture'}).click();await expect(page.getByText('Microphone off · no capture',{exact:true})).toBeVisible();await page.getByRole('tab',{name:/Transcript/}).click();
 await expect(page.locator('.transcript-segment')).toHaveCount(4);await expect(page.locator('.shadow-transcript-scroll')).toContainText('Final PC words on stop.');await expect(page.locator('.shadow-transcript-scroll')).toContainText('Final MIC words on stop.');await expect(page.locator('.shadow-transcript-scroll')).not.toContainText('Ignored');
 await page.evaluate(()=>{const t=(window as any).realtimeTest,pc=t.requests[0];t.emit({type:'speech-event',requestId:pc.requestId,source:'PC',kind:'final',itemId:'late',text:'Late words must not persist'});});await expect(page.locator('.transcript-segment')).toHaveCount(4);expect(await page.evaluate(()=>(window as any).realtimeTest.streams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});

test('desktop PC-only realtime never requests microphone and restarts with fresh event ownership',async({page})=>{
 await desktopAudio(page);await page.getByLabel(/I have permission to record this conversation/).check();await page.getByRole('button',{name:'Start transcription'}).click();await expect(page.getByLabel('PC live transcript')).toContainText('How would you design');await page.getByRole('button',{name:'Stop capture'}).click();await expect(page.getByText('Microphone off · no capture',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Start transcription'}).click();await expect(page.getByLabel('PC live transcript')).toContainText('How would you design');expect(await page.evaluate(()=>{const t=(window as any).realtimeTest;return {permissions:t.permissions,sources:t.requests.map((r:any)=>r.source),fresh:t.requests[0].requestId!==t.requests[1].requestId};})).toEqual({permissions:0,sources:['PC','PC'],fresh:true});await page.getByRole('button',{name:'Stop capture'}).click();await expect(page.getByText('Microphone off · no capture',{exact:true})).toBeVisible();
});

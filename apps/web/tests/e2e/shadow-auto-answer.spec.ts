import {test,expect,type Page} from '@playwright/test';

const answerConsent='Send questions, conversation and selected profile/document/session context directly to my AI provider.';
const firstAnswer='In my synthetic Phoenix project I used PostgreSQL transactions and idempotency tokens to persist jobs before acknowledging them.';

// Synthetic bridge only: real browser AudioWorklet PCM frames, no OS capture or provider network.
async function desktop(page:Page){
 await page.addInitScript(()=>{
  const listeners=new Set<(event:Record<string,unknown>)=>void>();
  const requests:{requestId:string;source:'PC'|'MIC';appends:number;stopped:boolean}[]=[];
  const pending=new Map<string,{resolve:(value:{text:string})=>void;reject:(reason:unknown)=>void}>();
  const calls={requests,answers:[] as Record<string,unknown>[],cancelled:[] as string[],streams:[] as MediaStream[],permissions:0,choosers:0,microphones:0,gesture:false,
   emit:(event:Record<string,unknown>)=>listeners.forEach(fn=>fn(event)),
   chunk:(index:number,text:string)=>calls.emit({type:'provider-chunk',requestId:calls.answers[index].requestId,text}),
   finish:(index:number,text:string)=>pending.get(String(calls.answers[index].requestId))?.resolve({text}),
   transcript:(source:'PC'|'MIC',text:string,itemId:string,kind='final')=>{const request=requests.filter(r=>r.source===source&&!r.stopped).at(-1);if(!request)throw Error('No active synthetic source');calls.emit({type:'speech-event',requestId:request.requestId,source,kind,itemId,text});},
  };
  (window as any).autoTest=calls;
  Object.defineProperty(window,'MediaRecorder',{value:class {constructor(){throw Error('Desktop must use real PCM worklets');}}});
  const win={active:true,visible:true,compact:false,backgroundTransparency:.7,alwaysOnTop:true,fontSize:15,bounds:{x:0,y:0,width:930,height:790},captureProtection:{requested:true,platform:'win32',status:'requested',message:'Synthetic native capture protection'},shortcutRegistered:true};
  (window as any).openInterviewDesktop={platform:'win32',version:'0.3.0-synthetic',
   storeGet:async()=>JSON.parse(sessionStorage.getItem('synthetic-workspace')||'null'),storePut:async({value}:{value:unknown})=>sessionStorage.setItem('synthetic-workspace',JSON.stringify(value)),
   vaultStatus:async()=>({configured:['openai']}),getCapabilities:async()=>({}),getShadowState:async()=>win,
   onEvent:(fn:(event:Record<string,unknown>)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},
   requestMediaAccess:async()=>{calls.permissions++;return {granted:true};},
   speechStart:async(request:{requestId:string;source:'PC'|'MIC';consent:boolean})=>{if(request.consent!==true)throw Error('Recording consent missing');requests.push({...request,appends:0,stopped:false});return {ready:true,sampleRate:24000};},
   speechAppend:async({requestId,base64}:{requestId:string;base64:string})=>{const request=requests.find(r=>r.requestId===requestId);if(!request||atob(base64).length%2)throw Error('Invalid PCM frame');request.appends++;return {accepted:true};},
   speechCommit:async()=>({accepted:true}),speechStop:async({requestId}:{requestId:string})=>{requests.find(r=>r.requestId===requestId)!.stopped=true;return {stopped:true};},speechCancel:async({requestId}:{requestId:string})=>{const request=requests.find(r=>r.requestId===requestId);if(request)request.stopped=true;return {cancelled:true};},
   providerRequest:(request:Record<string,unknown>)=>{calls.answers.push(request);return new Promise<{text:string}>((resolve,reject)=>pending.set(String(request.requestId),{resolve,reject}));},
   cancelRequest:async({requestId}:{requestId:string})=>{calls.cancelled.push(requestId);pending.get(requestId)?.reject(new DOMException('Cancelled','AbortError'));return {cancelled:true};},
   transcribeAudio:async()=>{throw Error('Unexpected file transcription');},
  };
  function audio(source:'PC'|'MIC'){
   const context=new AudioContext(),osc=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();gain.gain.value=.08;osc.frequency.value=source==='PC'?440:660;osc.connect(gain);gain.connect(destination);osc.start();void context.resume();
   const stream=destination.stream;if(source==='PC'){const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d')!.fillRect(0,0,32,32);stream.addTrack(canvas.captureStream(1).getVideoTracks()[0]);}calls.streams.push(stream);return stream;
  }
  Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{calls.choosers++;calls.gesture=navigator.userActivation.isActive;return audio('PC');}});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{calls.microphones++;return audio('MIC');}});
 });
 await page.goto('/workspace/?desktopShadow=1#shadow');
 await expect(page.getByLabel('Transcription transport')).toContainText('Desktop realtime audio');
 await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('synthetic-workspace')!==null)).toBe(true);
 await page.evaluate(()=>{
  const state=JSON.parse(sessionStorage.getItem('synthetic-workspace')!);const date=new Date().toISOString();
  state.profile={...state.profile,name:'Synthetic Candidate',role:'Backend Engineer',resumeText:'Synthetic Phoenix project: built a PostgreSQL durable job queue using idempotency tokens.',projects:['Phoenix: transactionally persist queue jobs before acknowledging.']};
  state.documents=[{id:'synthetic-project',name:'Phoenix project facts',type:'text/plain',text:'Phoenix project facts: PostgreSQL transactions, idempotency tokens and worker retries. No measured scale or employment claims supplied.',createdAt:date,updatedAt:date}];
  state.sessions=[{id:'synthetic-previous',title:'Phoenix previous practice',mode:'Shadow Mode',category:'Conversation',company:'Any company',role:'Backend Engineer',difficulty:'Intermediate',status:'completed',createdAt:date,updatedAt:date,notes:'Phoenix queue tradeoff practice.',archived:false,questionIds:[],duration:0,turns:[{id:'previous-question',speaker:'user',source:'PC',text:'What tradeoff did you choose for Phoenix?',createdAt:date},{id:'previous-response',speaker:'assistant',source:'PC',text:'Previous Phoenix suggestion: favor durable writes over immediate acknowledgement.',createdAt:date}]}];
  sessionStorage.setItem('synthetic-workspace',JSON.stringify(state));
 });
 await page.reload();await expect(page.getByRole('heading',{name:'A little clarity, live.'})).toBeVisible();
}
async function start(page:Page,mic=false){
 if(mic)await page.getByLabel('Microphone',{exact:true}).check();
 await page.getByLabel(/I have permission to record this conversation/).check();await page.getByLabel(answerConsent).check();
 await page.getByRole('button',{name:'Start transcription'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).autoTest.requests.every((r:any)=>r.appends>0)&&(window as any).autoTest.requests.length>0)).toBe(true);
}
async function transcript(page:Page,text:string,itemId:string,source:'PC'|'MIC'='PC',kind='final'){
 await page.evaluate(({text,itemId,source,kind})=>(window as any).autoTest.transcript(source,text,itemId,kind),{text,itemId,source,kind});
}
const answerCount=(page:Page)=>page.evaluate(()=>(window as any).autoTest.answers.length as number);
const finish=(page:Page,index:number,text:string)=>page.evaluate(({index,text})=>(window as any).autoTest.finish(index,text),{index,text});

test('PC questions stream immediately, queue short follow-ups, and keep grounded response memory after restart',async({page})=>{
 await desktop(page);await expect(page.getByLabel('Auto answer',{exact:true})).toBeChecked();
 expect(await page.evaluate(()=>{const t=(window as any).autoTest;return [t.requests.length,t.choosers,t.microphones,t.permissions,t.answers.length];})).toEqual([0,0,0,0,0]);
 await start(page,true);
 await transcript(page,'How did my Phoenix project make queue retries durable?','q1','PC','partial');
 await transcript(page,'The interviewer is reviewing the Phoenix project.','statement');
 await transcript(page,'How should I introduce myself?','mic-ignored','MIC');
 await expect(page.locator('.transcript-segment')).toHaveCount(2);expect(await answerCount(page)).toBe(0);
 await transcript(page,'How did my Phoenix project make queue retries durable?','q1');
 await expect.poll(()=>answerCount(page),{timeout:3000}).toBe(1);
 const first=await page.evaluate(()=>JSON.stringify((window as any).autoTest.answers[0]));
 expect(first).toContain('PostgreSQL');expect(first).toContain('idempotency tokens');expect(first).toContain('Phoenix project facts');expect(first).toContain('Previous Phoenix suggestion');expect(first).toMatch(/Never invent[^.]*qualifications|Do not invent qualifications/i);expect(first).toMatch(/AI suggestion|unverified AI|unverified suggestion/i);
 await page.evaluate(()=>(window as any).autoTest.chunk(0,'In my synthetic Phoenix project'));
 await expect(page.getByLabel('Scrollable answer')).toContainText('In my synthetic Phoenix project',{timeout:1000});
 await transcript(page,'Why?','q2');await transcript(page,'Why?','q2');
 await expect(page.getByText(/1 question queued/)).toBeVisible();expect(await answerCount(page)).toBe(1);
 await finish(page,0,firstAnswer);await expect.poll(()=>answerCount(page),{timeout:3000}).toBe(2);
 const followup=await page.evaluate(()=>JSON.stringify((window as any).autoTest.answers[1]));
 expect(followup).toContain(firstAnswer);expect(followup).toContain('Why?');expect(followup).toContain('PostgreSQL');expect(followup).toContain('idempotency tokens');
 await finish(page,1,'Because committing durable work before acknowledgement prevents a lost job during a crash.');
 await expect(page.getByLabel('Answer history').locator('option')).toHaveCount(2);
 await page.getByRole('button',{name:'Stop capture'}).click();await expect(page.getByText('Microphone off · no capture',{exact:true})).toBeVisible();
 expect(await answerCount(page)).toBe(2);expect(await page.evaluate(()=>(window as any).autoTest.streams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
 await page.getByRole('button',{name:'Finish session'}).click();await page.getByLabel('Auto answer',{exact:true}).uncheck();
 await page.getByRole('button',{name:'Your context',exact:true}).click();await page.getByLabel('Use resume and document sources').uncheck();await page.getByLabel('Remember previous sessions').uncheck();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('synthetic-workspace')!).shadowSettings)).toEqual({autoAnswer:false,useContext:false,remember:false});
 await page.reload();await expect(page.getByLabel('Auto answer',{exact:true})).not.toBeChecked();await expect(page.getByLabel(/I have permission to record this conversation/)).not.toBeChecked();await expect(page.getByLabel(answerConsent)).not.toBeChecked();
 expect(await page.evaluate(()=>(window as any).autoTest.requests.length)).toBe(0);
 await page.getByRole('button',{name:'Your context',exact:true}).click();await expect(page.getByLabel('Use resume and document sources')).not.toBeChecked();await expect(page.getByLabel('Remember previous sessions')).not.toBeChecked();await page.getByLabel('Use resume and document sources').check();await page.getByLabel('Remember previous sessions').check();
 await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:/Conversation notes/}).click();await expect(page.getByLabel('Answer history').locator('option')).toHaveCount(2);
 await page.getByRole('button',{name:'+ New session',exact:true}).click();await page.getByLabel(answerConsent).check();await page.getByLabel('Ask a question').fill('What was my previous Phoenix queue recommendation?');await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>answerCount(page)).toBe(1);
 const restarted=await page.evaluate(()=>JSON.stringify((window as any).autoTest.answers[0]));expect(restarted).toContain(firstAnswer);expect(restarted).toContain('Because committing durable work');expect(restarted).toContain('Phoenix project facts');expect(restarted).toMatch(/AI suggestion|unverified AI|unverified suggestion/i);
 await finish(page,0,'Your saved Phoenix response favored durable jobs before acknowledgement.');await expect(page.getByLabel('Scrollable answer')).toContainText('Your saved Phoenix response');
});

test('turning auto off, stopping an answer or capture, and changing session discard queued work',async({page})=>{
 await desktop(page);await start(page);
 for(const action of ['off','answer','capture','session'] as const){
  const before=await answerCount(page);
  await transcript(page,`How should Phoenix handle the ${action} scenario?`,action+'-first');await expect.poll(()=>answerCount(page)).toBe(before+1);
  await transcript(page,'What is the next tradeoff?',action+'-queued');await expect(page.getByText(/1 question queued/)).toBeVisible();
  if(action==='off'){await page.getByLabel('Auto answer',{exact:true}).uncheck();await finish(page,before,`Completed ${action} response.`);await page.getByRole('button',{name:'Stop answer'}).waitFor({state:'visible'});await expect(page.getByRole('button',{name:'Stop answer'})).toBeDisabled();await page.getByLabel('Auto answer',{exact:true}).check();}
  if(action==='answer'){await page.getByRole('button',{name:'Stop answer'}).click();await expect(page.getByText('Answer stopped.',{exact:true})).toBeVisible();}
  if(action==='capture'){await page.getByRole('button',{name:'Stop capture'}).click();await expect(page.getByText('Microphone off · no capture',{exact:true})).toBeVisible();await finish(page,before,`Completed ${action} response.`);await expect(page.getByRole('button',{name:'Stop answer'})).toBeDisabled();await start(page);}
  if(action==='session'){await page.getByRole('button',{name:'+ New session',exact:true}).click();await expect(page.getByText('Microphone off · no capture',{exact:true})).toBeVisible();await page.evaluate(({index})=>{const t=(window as any).autoTest;t.chunk(index,'STALE ANSWER MUST NOT APPEAR');t.finish(index,'STALE ANSWER MUST NOT APPEAR');},{index:before});await expect(page.getByLabel('Scrollable answer')).not.toContainText('STALE ANSWER');}
  await expect(page.getByText(/\d+ questions? queued/)).toHaveCount(0);expect(await answerCount(page)).toBe(before+1);
 }
 expect(await page.evaluate(()=>(window as any).autoTest.cancelled.length)).toBeGreaterThanOrEqual(2);
});

test('MIC finals require opt-in and duplicate finals never create duplicate answers',async({page})=>{
 await desktop(page);await start(page,true);await transcript(page,'How can I explain Phoenix retries?','mic-before','MIC');await expect(page.locator('.transcript-segment')).toHaveCount(1);expect(await answerCount(page)).toBe(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Also auto-answer microphone questions').check();await page.getByRole('button',{name:'Live assistant',exact:true}).click();
 await transcript(page,'Why use idempotency tokens in Phoenix?','mic-after','MIC');await transcript(page,'Why use idempotency tokens in Phoenix?','mic-after','MIC');await expect.poll(()=>answerCount(page)).toBe(1);await finish(page,0,'Idempotency tokens prevent duplicate work when a job is retried.');await expect(page.getByLabel('Scrollable answer')).toContainText('Idempotency tokens prevent');
 await transcript(page,'Why use idempotency tokens in Phoenix?','mic-genuine-repeat','MIC');await expect.poll(()=>answerCount(page)).toBe(2);await finish(page,1,'The repeated question still deserves an answer: retries can redeliver the same job.');await expect(page.getByLabel('Scrollable answer')).toContainText('The repeated question still deserves an answer');
 await page.getByRole('button',{name:'Stop capture'}).click();await expect(page.getByText('Microphone off · no capture',{exact:true})).toBeVisible();expect(await answerCount(page)).toBe(2);
});

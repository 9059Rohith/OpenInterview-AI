import {_electron as electron} from '@playwright/test';
import {build} from 'esbuild';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=process.cwd(),profile=await mkdtemp(path.join(os.tmpdir(),'oi-shadow-integration-'));
const core=await build({entryPoints:['apps/web/lib/core.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {initialState}=await import('data:text/javascript;base64,'+Buffer.from(core.outputFiles[0].text).toString('base64'));
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'apps/desktop'),'--shadow-fixture'],env:{...process.env,OPENINTERVIEW_TEST_PROFILE:profile},timeout:45000});
try{
 await app.waitForEvent('window',{predicate:p=>p.url().includes('desktopShadow=1'),timeout:30000}).catch(()=>{});
 const shadow=app.windows().find(p=>p.url().includes('desktopShadow=1'));assert(shadow);await shadow.waitForLoadState();await shadow.getByRole('textbox',{name:'Ask a question',exact:true}).waitFor();
 await shadow.evaluate(async initial=>window.openInterviewDesktop.storePut({key:'workspace',value:{...initial,provider:{provider:'ollama',model:'qwen2.5:0.5b',baseUrl:'http://127.0.0.1:11434',configured:true},profile:{...initial.profile,name:'Synthetic QA Candidate',resumeText:'Built a synthetic queue project using Redis, with retries and idempotency.'}}}),initialState);
 await shadow.reload();await shadow.getByRole('textbox',{name:'Ask a question',exact:true}).waitFor();
 assert.equal(await shadow.evaluate(async()=>(await window.openInterviewDesktop.storeGet({key:'workspace'})).provider.provider),'ollama','Synthetic provider seed survived hydration');
 await shadow.getByRole('textbox',{name:'Ask a question',exact:true}).fill('Explain idempotency in two short sentences.');await shadow.getByRole('button',{name:'Send',exact:true}).click();
 await shadow.getByRole('button',{name:'Stop answer',exact:true}).waitFor({state:'visible'});
 await shadow.waitForFunction(()=>document.querySelector('.shadow-answer-text')?.textContent?.length>180,undefined,{timeout:45000});
 await shadow.getByRole('button',{name:'Stop answer',exact:true}).click();await shadow.getByRole('button',{name:'Stop answer',exact:true}).waitFor({state:'visible'});
 await shadow.waitForFunction(()=>document.querySelector('.shadow-answer-tools button:last-child')?.disabled);
 const text=await shadow.getByLabel('Scrollable answer',{exact:true}).innerText();assert(text.length>50,'Real local model streamed answer');
 await shadow.getByRole('tab',{name:/Transcript/}).click();await shadow.getByRole('textbox',{name:'Conversation notes',exact:true}).fill('Synthetic notes immediately before native close.');
 // Native close must wait for renderer finish + latest encrypted workspace flush.
 const lightBeforeClose=app.windows().find(p=>!p.url().includes('desktopShadow=1'));assert(lightBeforeClose);const lightReloaded=lightBeforeClose.waitForEvent('domcontentloaded',{timeout:15000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('desktopShadow=1')).close());
 await shadow.waitForEvent('close',{timeout:15000});
 await lightReloaded;const main=app.windows().find(p=>p.url().startsWith('oi://app/workspace/')&&!p.url().includes('desktopShadow'));assert(main);await main.getByRole('heading',{name:'Make your next interview your best one.'}).waitFor();
 const saved=await main.evaluate(()=>window.openInterviewDesktop.storeGet({key:'workspace'}));const conversation=saved.sessions.find(s=>s.mode==='Shadow Mode');assert(conversation);assert.equal(conversation.notes,'Synthetic notes immediately before native close.');assert.equal(conversation.status,'completed');assert(conversation.turns.some(t=>t.speaker==='assistant'&&t.text.length>50));
 await main.evaluate(()=>{window.location.hash='shadow';});
 const reopened=await app.waitForEvent('window',{predicate:p=>p.url().includes('desktopShadow=1'),timeout:15000}).catch(()=>app.windows().find(p=>p.url().includes('desktopShadow=1')));assert(reopened);await reopened.waitForLoadState();
 await reopened.getByRole('textbox',{name:'Ask a question',exact:true}).waitFor();
 if((await reopened.evaluate(()=>window.openInterviewDesktop.getShadowState())).compact)await reopened.getByRole('button',{name:'Expand overlay'}).click();
 await reopened.getByRole('button',{name:'History',exact:true}).click();await reopened.getByRole('button',{name:/Conversation notes/}).click();await reopened.getByRole('tab',{name:/Transcript/}).click();await reopened.getByRole('textbox',{name:'Conversation notes',exact:true}).fill('Synthetic notes immediately before Quit.');
 const closed=app.waitForEvent('close',{timeout:15000});await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await closed;
 console.log(JSON.stringify({realOllamaStream:true,answerCharacters:text.length,nativeCloseSavedLatest:true,lightReloaded:true,shadowReopenedFromLight:true,quitHandshakeCompleted:true,profile},null,2));
}finally{await app.close().catch(()=>{});}

import {build} from 'esbuild';
import {mkdtemp,copyFile,readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

// Only synthetic Windows TTS WAV fixtures are sent. The renderer never receives
// a credential. Copy OS-encrypted vault material into an isolated test profile.
const root=process.cwd(),profile=await mkdtemp(path.join(os.tmpdir(),'oi-realtime-live-'));
const real=path.join(process.env.APPDATA,'OpenInterview AI');
for(const name of ['Local State','credentials.enc.json'])await copyFile(path.join(real,name),path.join(profile,name));
const helper=path.join(profile,'probe.cjs');
await build({stdin:{resolveDir:root,loader:'ts',contents:`
import {app,safeStorage} from 'electron';
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {Vault} from './apps/desktop/src/vault';
import {RealtimeSpeechSession,REALTIME_TRANSCRIPTION_MODEL} from './apps/desktop/src/realtime-speech';
app.setName('OpenInterview AI');app.setPath('userData',process.argv[2]);
app.whenReady().then(async()=>{
 const vault=new Vault(app.getPath('userData'),safeStorage),key=vault.get('openai');
 const reports=[];
 for(const source of ['pc','mic']){
  const wav=readFileSync(process.argv[3]+'/.local/realtime-'+source+'.wav');
  let offset=12,pcm;while(offset+8<wav.length){const name=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4);if(name==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
  if(!pcm)throw Error('Synthetic PCM fixture missing');
  const events=[];let began=0,committed=0,firstPartial=0,finalAt=0;let text='';
  const session=new RealtimeSpeechSession({key,onEvent:e=>{if(e.kind==='partial'&&e.text&&!firstPartial)firstPartial=performance.now();if(e.kind==='final'){text=e.text||'';finalAt=performance.now();}if(e.kind==='error')events.push(e.message);}});
  const connectionAt=performance.now();await session.start();began=performance.now();
  for(let i=0;i<pcm.length;i+=960){await session.append(pcm.subarray(i,i+960).toString('base64'));await new Promise(r=>setTimeout(r,20));}
  await session.append(Buffer.alloc(9600).toString('base64'));committed=performance.now();await session.commit();await session.stop();
  reports.push({source,model:REALTIME_TRANSCRIPTION_MODEL,readyMs:Math.round(began-connectionAt),speechMs:Math.round(pcm.length/48),firstPartialMs:firstPartial?Math.round(firstPartial-began):null,partialBeforeCommit:!!firstPartial&&firstPartial<committed,finalMs:finalAt?Math.round(finalAt-began):null,text,errors:events});
 }
 writeFileSync(process.argv[3]+'/.local/realtime-live-result.json',JSON.stringify(reports,null,2));console.log('REALTIME_PROBE '+JSON.stringify(reports));app.exit(reports.every(r=>r.text&&r.partialBeforeCommit&&!r.errors.length)?0:1);
}).catch(()=>{console.error('Realtime synthetic probe failed; inspect sanitized provider status.');app.exit(1);});
`},bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:helper});
await mkdir(path.join(root,'.local'),{recursive:true});
const processResult=await new Promise((resolve,reject)=>{
 const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[helper,profile,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',()=>{});child.on('error',reject);const deadline=setTimeout(()=>child.kill(),90000);child.on('close',code=>{clearTimeout(deadline);resolve({code,output});});
});
console.log(processResult.output);assert.equal(processResult.code,0,'Both realtime sessions must produce pre-commit deltas and final transcripts');
const results=JSON.parse(await readFile(path.join(root,'.local/realtime-live-result.json'),'utf8'));
assert.match(results[0].text,/idempotent/i);assert.match(results[1].text,/queue|retries/i);
console.log('PASS: real OpenAI live PCM transcription emits text before commit for both synthetic source fixtures');

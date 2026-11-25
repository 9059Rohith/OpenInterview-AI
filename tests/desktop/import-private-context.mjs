import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

// Run with the desktop closed. Payload and plaintext source files stay private;
// only counts are logged. The generic importer contains no candidate data.
const root=process.cwd(),payload=path.resolve(process.argv[2]??'.local/private-context-import.json');
const temporary=await mkdtemp(path.join(os.tmpdir(),'oi-context-import-')),helper=path.join(temporary,'import.cjs');
await build({stdin:{resolveDir:root,loader:'ts',contents:`
import {app,safeStorage} from 'electron';import {readFileSync} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {Vault} from './apps/desktop/src/vault';import {LocalStore} from './apps/desktop/src/store';import {initialState,parseResume} from './apps/web/lib/core';import {readWorkspace} from './apps/web/lib/validation';
app.setName('OpenInterview AI');app.setPath('userData',path.join(app.getPath('appData'),'OpenInterview AI'));
app.whenReady().then(()=>{
 const vault=new Vault(app.getPath('userData'),safeStorage),store=new LocalStore(path.join(app.getPath('userData'),'workspace.sqlite3'),vault),data=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const previous=store.get('workspace'),workspace=previous?readWorkspace(previous):structuredClone(initialState);if(previous)store.put('private.backup.before-context.'+Date.now(),previous);
 const scrub=(text:string)=>text.replace(/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}/g,'[credential omitted]');
 const docs=data.documents.map((d:any)=>({...d,text:scrub(d.text)}));const chunk=200;
 for(let index=0;index<docs.length;index+=chunk)store.put('private.knowledge.'+Math.floor(index/chunk),docs.slice(index,index+chunk));
 store.put('private.knowledge.index',{shards:Math.ceil(docs.length/chunk),totalSources:docs.length,projects:data.projects,importedAt:new Date().toISOString()});
 const timestamp=new Date().toISOString(),hash=(text:string)=>createHash('sha256').update(text).digest('hex').slice(0,20);
 const resume=scrub(data.resume);workspace.profile={...workspace.profile,...parseResume(resume),name:resume.split(/\\r?\\n/).find((line:string)=>line.trim())?.trim()||workspace.profile.name,role:data.role||workspace.profile.role,onboarded:true};
 const reviewed=[{name:'Current candidate resume source',text:resume,kind:'resume'},...data.reviewed];
 const documents=reviewed.map((doc:any)=>({id:'private-import-'+hash(doc.name),name:doc.name,type:doc.kind==='resume'?'Resume':doc.kind==='fact'?'Project fact':'Project analysis',text:scrub(doc.text),createdAt:timestamp,updatedAt:timestamp}));
 const importedIds=new Set(documents.map((d:any)=>d.id));workspace.documents=[...documents,...workspace.documents.filter(d=>!importedIds.has(d.id))];
 const savedIds=new Set(workspace.sessions.map(s=>s.id));const sessions=(data.history||[]).filter((s:any)=>!savedIds.has(s.id));workspace.sessions=[...workspace.sessions,...sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 workspace.shadowSettings={autoAnswer:true,useContext:true,remember:true};
 if((vault.status().configured as string[]).includes('openai'))workspace.provider={provider:'openai',model:'gpt-4.1-mini',baseUrl:'',configured:true};
 readWorkspace(workspace);store.put('workspace',workspace);store.close();
 console.log(JSON.stringify({imported:true,resumeCharacters:resume.length,projectSources:docs.length,projectCount:data.projects.length,reviewedDocuments:documents.length,importedSessions:sessions.length,workspaceBytes:JSON.stringify(workspace).length,provider:workspace.provider.provider}));app.exit(0);
}).catch(()=>{console.error('Private import failed; no private contents were logged. An encrypted workspace backup is retained.');app.exit(1);});
`},bundle:true,platform:'node',format:'cjs',external:['electron','node:sqlite'],outfile:helper});
const result=await new Promise((resolve,reject)=>{const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[helper,payload],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',code=>resolve({code,output}));});
console.log(result.output);assert.equal(result.code,0,'Private context import must complete');

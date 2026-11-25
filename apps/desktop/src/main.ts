import { app,BrowserWindow,protocol,net,session,ipcMain,dialog,desktopCapturer,safeStorage,Menu,shell } from 'electron';
import { existsSync,readFileSync,readdirSync,statSync,mkdirSync,promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { Vault } from './vault.js';
import { detectOllamaInstall } from './runtime.js';
import { audioInput,transcribeAudio } from './speech.js';
import { RealtimeSpeechSession } from './realtime-speech.js';
import { visionInput,visionRequest } from './vision.js';
import { LocalStore } from './store.js';
import { ShadowWindow } from './shadow-window.js';
import { assetPath,trustedNavigation,externalLink,inlineScriptHashes,object,string,provider,model,requestId,MAX_FILE,safeName } from './security.js';
import { generate,generateStreaming,listProviderModels,ollamaStatus,ollamaJson,ollamaPull,ORIGINS } from './providers.js';

protocol.registerSchemesAsPrivileged([{scheme:'oi',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.setName('OpenInterview AI');
// Own data directory; existing applications and data are never inspected.
app.setPath('userData',path.join(app.getPath('appData'),'OpenInterview AI'));
const development=process.argv.includes('--dev')&&!app.isPackaged;
const smokeLocalAi=process.argv.includes('--smoke-local-ai');
const smokeCloudAi=process.argv.includes('--smoke-cloud-ai');
const smokeVision=process.argv.includes('--smoke-vision');
const smokeShadow=process.argv.includes('--smoke-shadow');
const shadowFixture=process.argv.includes('--shadow-fixture')&&!app.isPackaged;
const smoke=process.argv.includes('--smoke-test')||smokeLocalAi||smokeCloudAi||smokeVision||smokeShadow;
if((smoke||shadowFixture)&&!app.isPackaged&&process.env.OPENINTERVIEW_TEST_PROFILE)app.setPath('userData',path.resolve(process.env.OPENINTERVIEW_TEST_PROFILE));
const live=process.env.OPENINTERVIEW_DESKTOP_URL;
if(live){const url=new URL(live);if(url.protocol!=='https:'||url.username||url.password)throw new Error('OPENINTERVIEW_DESKTOP_URL must use HTTPS without credentials');}
const home=development?'http://localhost:3000/workspace/':live??'oi://app/workspace/';
const webRoot=app.isPackaged?path.join(process.resourcesPath,'web'):path.resolve(__dirname,'../../web/out');
const requests=new Map<string,{controller:AbortController;owner:BrowserWindow}>();
const speechSessions=new Map<string,{session:RealtimeSpeechSession;owner:BrowserWindow;source:'PC'|'MIC'}>();
let mainWindow:BrowserWindow,vault:Vault,store:LocalStore,shadow:ShadowWindow;
const mediaUntil=new Map<BrowserWindow,number>();
function legitimate(window:BrowserWindow|null|undefined){return !!window&&!window.isDestroyed()&&(window===mainWindow||window===shadow?.window);}
function cancelOwned(window:BrowserWindow){for(const active of requests.values())if(active.owner===window)active.controller.abort();for(const [id,active]of speechSessions)if(active.owner===window){active.session.cancel();speechSessions.delete(id);}mediaUntil.delete(window);}
let importBusy=false,exportBusy=false;
let externalBusy=false;
async function openKnownExternal(candidate:string,owner:BrowserWindow=mainWindow){const url=externalLink(candidate);if(externalBusy)return;externalBusy=true;try{if(!url){await dialog.showMessageBox(owner,{type:'info',message:'This external destination is not permitted in the desktop app.',detail:'Open trusted external links manually in your browser. No page was opened.'});return;}const result=await dialog.showMessageBox(owner,{type:'question',buttons:['Cancel','Open browser'],defaultId:0,cancelId:0,message:'Open this link in your browser?',detail:url});if(result.response===1)await shell.openExternal(url);}finally{externalBusy=false;}}

function scriptHashes(directory:string):string[]{if(!existsSync(directory))return [];const hashes=new Set<string>();const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.html')){for(const hash of inlineScriptHashes(readFileSync(file,'utf8')))hashes.add(hash);}}};walk(directory);return [...hashes];}
const connect=["'self'",'http://127.0.0.1:8000','http://localhost:8000'];
if(process.env.OPENINTERVIEW_API_URL){const api=new URL(process.env.OPENINTERVIEW_API_URL);if(api.protocol==='https:')connect.push(api.origin);}
function csp(){return "default-src 'self'; script-src 'self' "+(development?"'unsafe-eval' 'unsafe-inline'":scriptHashes(webRoot).join(' '))+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src "+connect.join(' ')+(development?' ws://localhost:3000':'')+"; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";}
function isRunner(candidate:string){try{return new URL(candidate).pathname==='/runner.html';}catch{return false;}}
function runnerCsp(){const file=path.join(webRoot,'runner.html');const hashes=existsSync(file)?inlineScriptHashes(readFileSync(file,'utf8')):[];const parent=new URL(home);return "default-src 'none'; script-src 'unsafe-eval' blob: "+hashes.join(' ')+"; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors "+parent.protocol+'//'+parent.host+"; sandbox allow-scripts";}
function safeError(error:unknown){if(error instanceof Error){if(error.name==='AbortError'||error.name==='TimeoutError')return 'Request cancelled or timed out';if(/fetch|ECONN|ENOTFOUND|network/i.test(error.message))return 'Service is unreachable. Check runtime or network connection.';return error.message.slice(0,300);}return 'Desktop action failed';}
function emit(event:unknown,owner:BrowserWindow=mainWindow){if(legitimate(owner))owner.webContents.send('oi:event',event);}
async function withRequest(owner:BrowserWindow,id:string,action:(signal:AbortSignal)=>Promise<unknown>,timeout=120000){if(requests.size>=8)throw new Error('Too many active requests. Cancel a request first.');if(requests.has(id))throw new Error('Request identifier already active');const controller=new AbortController();requests.set(id,{controller,owner});const timer=setTimeout(()=>controller.abort(),timeout);try{return await action(controller.signal);}finally{clearTimeout(timer);requests.delete(id);}}
function handle(name:string,action:(payload:unknown,owner:BrowserWindow)=>unknown){ipcMain.handle('oi:'+name,async(event,payload)=>{const owner=BrowserWindow.fromWebContents(event.sender);if(!legitimate(owner)||!owner||event.senderFrame!==owner.webContents.mainFrame||!trustedNavigation(event.senderFrame.url,home)||isRunner(event.senderFrame.url))throw new Error('Untrusted IPC sender');try{return await action(payload,owner);}catch(error){throw new Error(safeError(error));}});}
function secureWindow(window:BrowserWindow){
  window.webContents.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument)cancelOwned(window);});window.webContents.on('render-process-gone',()=>cancelOwned(window));
  window.webContents.setWindowOpenHandler(details=>{void openKnownExternal(details.url,window);return {action:'deny'};});window.webContents.on('will-navigate',(event,url)=>{if(isRunner(url)){event.preventDefault();return;}if(!trustedNavigation(url,home)){event.preventDefault();void openKnownExternal(url,window);}});window.webContents.on('will-redirect',(event,url)=>{if(isRunner(url)||!trustedNavigation(url,home))event.preventDefault();});window.webContents.on('will-attach-webview',event=>event.preventDefault());window.webContents.on('destroyed',()=>cancelOwned(window));
}
function handlers(){
  const speechOwned=(raw:unknown,owner:BrowserWindow)=>{const data=object(raw),id=requestId(data.requestId),active=speechSessions.get(id);if(!active||active.owner!==owner)throw new Error('No realtime speech session owned by this window');return {data,id,active};};
  handle('speechStart',async(raw,owner)=>{
    const data=object(raw),id=requestId(data.requestId),source=data.source;
    if(data.consent!==true||!['PC','MIC'].includes(source as string))throw new Error('Explicit consent and a valid audio source are required');
    if(speechSessions.has(id)||speechSessions.size>=4||[...speechSessions.values()].some(item=>item.owner===owner&&item.source===source))throw new Error('This audio source already has an active realtime session');
    const language=data.language===undefined?undefined:string(data.language,12).split('-')[0];
    if(language&&!/^[a-z]{2,3}$/.test(language))throw new Error('Invalid transcription language');
    const connection=new RealtimeSpeechSession({key:vault.get('openai'),language,onEvent:event=>emit({type:'speech-event',requestId:id,source,...event},owner)});
    speechSessions.set(id,{session:connection,owner,source:source as 'PC'|'MIC'});
    try{await connection.start();return {ready:true,requestId:id,source,transport:'realtime-pcm',sampleRate:24000};}catch(error){connection.cancel();speechSessions.delete(id);throw error;}
  });
  handle('speechAppend',async(raw,owner)=>{const {data,active}=speechOwned(raw,owner);await active.session.append(string(data.base64,32768));return {accepted:true};});
  handle('speechCommit',async(raw,owner)=>{const {data,active}=speechOwned(raw,owner);if(data.discard===true)await active.session.clear();else await active.session.commit();return {accepted:true};});
  handle('speechStop',async(raw,owner)=>{const {id,active}=speechOwned(raw,owner);try{await active.session.stop();return {stopped:true};}finally{speechSessions.delete(id);}});
  handle('speechCancel',(raw,owner)=>{const {id,active}=speechOwned(raw,owner);active.session.cancel();speechSessions.delete(id);return {cancelled:true};});
  handle('getShadowState',()=>shadow.state());handle('openShadow',()=>shadow.open());handle('updateShadow',raw=>shadow.update(raw));handle('resizeShadow',raw=>shadow.resize(raw));handle('hideShadow',()=>shadow.hide());handle('closeShadow',()=>shadow.close());
  handle('capabilities',()=>({platform:process.platform,version:app.getVersion(),localSqlite:true,encryptedRecords:true,vault:vault.status(),microphone:true,systemAudio:process.platform==='win32',visibleAudioConsent:true,providerStreaming:true,providerCancellation:true,apiBase:'http://127.0.0.1:8000',ramGB:Math.round(os.totalmem()/1024**3),modelGuidance:[{name:'qwen2.5:0.5b',minimumRamGB:3},{name:'qwen3:0.6b',minimumRamGB:4},{name:'gemma3:1b',minimumRamGB:6},{name:'qwen3:4b',minimumRamGB:10}],unsigned:true}));
  handle('vaultStatus',()=>vault.status());handle('setCredential',(raw,owner)=>{const data=object(raw);return vault.set(data.provider,data.key);});handle('removeCredential',raw=>vault.remove(object(raw).provider));
  handle('providerRequest',(raw,owner)=>{const data=object(raw);const id=data.requestId?requestId(data.requestId):randomUUID();return withRequest(owner,id,signal=>generateStreaming({...data,requestId:id},p=>vault.get(p),signal,text=>emit({type:'provider-chunk',requestId:id,text},owner),process.env.OPENINTERVIEW_COMPATIBLE_BASE_URL));});
  handle('providerModels',(raw,owner)=>{const p=provider(object(raw).provider);return listProviderModels(p,p==='ollama'?'':vault.get(p),process.env.OPENINTERVIEW_COMPATIBLE_BASE_URL);});
  handle('transcribeAudio',(raw,owner)=>{const data=object(raw),id=data.requestId?requestId(data.requestId):randomUUID();audioInput({...data,requestId:id});return withRequest(owner,id,signal=>transcribeAudio({...data,requestId:id},vault.get('openai'),signal));});
  handle('visionRequest',(raw,owner)=>{const data=object(raw),id=data.requestId?requestId(data.requestId):randomUUID();visionInput({...data,requestId:id});return withRequest(owner,id,signal=>visionRequest({...data,requestId:id},vault.get('openai'),signal));});
  handle('cancelRequest',(raw,owner)=>{const id=requestId(object(raw).requestId);const active=requests.get(id);const owned=active?.owner===owner;if(owned)active.controller.abort();return {cancelled:owned,requestId:id};});
  handle('ollamaStatus',async()=>{const status=await ollamaStatus();if(status.running)return status;const installed=detectOllamaInstall();return {...status,installed,message:installed?'Ollama is installed but its local service is not reachable. Open Ollama, then check again.':'Ollama was not detected in PATH or standard installation locations. Install it from https://ollama.com/download and start it.'};});handle('ollamaModels',async()=>{const data=await ollamaJson('tags');return data.models??[];});
  handle('ollamaGenerate',(raw,owner)=>{const data=object(raw),name=model(data.model),id=data.requestId?requestId(data.requestId):randomUUID();return withRequest(owner,id,signal=>generateStreaming({provider:'ollama',model:name,messages:[{role:'user',content:string(data.prompt,100000)}],requestId:id},()=>'',signal,text=>emit({type:'provider-chunk',requestId:id,text},owner)));});
  handle('ollamaPull',async (raw,owner)=>{const data=object(raw),name=model(data.model),id=data.requestId?requestId(data.requestId):randomUUID();const consent=await dialog.showMessageBox(owner,{type:'question',buttons:['Cancel','Download model'],defaultId:0,cancelId:0,title:'Download local model',message:'Download '+name+'?',detail:'Models may use several gigabytes of disk space and network data. The download runs in Ollama on this computer.'});if(consent.response!==1)return {cancelled:true,requestId:id};return withRequest(owner,id,signal=>ollamaPull(name,signal,event=>emit({type:'ollama-pull',requestId:id,model:name,...object(event)},owner)),60*60*1000);});
  handle('ollamaRemove',async (raw,owner)=>{const name=model(object(raw).model);const confirmation=await dialog.showMessageBox(owner,{type:'warning',buttons:['Cancel','Remove model'],defaultId:0,cancelId:0,message:'Remove local model '+name+'?'});if(confirmation.response!==1)return {removed:false};const response=await fetch(ORIGINS.ollama+'/api/delete',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:name}),signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)throw new Error('Ollama could not remove this model');return {removed:true};});
  handle('ollamaControl',async (raw,owner)=>{const data=object(raw),name=model(data.model);if(!['start','stop','test'].includes(data.action as string))throw new Error('Invalid model action');if(data.action==='test'){const id=randomUUID();return withRequest(owner,id,signal=>generate({provider:'ollama',model:name,messages:[{role:'user',content:'Reply with one short sentence confirming you are ready for interview practice.'}],maxTokens:64,requestId:id},()=>'',signal));}await ollamaJson('generate',{model:name,prompt:'',stream:false,keep_alive:data.action==='stop'?0:'5m'},AbortSignal.timeout(120000));return {model:name,action:data.action,success:true};});
  handle('storeGet',raw=>store.get(object(raw).key));handle('storePut',(raw,owner)=>{const data=object(raw);return store.put(data.key,data.value);});handle('storeDelete',raw=>store.delete(object(raw).key));
  handle('apiStatus',async()=>{try{const response=await fetch('http://127.0.0.1:8000/health',{signal:AbortSignal.timeout(3000),redirect:'error'});return {running:response.ok,baseUrl:'http://127.0.0.1:8000'};}catch{return {running:false,baseUrl:'http://127.0.0.1:8000',message:'Optional local API is not running. Local workspace remains available.'};}});
  handle('requestMediaAccess',async(_raw,owner)=>{const consent=await dialog.showMessageBox(owner,{type:'question',buttons:['Cancel','Allow microphone'],defaultId:0,cancelId:0,message:'Enable microphone for this session?',detail:'The visible recording control must be started separately. Stop it any time to release your microphone. Transcription processing is shown in the workspace.'});mediaUntil.set(owner,consent.response===1?Date.now()+30000:0);return {granted:consent.response===1};});
  handle('chooseFile',async (raw,owner)=>{if(importBusy)throw new Error('A file dialog is already open');const data=object(raw??{}),allowed=['pdf','docx','txt','md','csv','json','png','jpg','jpeg','webp','py','js','ts','java','cpp','c'];const extensions=data.extensions===undefined?allowed:data.extensions;if(!Array.isArray(extensions)||extensions.length<1||extensions.some(x=>!allowed.includes(x)))throw new Error('Unsupported file extension');importBusy=true;try{const chosen=await dialog.showOpenDialog(owner,{properties:['openFile'],filters:[{name:'Documents and images',extensions}]});if(chosen.canceled)return null;const file=chosen.filePaths[0],ext=path.extname(file).slice(1).toLowerCase();if(!extensions.includes(ext)||statSync(file).size>MAX_FILE)throw new Error('Choose a supported file below 20 MB');const content=await fs.readFile(file);const binary=['pdf','docx','png','jpg','jpeg','webp'].includes(ext);return {name:path.basename(file),mime:({'pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'} as Record<string,string>)[ext]??'text/plain',content:content.toString(binary?'base64':'utf8'),encoding:binary?'base64':'utf8'};}finally{importBusy=false;}});
  handle('exportFile',async (raw,owner)=>{if(exportBusy)throw new Error('A save dialog is already open');const data=object(raw),name=safeName(data.name),content=string(data.content,MAX_FILE);if(!/\.(md|txt|json|csv|html|svg)$/i.test(name))throw new Error('Export supports Markdown, text, JSON, CSV, HTML and SVG');exportBusy=true;try{const result=await dialog.showSaveDialog(owner,{defaultPath:name});if(result.canceled||!result.filePath)return {saved:false};await fs.writeFile(result.filePath,content,{encoding:'utf8',mode:0o600});return {saved:true,name:path.basename(result.filePath)};}finally{exportBusy=false;}});
}

async function smokeShadowWindow(){
  const report:Record<string,unknown>={};
  try{
    const initial=await shadow.open(),window=shadow.window!;
    await new Promise(resolve=>setTimeout(resolve,900));
    report.initial=initial;
    report.bridge=await window.webContents.executeJavaScript("typeof window.openInterviewDesktop?.getShadowState==='function' && typeof require==='undefined'");
    report.sandbox=app.getAppMetrics().find(metric=>metric.pid===window.webContents.getOSProcessId())?.sandboxed===true;
    report.nativeAppearance={background:window.getBackgroundColor(),opacity:window.getOpacity(),normal:window.isNormal()};
    report.transparent=['#00000000','#000000'].includes(window.getBackgroundColor())&&window.getOpacity()===1;
    report.resizable=window.isResizable();report.topmost=window.isAlwaysOnTop();report.captureRequested=process.platform!=='win32'||window.isContentProtected();
    const before=window.getBounds();
    const updated=await window.webContents.executeJavaScript("window.openInterviewDesktop.updateShadow({backgroundTransparency:0.55,fontSize:18,compact:false})");
    report.configuration=updated.backgroundTransparency===0.55&&updated.fontSize===18&&!updated.compact&&window.getOpacity()===1;
    report.settingsPreserveBounds=JSON.stringify(window.getBounds())===JSON.stringify(before);
    await window.webContents.executeJavaScript("window.openInterviewDesktop.updateShadow({alwaysOnTop:false})");report.topmostConfigurable=!window.isAlwaysOnTop();
    await window.webContents.executeJavaScript("window.openInterviewDesktop.updateShadow({alwaysOnTop:true})");
    await window.webContents.executeJavaScript("window.openInterviewDesktop.resizeShadow({edge:'SE',dx:31,dy:23})");
    const after=window.getBounds();report.resizeBounds={before,after};report.resize=Math.abs(after.width-before.width-31)<=1&&Math.abs(after.height-before.height-23)<=1;
    report.invalidResizeRejected=await window.webContents.executeJavaScript("window.openInterviewDesktop.resizeShadow({edge:'ANY',dx:2,dy:2}).then(()=>false,()=>true)");
    await window.webContents.executeJavaScript("window.openInterviewDesktop.storePut({key:'shadow.smoke.roundtrip',value:{latest:'persisted-overlay'}})");
    report.persisted=store.get('shadow.smoke.roundtrip')?.latest==='persisted-overlay';
    shadow.hide();report.hide=!window.isVisible();shadow.toggle();report.restore=window.isVisible();
    shadow.update({clickThrough:true});report.clickThrough=shadow.state().clickThrough;shadow.toggle();report.mouseRecovery=window.isVisible()&&!shadow.state().clickThrough;
    await fs.writeFile(path.join(app.getPath('userData'),'smoke-shadow.png'),(await window.webContents.capturePage()).toPNG());
    const impostor=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    await impostor.loadURL(home);
    report.impostorRejected=await impostor.webContents.executeJavaScript("window.openInterviewDesktop.getCapabilities().then(()=>false,()=>true)");impostor.destroy();
    window.close();report.safeCloseIntercepted=!window.isDestroyed();
    await shadow.close();await new Promise(resolve=>setTimeout(resolve,900));
    report.returnedToLight=mainWindow.isVisible()&&!shadow.state().active&&!new URL(mainWindow.webContents.getURL()).searchParams.has('desktopShadow');
    report.latestStateInLight=await mainWindow.webContents.executeJavaScript("window.openInterviewDesktop.storeGet({key:'shadow.smoke.roundtrip'}).then(value=>value.latest==='persisted-overlay')");
    await shadow.open();report.settingsPersisted=shadow.state().backgroundTransparency===0.55&&shadow.state().fontSize===18;
    report.passed=['bridge','sandbox','transparent','resizable','topmost','captureRequested','configuration','settingsPreserveBounds','topmostConfigurable','resize','invalidResizeRejected','persisted','hide','restore','clickThrough','mouseRecovery','safeCloseIntercepted','impostorRejected','returnedToLight','latestStateInLight','settingsPersisted'].every(key=>report[key]===true);
    await fs.writeFile(path.join(app.getPath('userData'),'smoke-shadow-result.json'),JSON.stringify(report,null,2));console.log('OPENINTERVIEW_SHADOW_SMOKE '+JSON.stringify(report));app.exit(report.passed?0:1);
  }catch(error){console.error('Shadow smoke failed:',safeError(error));app.exit(1);}
}

app.whenReady().then(async()=>{
  mkdirSync(app.getPath('userData'),{recursive:true});vault=new Vault(app.getPath('userData'),safeStorage);store=new LocalStore(path.join(app.getPath('userData'),'workspace.sqlite3'),vault);
  const policy=csp(),isolatedRunnerPolicy=runnerCsp();
  protocol.handle('oi',async request=>{try{const url=new URL(request.url);if(url.host!=='app')return new Response('Not found',{status:404});let file=assetPath(webRoot,url.pathname);if(existsSync(file)&&statSync(file).isDirectory())file=path.join(file,'index.html');if(!existsSync(file)&&existsSync(file+'.html'))file+='.html';if(!existsSync(file))file=path.join(webRoot,'404.html');if(!existsSync(file))file=path.join(__dirname,'setup.html');const response=await net.fetch(pathToFileURL(file).toString());const headers=new Headers(response.headers);headers.set('Content-Security-Policy',isRunner(request.url)?isolatedRunnerPolicy:policy);headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers});}catch{return new Response('Invalid path',{status:400});}});
  session.defaultSession.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[isRunner(details.url)?isolatedRunnerPolicy:policy]}}));
  session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details)=>legitimate(contents?BrowserWindow.fromWebContents(contents):null)&&trustedNavigation(origin,home)&&permission==='media'&&Date.now()<(mediaUntil.get(contents?BrowserWindow.fromWebContents(contents)!:null!)??0)&&details.isMainFrame&&details.mediaType==='audio');
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(legitimate(BrowserWindow.fromWebContents(contents))&&trustedNavigation(details.requestingUrl,home)&&permission==='media'&&Date.now()<(mediaUntil.get(BrowserWindow.fromWebContents(contents)!)??0)&&details.isMainFrame&&'mediaTypes' in details&&!!details.mediaTypes?.length&&details.mediaTypes.every(type=>type==='audio')));
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{try{const owner=BrowserWindow.getAllWindows().find(window=>legitimate(window)&&window.webContents.mainFrame===request.frame);if(!owner||!trustedNavigation(request.securityOrigin,home)||!request.userGesture){callback({});return;}const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});if(!sources.length){callback({});return;}const chosen=await dialog.showMessageBox(owner,{type:'question',buttons:['Cancel',...sources.slice(0,10).map(s=>s.name)],defaultId:0,cancelId:0,message:'Choose a screen or window to share',detail:'Sharing stays visible. Stop sharing from the workspace. On Windows, system audio includes all audio playing on this computer.'});if(chosen.response===0){callback({});return;}const source=sources[chosen.response-1];callback({video:source,...(request.audioRequested&&process.platform==='win32'?{audio:'loopback' as const}:{})});emit({type:'capture-selected',source:source.name,systemAudio:request.audioRequested&&process.platform==='win32'},owner);}catch{callback({});}});
  mainWindow=new BrowserWindow({width:1440,height:940,minWidth:900,minHeight:650,title:'OpenInterview AI',icon:path.join(__dirname,'icon.png'),show:!smoke,backgroundColor:'#0b1220',webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:true,backgroundThrottling:!smoke}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'OpenInterview AI',submenu:[{role:'about'},{role:'quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'},...(development?[{role:'toggleDevTools' as const}]:[])]}]));
  secureWindow(mainWindow);
  shadow=new ShadowWindow(mainWindow,store,home,secureWindow,cancelOwned);
  session.defaultSession.on('will-download',(event,item)=>{try{const url=item.getURL();if(!trustedNavigation(url.startsWith('blob:')?url.slice(5):url,home)){event.preventDefault();return;}const name=safeName(item.getFilename());if(!/\.(pdf|docx|md|txt|json|csv|svg|png|jpg|webp|js|ts|py|java|cpp|c|h|sql|webm|wav|ogg|mp4|mp3|flac)$/i.test(name)){event.preventDefault();return;}item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),name)});}catch{event.preventDefault();}});
  handlers();
  mainWindow.webContents.on('did-finish-load',async()=>{if(smoke&&!smokeShadow){try{
    await new Promise(resolve=>setTimeout(resolve,1000));
    if(smokeLocalAi)await mainWindow.webContents.executeJavaScript('window.__smokeLocalAi=true');
    if(smokeCloudAi)await mainWindow.webContents.executeJavaScript('window.__smokeCloudAi=true');
    if(smokeVision)await mainWindow.webContents.executeJavaScript('window.__smokeVision=true');
    const result=await mainWindow.webContents.executeJavaScript(readFileSync(path.join(__dirname,'smoke-renderer.js'),'utf8'));
    const sentinel='synthetic-vault-roundtrip',encrypted=vault.encrypt(sentinel);
    const report={...result,webExportPresent:existsSync(path.join(webRoot,'index.html')),workspaceExportPresent:existsSync(path.join(webRoot,'workspace','index.html'))||existsSync(path.join(webRoot,'workspace.html')),vault:vault.status(),osCryptoRoundtrip:vault.decrypt(encrypted)===sentinel&&!encrypted.includes(Buffer.from(sentinel)),electron:process.versions.electron};
    await fs.writeFile(path.join(app.getPath('userData'),'smoke-result.json'),JSON.stringify(report,null,2));
    mainWindow.showInactive();
    await new Promise(resolve=>setTimeout(resolve,600));
    await fs.writeFile(path.join(app.getPath('userData'),'smoke-workspace.png'),(await mainWindow.webContents.capturePage()).toPNG());
    console.log('OPENINTERVIEW_SMOKE '+JSON.stringify(report));app.exit(result.bridge&&result.node==='undefined'&&result.workspaceHydrated&&result.invalidIpcRejected&&result.invalidInlineScriptBlocked&&result.runnerSandboxPassed&&result.runnerOriginIsolated&&result.sqliteRoundtrip&&report.osCryptoRoundtrip&&report.webExportPresent&&report.workspaceExportPresent&&(!smokeLocalAi||(result.localAiPassed&&result.localAiCancellationPassed))&&(!smokeCloudAi||result.cloudAiPassed)&&(!smokeVision||result.visionPassed)?0:1);
  }catch(error){console.error(safeError(error));app.exit(1);}}});
  mainWindow.webContents.on('did-fail-load',(_event,code)=>{console.error('Workspace load failed:',code);if(smoke)app.exit(1);});
  if(smoke)mainWindow.showInactive();
  await mainWindow.loadURL(home);
  if(shadowFixture){const state=await shadow.open();console.log('OPENINTERVIEW_SHADOW_FIXTURE '+JSON.stringify({...state,nativeHandle:shadow.window?.getNativeWindowHandle().toString('hex'),pid:process.pid}));}
  if(smokeShadow)await smokeShadowWindow();
}).catch(error=>{console.error('Desktop startup failed:',safeError(error));app.exit(1);});
app.on('window-all-closed',()=>{for(const active of requests.values())active.controller.abort();for(const active of speechSessions.values())active.session.cancel();speechSessions.clear();if(process.platform!=='darwin')app.quit();});
app.on('before-quit',event=>{if(shadow?.prepareQuit()){event.preventDefault();return;}shadow?.dispose();for(const active of requests.values())active.controller.abort();for(const active of speechSessions.values())active.session.cancel();speechSessions.clear();store?.close();});
app.on('activate',()=>{if(shadow?.window&&!shadow.window.isDestroyed())shadow.window.show();else if(mainWindow&&!mainWindow.isDestroyed())mainWindow.show();else app.relaunch(),app.exit();});

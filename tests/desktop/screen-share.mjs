import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

// Test only: capture a synthetic blue desktop with an opaque magenta marker
// inside the actual Shadow window. Never store or upload full desktop frames.
const root=process.cwd();
const profile=await mkdtemp(path.join(os.tmpdir(),'oi-share-test-'));
await writeFile(path.join(profile,'receiver.html'),'<!doctype html><button id="start">Start synthetic capture</button><video muted autoplay></video><canvas></canvas>');
const installed=process.env.OPENINTERVIEW_INSTALLED_EXE;
const app=await electron.launch({executablePath:installed||path.join(root,'node_modules/electron/dist/electron.exe'),args:installed?[]:[path.join(root,'apps/desktop'),'--shadow-fixture'],env:{...process.env,OPENINTERVIEW_TEST_PROFILE:profile},timeout:45000});
let originalBounds;
try{
 if(installed){const main=await app.firstWindow();await main.getByRole('heading',{name:'Make your next interview your best one.'}).waitFor();await main.evaluate(()=>{window.location.hash='shadow';});}
 await app.waitForEvent('window',{predicate:page=>page.url().includes('desktopShadow=1'),timeout:30000}).catch(()=>{});
 const shadow=app.windows().find(page=>page.url().includes('desktopShadow=1'));
 assert(shadow,'Actual Shadow renderer opened');await shadow.waitForLoadState();
 originalBounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('desktopShadow=1')).getBounds());
 await app.evaluate(async({BrowserWindow,screen,session,desktopCapturer},profile)=>{
  const display=screen.getPrimaryDisplay();
  const overlay=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('desktopShadow=1'));
  const background=new BrowserWindow({...display.bounds,frame:false,show:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#1234d0',webPreferences:{sandbox:true}});
  await background.loadURL('data:text/html,<html style="background:%231234d0"><title>Synthetic screen-share fixture</title></html>');background.show();
  overlay.setBounds({x:display.bounds.x+80,y:display.bounds.y+80,width:650,height:500});overlay.show();overlay.moveTop();
  const ses=session.fromPartition('share-fixture');
  ses.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='display-capture'||permission==='media'));
  ses.setDisplayMediaRequestHandler(async(_request,callback)=>{
   const sources=await desktopCapturer.getSources({types:['screen']});
   const source=sources.find(s=>s.display_id===String(display.id));if(!source)throw Error('Primary monitor not found');callback({video:source});
  });
  const receiver=new BrowserWindow({x:display.bounds.x-2000,y:display.bounds.y,width:200,height:120,show:true,frame:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true}});
  await receiver.loadFile(profile+'/receiver.html');
 },profile);
 await shadow.evaluate(()=>{const marker=document.createElement('div');marker.id='capture-test-marker';marker.style.cssText='position:fixed;left:40px;top:90px;width:180px;height:100px;background:rgb(255,0,255);z-index:2147483647;pointer-events:none';document.body.append(marker);});
 const receiver=app.windows().find(p=>p.url().endsWith('receiver.html'));assert(receiver);
 await receiver.evaluate(()=>document.querySelector('#start').addEventListener('click',async()=>{
  try{const video=document.querySelector('video');window.testStream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:10},audio:false});video.srcObject=window.testStream;await video.play();window.captureReady=true;}catch(e){window.captureError=String(e);}
 }));
 await receiver.click('#start');
 await receiver.waitForFunction(()=>window.captureReady||window.captureError,{timeout:20000});
 assert.equal(await receiver.evaluate(()=>window.captureError),undefined);
 const bounds=await app.evaluate(({BrowserWindow,screen})=>({window:BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('desktopShadow=1')).getBounds(),display:screen.getPrimaryDisplay().bounds}));
 async function sample(protectedState){
  await app.evaluate(({BrowserWindow},enabled)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('desktopShadow=1')).setContentProtection(enabled),protectedState);
  return receiver.evaluate(async({bounds,protectedState})=>{
   const video=document.querySelector('video'),canvas=document.querySelector('canvas');
   const until=Date.now()+15000;let result;
   do{
    await new Promise(resolve=>video.requestVideoFrameCallback(resolve));
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0);
    const sx=canvas.width/bounds.display.width,sy=canvas.height/bounds.display.height;
    const x=Math.round((bounds.window.x-bounds.display.x+60)*sx),y=Math.round((bounds.window.y-bounds.display.y+110)*sy);
    const pixels=ctx.getImageData(x,y,Math.round(100*sx),Math.round(50*sy)).data;let magenta=0,blue=0;
    for(let i=0;i<pixels.length;i+=4){if(pixels[i]>230&&pixels[i+1]<30&&pixels[i+2]>230)magenta++;if(Math.abs(pixels[i]-18)<12&&Math.abs(pixels[i+1]-52)<12&&Math.abs(pixels[i+2]-208)<12)blue++;}
    result={protected:protectedState,width:canvas.width,height:canvas.height,magenta:magenta/(pixels.length/4),blue:blue/(pixels.length/4)};
    if(protectedState?result.blue>.98:result.magenta>.98)return result;
   }while(Date.now()<until);return result;
  },{bounds,protectedState});
 }
 const unprotected=await sample(false),protectedFrame=await sample(true),restored=await sample(false);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('desktopShadow=1')).setContentProtection(true));
 const report={time:new Date().toISOString(),platform:process.platform,installedBuild:!!installed,method:'WebRTC getDisplayMedia primary full-screen A-B-A synthetic fixture',unprotected,protectedFrame,restored};
 await mkdir(path.join(root,'.local'),{recursive:true});await writeFile(path.join(root,installed?'.local/screen-share-installed-result.json':'.local/screen-share-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 assert(unprotected.magenta>.98,'Unprotected overlay must appear in full-screen stream');
 assert(protectedFrame.blue>.98&&protectedFrame.magenta<.01,'Protected overlay must be excluded and underlying desktop visible');
 assert(restored.magenta>.98,'Disabling protection must restore marker in same stream');
 console.log('PASS: actual Shadow excluded from full-screen video capture, with positive controls');
}finally{if(originalBounds)await app.evaluate(({BrowserWindow},bounds)=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('desktopShadow=1'));if(window){window.setContentProtection(true);window.setBounds(bounds);}},originalBounds).catch(()=>{});await app.close();}

import { contextBridge, ipcRenderer } from 'electron';
const invoke=(name:string,payload?:unknown)=>ipcRenderer.invoke('oi:'+name,payload);
contextBridge.exposeInMainWorld('openInterviewDesktop',Object.freeze({
  platform:process.platform,version:'0.4.0',
  retrieveKnowledge:(value:unknown)=>invoke('retrieveKnowledge',value),
  speechStart:(value:unknown)=>invoke('speechStart',value),speechAppend:(value:unknown)=>invoke('speechAppend',value),speechCommit:(value:unknown)=>invoke('speechCommit',value),speechStop:(value:unknown)=>invoke('speechStop',value),speechCancel:(value:unknown)=>invoke('speechCancel',value),
  getShadowState:()=>invoke('getShadowState'),openShadow:()=>invoke('openShadow'),updateShadow:(value:unknown)=>invoke('updateShadow',value),resizeShadow:(value:unknown)=>invoke('resizeShadow',value),hideShadow:()=>invoke('hideShadow'),closeShadow:()=>invoke('closeShadow'),
  getCapabilities:()=>invoke('capabilities'),vaultStatus:()=>invoke('vaultStatus'),
  setCredential:(provider:string,key:string)=>invoke('setCredential',{provider,key}),removeCredential:(provider:string)=>invoke('removeCredential',{provider}),
  providerRequest:(value:unknown)=>invoke('providerRequest',value),providerModels:(value:unknown)=>invoke('providerModels',value),transcribeAudio:(value:unknown)=>invoke('transcribeAudio',value),visionRequest:(value:unknown)=>invoke('visionRequest',value),cancelRequest:(value:unknown)=>invoke('cancelRequest',value),
  ollamaStatus:()=>invoke('ollamaStatus'),ollamaModels:()=>invoke('ollamaModels'),ollamaPull:(value:unknown)=>invoke('ollamaPull',value),ollamaRemove:(value:unknown)=>invoke('ollamaRemove',value),ollamaGenerate:(value:unknown)=>invoke('ollamaGenerate',value),ollamaControl:(value:unknown)=>invoke('ollamaControl',value),
  chooseFile:(value:unknown)=>invoke('chooseFile',value),exportFile:(value:unknown)=>invoke('exportFile',value),getApiStatus:()=>invoke('apiStatus'),
  requestMediaAccess:()=>invoke('requestMediaAccess'),storeGet:(value:unknown)=>invoke('storeGet',value),storePut:(value:unknown)=>invoke('storePut',value),storeDelete:(value:unknown)=>invoke('storeDelete',value),
  onEvent:(callback:(value:unknown)=>void)=>{if(typeof callback!=='function')throw new Error('Callback required');const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('oi:event',listener);return ()=>ipcRenderer.removeListener('oi:event',listener);}
}));

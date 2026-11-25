'use client';
import { createContext,useCallback,useContext,useEffect,useRef,useState,type Dispatch,type SetStateAction } from 'react';
import type { AppState } from './types';
import { initialState } from './core';
import { readWorkspace } from './validation';
const STORAGE='openinterview-workspace-v1';
const Context=createContext<{state:AppState;setState:Dispatch<SetStateAction<AppState>>;getWorkspace:()=>AppState;ready:boolean;storageError:string;reset:()=>void;restore:(data:AppState)=>void;flushWorkspace:()=>Promise<void>;suspendPersistence:()=>void;resumePersistence:()=>void}|null>(null);
export function StoreProvider({children}:{children:React.ReactNode}){
 const [state,renderState]=useState<AppState>(initialState);const [ready,setReady]=useState(false);const [storageError,setStorageError]=useState('');const [writable,setWritable]=useState(true);
 const latest=useRef(state);
 const getWorkspace=useCallback(()=>latest.current,[]);
 // Flush can follow a state update in the same event, before React renders.
 const setState=useCallback<Dispatch<SetStateAction<AppState>>>(update=>{const next=typeof update==='function'?update(latest.current):update;latest.current=next;renderState(next);},[]);
 const status=useRef({ready:false,writable:true,suspended:false,epoch:0});status.current.ready=ready;status.current.writable=writable;
 const tail=useRef<Promise<void>>(Promise.resolve());
 const persist=useCallback((snapshot:AppState)=>{
  const epoch=status.current.epoch;
  const operation=tail.current.catch(()=>{}).then(async()=>{
   if(status.current.suspended||epoch!==status.current.epoch)return;
   const bridge=window.openInterviewDesktop;
   if(bridge?.storePut)await bridge.storePut({key:'workspace',value:snapshot});
   else localStorage.setItem(STORAGE,JSON.stringify(snapshot));
   setStorageError('');
  });
  tail.current=operation;
  return operation;
 },[]);
 const flushWorkspace=useCallback(async()=>{
  if(!status.current.ready||!status.current.writable)throw Error('Workspace storage is unavailable; export a backup before switching windows.');
  if(status.current.suspended){await tail.current;return;}
  await persist(latest.current);
 },[persist]);
 const suspendPersistence=useCallback(()=>{status.current.suspended=true;status.current.epoch++;},[]);
 const resumePersistence=useCallback(()=>{status.current.suspended=false;void persist(latest.current).catch(()=>setStorageError('Workspace could not be saved. Export a backup now.'));},[persist]);
 useEffect(()=>{let cancelled=false;async function load(){try{const bridge=window.openInterviewDesktop;const saved=bridge?.storeGet?await bridge.storeGet({key:'workspace'}):localStorage.getItem(STORAGE);const parsed=typeof saved==='string'?JSON.parse(saved):saved;if(!cancelled){const data=parsed?readWorkspace(parsed):{...initialState,provider:{...initialState.provider}};if(bridge){const vault=await bridge.vaultStatus();data.provider.configured=data.provider.provider==='ollama'||(Array.isArray(vault.configured)&&vault.configured.includes(data.provider.provider));}if(!cancelled)setState(data);}}catch{setWritable(false);setStorageError('Saved workspace data is invalid or unreadable. A temporary workspace is open; the original data has not been overwritten. Import a valid backup or explicitly delete the saved data in Settings.');}if(!cancelled)setReady(true);}void load();return()=>{cancelled=true;};},[]);
 useEffect(()=>{if(!ready)return;document.documentElement.dataset.theme=state.theme;document.documentElement.style.fontSize=`${state.fontSize}px`;document.documentElement.dataset.reducedMotion=String(state.reducedMotion);if(!writable||status.current.suspended)return;void persist(state).catch(()=>setStorageError('Workspace could not be saved. Export a backup now.'));},[state,ready,writable,persist]);
 function reset(){status.current.epoch++;status.current.suspended=false;setState(initialState);setWritable(true);setStorageError('');}
 function restore(data:AppState){status.current.epoch++;setState(readWorkspace(data));setWritable(true);setStorageError('');}
 return <Context.Provider value={{state,setState,getWorkspace,ready,storageError,reset,restore,flushWorkspace,suspendPersistence,resumePersistence}}>{children}</Context.Provider>;
}
export function useStore(){const value=useContext(Context);if(!value)throw Error('Workspace provider missing');return value;}



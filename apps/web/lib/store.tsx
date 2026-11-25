'use client';
import { createContext,useContext,useEffect,useState,type Dispatch,type SetStateAction } from 'react';
import type { AppState } from './types';
import { initialState } from './core';
import { readWorkspace } from './validation';
const STORAGE='openinterview-workspace-v1';
const Context=createContext<{state:AppState;setState:Dispatch<SetStateAction<AppState>>;ready:boolean;storageError:string;reset:()=>void;restore:(data:AppState)=>void}|null>(null);
export function StoreProvider({children}:{children:React.ReactNode}){
 const [state,setState]=useState<AppState>(initialState);const [ready,setReady]=useState(false);const [storageError,setStorageError]=useState('');const [writable,setWritable]=useState(true);
 useEffect(()=>{let cancelled=false;async function load(){try{const bridge=window.openInterviewDesktop;const saved=bridge?.storeGet?await bridge.storeGet({key:'workspace'}):localStorage.getItem(STORAGE);const parsed=typeof saved==='string'?JSON.parse(saved):saved;if(!cancelled){const data=parsed?readWorkspace(parsed):{...initialState,provider:{...initialState.provider}};if(bridge){const vault=await bridge.vaultStatus();data.provider.configured=data.provider.provider==='ollama'||(Array.isArray(vault.configured)&&vault.configured.includes(data.provider.provider));}if(!cancelled)setState(data);}}catch{setWritable(false);setStorageError('Saved workspace data is invalid or unreadable. A temporary workspace is open; the original data has not been overwritten. Import a valid backup or explicitly delete the saved data in Settings.');}if(!cancelled)setReady(true);}void load();return()=>{cancelled=true;};},[]);
 useEffect(()=>{if(!ready)return;document.documentElement.dataset.theme=state.theme;document.documentElement.style.fontSize=`${state.fontSize}px`;document.documentElement.dataset.reducedMotion=String(state.reducedMotion);if(!writable)return;const bridge=window.openInterviewDesktop;try{if(bridge?.storePut){void bridge.storePut({key:'workspace',value:state}).then(()=>setStorageError('')).catch(()=>setStorageError('Encrypted desktop storage could not save this change. Export a backup now.'));}else localStorage.setItem(STORAGE,JSON.stringify(state));}catch{setStorageError('Browser storage is full or unavailable. Export your workspace now; new changes may not persist.');}},[state,ready,writable]);
 function reset(){localStorage.removeItem(STORAGE);void window.openInterviewDesktop?.storeDelete?.({key:'workspace'});setState(initialState);setWritable(true);setStorageError('');}
 function restore(data:AppState){setState(readWorkspace(data));setWritable(true);setStorageError('');}
 return <Context.Provider value={{state,setState,ready,storageError,reset,restore}}>{children}</Context.Provider>;
}
export function useStore(){const value=useContext(Context);if(!value)throw Error('Workspace provider missing');return value;}



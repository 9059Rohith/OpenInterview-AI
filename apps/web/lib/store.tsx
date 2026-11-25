'use client';
import { createContext,useContext,useEffect,useState,type Dispatch,type SetStateAction } from 'react';
import type { AppState } from './types';
import { initialState } from './core';
import { readWorkspace } from './validation';
const STORAGE='openinterview-workspace-v1';
const Context=createContext<{state:AppState;setState:Dispatch<SetStateAction<AppState>>;ready:boolean;storageError:string;reset:()=>void}|null>(null);
export function StoreProvider({children}:{children:React.ReactNode}){
 const [state,setState]=useState<AppState>(initialState);const [ready,setReady]=useState(false);const [storageError,setStorageError]=useState('');
 useEffect(()=>{let cancelled=false;async function load(){try{const bridge=window.openInterviewDesktop;const saved=bridge?.storeGet?await bridge.storeGet({key:'workspace'}):localStorage.getItem(STORAGE);const parsed=typeof saved==='string'?JSON.parse(saved):saved;if(!cancelled&&parsed)setState(readWorkspace(parsed));}catch{setStorageError('Saved workspace data is invalid or unreadable. A fresh temporary workspace is open. Preserve the original browser data and import a valid backup.');}if(!cancelled)setReady(true);}void load();return()=>{cancelled=true;};},[]);
 useEffect(()=>{if(!ready)return;const bridge=window.openInterviewDesktop;try{if(bridge?.storePut){void bridge.storePut({key:'workspace',value:state}).then(()=>setStorageError('')).catch(()=>setStorageError('Encrypted desktop storage could not save this change. Export a backup now.'));}else localStorage.setItem(STORAGE,JSON.stringify(state));}catch{setStorageError('Browser storage is full or unavailable. Export your workspace now; new changes may not persist.');}document.documentElement.dataset.theme=state.theme;document.documentElement.style.fontSize=`${state.fontSize}px`;document.documentElement.dataset.reducedMotion=String(state.reducedMotion);},[state,ready]);
 function reset(){localStorage.removeItem(STORAGE);void window.openInterviewDesktop?.storeDelete?.({key:'workspace'});setState(initialState);}
 return <Context.Provider value={{state,setState,ready,storageError,reset}}>{children}</Context.Provider>;
}
export function useStore(){const value=useContext(Context);if(!value)throw Error('Workspace provider missing');return value;}

'use client';
import {useSyncExternalStore} from 'react';
// On/off options persist in the WebView profile, like the chosen AI model and display scale.
// The prerendered page renders defaults; saved values apply right after hydration.
const memory=new Map<string,boolean>();const listeners=new Set<()=>void>();
const storageKey=(key:string)=>`stream-record.option.${key}`;
function read(key:string,initial:boolean){
 const known=memory.get(key);if(known!==undefined)return known;
 try{const saved=window.localStorage.getItem(storageKey(key));return saved===null?initial:saved==='true';}catch{return initial;}
}
function subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function useStoredFlag(key:string,initial:boolean):readonly [boolean,(value:boolean)=>void]{
 const value=useSyncExternalStore(subscribe,()=>read(key,initial),()=>initial);
 const set=(next:boolean)=>{memory.set(key,next);try{window.localStorage.setItem(storageKey(key),String(next));}catch{/* Storage unavailable: the choice lasts for this run. */}listeners.forEach(listener=>listener());};
 return [value,set] as const;
}

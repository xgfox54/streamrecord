'use client';
import {useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {z} from 'zod';
import {readRows} from '../meeting-ko/core';
import type {Snapshot} from './useMeetingSession';
import type {RecordInputKind} from './record-presentation';

const recordSchema=z.object({id:z.string().regex(/^[A-Za-z0-9-]{1,80}$/),title:z.string(),updatedAt:z.string(),rowCount:z.number().int().nonnegative(),inputKind:z.enum(['microphone','pc','youtube','file']).optional(),durationSeconds:z.number().finite().nonnegative().optional(),hasMinutes:z.boolean().optional()});
const listSchema=z.object({records:z.array(recordSchema),warnings:z.array(z.string())});
const snapshotSchema=z.object({version:z.literal(1),recordId:z.string().regex(/^[A-Za-z0-9-]{1,80}$/).optional(),title:z.string(),rows:z.array(z.unknown()),minutes:z.string(),startedAt:z.string().nullable().default(null)}).passthrough();
export type RecordSummary={readonly id:string;readonly title:string;readonly updatedAt:string;readonly rowCount:number;readonly inputKind?:RecordInputKind;readonly durationSeconds?:number;readonly hasMinutes?:boolean};
type Input={readonly capture:()=>Snapshot;readonly apply:(value:Snapshot)=>void;readonly blockedReason:()=>string;readonly onTransition:(active:boolean)=>void};
class RecordSwitchError extends Error {constructor(message:string){super(message);this.name='RecordSwitchError';}}

function parseSnapshot(value:unknown):Snapshot {
 const parsed=snapshotSchema.parse(value);
 // The version-one envelope is validated here; existing readers validate optional checkpoints.
 return {...parsed,rows:readRows(parsed.rows)};
}

export function useRecordHistory(input:Input){
 const current=useRef(input);current.current=input;
 const id=useRef('');if(!id.current)id.current=crypto.randomUUID();const [activeRecordId,setActiveRecordId]=useState<string>(id.current);
 const [records,setRecords]=useState<readonly RecordSummary[]>([]);const [recordsLoading,setRecordsLoading]=useState(false);
 const [historyError,setHistoryError]=useState('');const [savingCount,setSavingCount]=useState(0);
 const transition=useRef(false);const pending=useRef(0);const queue=useRef<Promise<unknown>>(Promise.resolve());const refreshRevision=useRef(0);
 const latestSave=useRef<{readonly content:string;readonly promise:Promise<unknown>}|null>(null);
 const refreshRecords=async()=>{
  const revision=++refreshRevision.current;
  try{const result=listSchema.parse(await invoke('ko_list_records'));if(revision!==refreshRevision.current)return;setRecords(result.records);setHistoryError(result.warnings.join(' '));}
  catch(error){if(revision===refreshRevision.current)setHistoryError(error instanceof Error?error.message:String(error));throw error;}
 };
 const saveSnapshot=(value:Snapshot)=>{
  const content=JSON.stringify(value);
  // Only adjacent identical snapshots share a write: A → B → A must still save A last.
  if(latestSave.current?.content===content)return latestSave.current.promise;
  pending.current++;setSavingCount(pending.current);
  const next=queue.current.catch(()=>undefined).then(()=>invoke('ko_save_snapshot',{content})).catch(error=>{
   if(latestSave.current?.promise===next)latestSave.current=null;
   throw error;
  }).finally(()=>{pending.current--;setSavingCount(pending.current);});
  latestSave.current={content,promise:next};queue.current=next;return next;
 };
 const persist=()=>saveSnapshot({...current.current.capture(),recordId:id.current});
 const initialize=async()=>{
  setRecordsLoading(true);
  try{const value:unknown=await invoke('ko_load_snapshot');if(value){const parsed=parseSnapshot(value);id.current=parsed.recordId??id.current;setActiveRecordId(id.current);current.current.apply(parsed);}await refreshRecords();}
  finally{setRecordsLoading(false);}
 };
 const blockedReason=()=>transition.current?'기록을 여는 중입니다.':pending.current?'기록 저장이 끝난 뒤 다시 시도하세요.':current.current.blockedReason();
 const change=async(target:string|null)=>{
  const reason=blockedReason();if(reason)throw new RecordSwitchError(reason);
  if(target===id.current)return;
  transition.current=true;current.current.onTransition(true);setRecordsLoading(true);setHistoryError('');
  try{
   await persist();
   const next=target?parseSnapshot(await invoke('ko_load_record',{id:target})):{version:1,recordId:crypto.randomUUID(),title:'새 기록',rows:[],minutes:'',startedAt:null,glossary:current.current.capture().glossary} satisfies Snapshot;
   if(target&&next.recordId!==target)throw new RecordSwitchError('기록 식별자가 일치하지 않습니다.');
   const nextId=next.recordId??crypto.randomUUID();
   await saveSnapshot({...next,recordId:nextId});
   id.current=nextId;setActiveRecordId(nextId);current.current.apply(next);
   await refreshRecords();
  }catch(error){setHistoryError(error instanceof Error?error.message:String(error));throw error;}
  finally{transition.current=false;current.current.onTransition(false);setRecordsLoading(false);}
 };
 const rotate=async()=>{
  await persist();await refreshRecords();id.current=crypto.randomUUID();setActiveRecordId(id.current);
 };
 return {records,activeRecordId,recordsLoading,historyError,refreshRecords,newRecord:()=>change(null),openRecord:(target:string)=>change(target),
  initialize,persist,rotate,flush:()=>queue.current,isTransitioning:()=>transition.current,hasPendingSave:()=>pending.current>0,
  recordSwitchBlocked:recordsLoading||savingCount>0||Boolean(input.blockedReason()),recordSwitchBlockedReason:blockedReason()};
}

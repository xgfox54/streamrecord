'use client';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

type ModelInfo={readonly name:string;readonly display_name:string;readonly size_mb:number;readonly description:string;readonly status:{readonly type:string;readonly progress?:number}};
type Progress={readonly model:string;readonly progress?:number;readonly downloaded_mb?:number;readonly total_mb?:number;readonly status?:string;readonly error?:string};

const size=(mb:number)=>mb>=1024?`약 ${(mb/1024).toFixed(1)} GB`:`약 ${Math.round(mb)} MB`;

/** Built-in summary models: list, download, cancel and delete without leaving the Stream-Record screens. */
export function BuiltinModelPanel({session:s}:{readonly session:MeetingSession}){
 const [models,setModels]=useState<ModelInfo[]|null>(null);const [error,setError]=useState('');const [progress,setProgress]=useState<Record<string,Progress>>({});const [working,setWorking]=useState<string|null>(null);
 const alive=useRef(true);
 const load=async()=>{try{const list=await invoke<ModelInfo[]>('builtin_ai_list_models');if(alive.current)setModels(list);}catch(reason){if(alive.current){setModels([]);setError(`내장 요약 모델 목록을 읽지 못했습니다. ${s.messageOf(reason)}`);}}};
 const refreshFailed=(reason:unknown)=>{if(alive.current)setError(`요약 모델 선택 목록을 새로 고치지 못했습니다. AI 연결 화면을 다시 열어 주세요. ${s.messageOf(reason)}`);};
 useEffect(()=>{
  alive.current=true;void load();let stop:(()=>void)|undefined;
  void listen<Progress>('builtin-ai-download-progress',event=>{
   const item=event.payload;if(!alive.current)return;setProgress(value=>({...value,[item.model]:item}));
   if(item.status==='completed'||item.status==='cancelled'||item.status==='error'){void load();void s.refreshModels().catch(refreshFailed);}
  }).then(unlisten=>{if(alive.current)stop=unlisten;else unlisten();}).catch(reason=>{if(alive.current)setError(`내려받기 진행률을 받지 못합니다. 앱을 다시 열어 주세요. ${s.messageOf(reason)}`);});
  return()=>{alive.current=false;stop?.();};
  // Load once; refreshModels and messageOf are stable session helpers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const run=async(command:string,model:string,notice:string)=>{
  setWorking(model);setError('');
  try{await invoke(command,{modelName:model});if(alive.current)s.setNotice(notice);}
  catch(reason){const text=s.messageOf(reason);if(alive.current&&!text.startsWith('CANCELLED:'))setError(`${model}: ${text}`);}
  finally{if(alive.current){setWorking(null);setProgress(value=>{const {[model]:_done,...rest}=value;return rest;});await load();await s.refreshModels().catch(refreshFailed);}}
 };
 const remove=(model:ModelInfo)=>{if(window.confirm(`${model.display_name||model.name} 모델 파일을 이 PC에서 삭제할까요? 녹음과 회의록은 지워지지 않으며, 다시 내려받을 수 있습니다.`))void run('builtin_ai_delete_model',model.name,`${model.display_name||model.name} 모델을 삭제했습니다.`);};
 return <div aria-label="내장 요약 모델 관리">
  {models===null&&<p role="status">모델 목록을 확인하는 중입니다.</p>}
  {models!==null&&!models.length&&!error&&<p className={styles.hint}>내려받을 수 있는 내장 모델이 없습니다.</p>}
  {models!==null&&models.length>0&&<ul className={styles.builtinList}>{models.map(model=>{
   const live=progress[model.name];const downloading=model.status.type==='downloading'||live?.status==='downloading'||working===model.name&&model.status.type!=='available';
   const percent=Math.round(live?.progress??model.status.progress??0);const label=model.display_name||model.name;
   const state=downloading?`내려받는 중 ${percent}%`:model.status.type==='available'?'설치됨 · 사용 가능':model.status.type==='corrupted'?'파일 손상 · 다시 받아야 합니다':model.status.type==='error'?'오류 · 다시 받아 보세요':'설치 안 됨';
   return <li key={model.name}><div><strong>{label}</strong> <span className={styles.badge}>{state}</span></div><p className={styles.hint}>{size(model.size_mb)}{model.description?` · ${model.description}`:''}</p>
    {downloading&&<progress max={100} value={percent} aria-label={`${label} 내려받기 진행률`}/>}
    <div className={styles.actions}>
     {downloading?<button onClick={()=>void invoke('builtin_ai_cancel_download',{modelName:model.name}).then(()=>s.setNotice(`${label} 내려받기를 취소했습니다.`)).catch(reason=>setError(s.messageOf(reason)))}>내려받기 취소</button>
      :model.status.type==='available'?<button disabled={working!==null||s.busy} onClick={()=>remove(model)}>모델 삭제</button>
      :<button className={styles.primary} disabled={working!==null} onClick={()=>void run('builtin_ai_download_model',model.name,`${label} 모델을 내려받았습니다. 회의록·실시간 요약·AI 보정에서 선택할 수 있습니다.`)}>내려받기</button>}
    </div></li>;})}</ul>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}
 </div>;
}

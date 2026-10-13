'use client';
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import type {TranscriptRow} from '../meeting-ko/core';
import {correctTranscript,correctedText,correctionIssue,pendingCorrections,type CorrectionModel,type CorrectionSource} from '../meeting-ko/transcript-correction';
import {generateText,GenerationCancelled} from '../meeting-ko/generate-text';
import {useStoredFlag} from './useStoredFlag';
type CorrectionSession={readonly rows:TranscriptRow[];readonly rowsRef:MutableRefObject<TranscriptRow[]>;readonly setRows:(rows:TranscriptRow[])=>void;readonly model:CorrectionModel|undefined;readonly glossary:string;readonly epoch:number;readonly mode:string;readonly persist:()=>Promise<unknown>};
export function useTranscriptCorrection(input:CorrectionSession){
 const [enabled,setEnabled]=useStoredFlag('ai-correction',true);const [running,setRunning]=useState(false);const [error,setError]=useState('');const [tick,setTick]=useState(0);
 const [processing,setProcessing]=useState<readonly CorrectionSource[]>([]);
 const current=useRef(input);current.current=input;
 const inFlight=useRef(false);const controller=useRef<AbortController|null>(null);const lastTick=useRef(-1);const alive=useRef(true);
 const modelKey=input.model?`${input.model.provider}:${input.model.id}${input.model.revision?`@${input.model.revision}`:''}`:'';
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{
  controller.current?.abort();controller.current=new AbortController();setProcessing([]);setError('');lastTick.current=-1;
  const timer=enabled?window.setInterval(()=>setTick(value=>value+1),3000):null;
  return()=>{controller.current?.abort();if(timer!==null)window.clearInterval(timer);};
 },[enabled,modelKey,input.glossary,input.epoch]);
 useEffect(()=>{
  const chosen=input.model;const signal=controller.current?.signal;
  if(!enabled||!chosen||!signal||signal.aborted||inFlight.current||error||!['idle','recording'].includes(input.mode))return;
  const batch=pendingCorrections(input.rows,modelKey,input.glossary);if(!batch.length)return;
  if(lastTick.current===tick)return;
  lastTick.current=tick;inFlight.current=true;setRunning(true);setProcessing(batch);
  const epoch=input.epoch;const glossary=input.glossary;
  void correctTranscript({batch,rows:input.rows,glossary,modelKey,generate:text=>generateText({model:chosen.id,revision:chosen.revision,provider:chosen.provider,text,stage:'correction'},signal)}).then(async result=>{
   if(signal.aborted||!alive.current||current.current.epoch!==epoch)return;
   const next=current.current.rowsRef.current.map((row,index)=>{const item=result.find(value=>value.index===index&&value.source.text===row.text&&value.source.id===row.id&&value.source.sequence_id===row.sequence_id&&value.source.audio_start_time===row.audio_start_time&&value.source.chunk_start_time===row.chunk_start_time&&value.source.timestamp===row.timestamp);return item&&!row.is_partial?{...row,ai_correction:item.correction,ai_correction_issue:item.issue}:row;});
   current.current.setRows(next);await current.current.persist();
  }).catch(reason=>{if(!signal.aborted&&alive.current&&!(reason instanceof GenerationCancelled))setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{
   inFlight.current=false;if(alive.current){setRunning(false);setProcessing([]);}
  });
 },[enabled,error,tick,modelKey,input]);
 const finalRows=input.rows.filter(row=>!row.is_partial&&row.text.trim());
 const completed=finalRows.filter(row=>correctedText(row)!==null&&row.ai_correction?.model_key===modelKey&&row.ai_correction.glossary===input.glossary).length;
 const blockedRows=input.rows.flatMap((row,index)=>!row.is_partial&&row.text.trim()&&correctionIssue(row,modelKey,input.glossary)?[index]:[]);const blocked=blockedRows.length;
 const status=error?'보정 중단':running?'AI 보정 중':!enabled?'자동 보정 꺼짐':!input.model?'AI 연결 필요':!finalRows.length?'확정 문장 대기':completed===finalRows.length?(blocked?`전체 보정 완료 · 원음 확인 ${blocked}구간`:'전체 보정 완료'):'보정 대기';
 const retry=()=>{setError('');setTick(value=>value+1);};
 const runningRows=enabled?processing.flatMap(({index,row})=>{const currentRow=input.rows[index];return currentRow&&!currentRow.is_partial&&currentRow.text===row.text&&currentRow.id===row.id&&currentRow.sequence_id===row.sequence_id&&currentRow.audio_start_time===row.audio_start_time&&currentRow.chunk_start_time===row.chunk_start_time&&currentRow.timestamp===row.timestamp?[index]:[];}):[];
 return {enabled,setEnabled,running,runningRows,error,status,completed,blocked,blockedRows,total:finalRows.length,retry};
}

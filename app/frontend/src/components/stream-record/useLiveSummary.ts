'use client';
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {generateText,GenerationCancelled} from '../meeting-ko/generate-text';
import {summarySourceParts,updateLiveSummary,type LiveSummaryCheckpoint} from '../meeting-ko/live-summary';
import type {TranscriptRow} from '../meeting-ko/core';
import type {ModelOption} from './useMeetingSession';

type Input={rows:TranscriptRow[];model:ModelOption|undefined;glossary:string;epoch:number;mode:string;enabled:boolean;checkpoint:MutableRefObject<LiveSummaryCheckpoint|null>;onSummary:(text:string)=>void;persist:()=>Promise<unknown>;notice:(text:string)=>void};
export function useLiveSummary(input:Input){
 const [status,setStatus]=useState('확정 문장 대기');const [running,setRunning]=useState(false);const [tick,setTick]=useState(0);
 const current=useRef(input);current.current=input;const busy=useRef(false);const controller=useRef<AbortController|null>(null);const alive=useRef(true);const failed=useRef('');const completed=useRef('');
 const key=input.model?`${input.model.provider}:${input.model.id}@${input.model.revision??''}`:'';
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{controller.current?.abort();controller.current=new AbortController();failed.current='';completed.current='';if(!input.enabled)setStatus('요약 꺼짐');const timer=window.setInterval(()=>setTick(value=>value+1),5000);return()=>{controller.current?.abort();window.clearInterval(timer);};},[key,input.glossary,input.epoch,input.enabled]);
 useEffect(()=>{
  const chosen=input.model;const signal=controller.current?.signal;
  if(!input.enabled||!chosen||!signal||signal.aborted||busy.current||!['recording','idle'].includes(input.mode))return;
  const source=input.rows.filter(row=>!row.is_partial&&row.text.trim());if(!source.length){setStatus('확정 문장 대기');return;}
  const signature=JSON.stringify([key,input.glossary,summarySourceParts(source)]);if(failed.current===signature||completed.current===signature)return;
  const prefix=JSON.stringify(summarySourceParts(source));
  const stale=()=>signal.aborted||current.current.epoch!==input.epoch||current.current.glossary!==input.glossary||!current.current.enabled||current.current.model?.id!==chosen.id||current.current.model?.provider!==chosen.provider||current.current.model?.revision!==chosen.revision||JSON.stringify(summarySourceParts(current.current.rows.filter(row=>!row.is_partial&&row.text.trim()).slice(0,source.length)))!==prefix;
  busy.current=true;setRunning(true);setStatus('누적 요약 갱신 중');
  void updateLiveSummary({rows:source,modelKey:key,glossary:input.glossary,checkpoint:input.checkpoint.current,cancelled:stale,generate:text=>generateText({model:chosen.id,revision:chosen.revision,provider:chosen.provider,text,stage:'notes'},signal),save:async value=>{if(stale())throw new GenerationCancelled();input.checkpoint.current=value;current.current.onSummary(value.summary);await current.current.persist();}}).then(()=>{if(!stale()){completed.current=signature;setStatus('현재까지 누적 요약');}}).catch(reason=>{if(stale()||reason instanceof GenerationCancelled)return;failed.current=signature;setStatus('요약 실패');current.current.notice(`전사는 계속됩니다. 실시간 요약 실패: ${reason instanceof Error?reason.message:String(reason)}`);}).finally(()=>{busy.current=false;if(alive.current)setRunning(false);});
 },[tick,key,input]);
 return {status:!input.model&&input.enabled?'모델 없음':status,running};
}

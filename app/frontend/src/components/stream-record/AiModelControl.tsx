'use client';
import type {MeetingSession} from './useMeetingSession';
import {ModelOptions,modelDestination} from './connections/modelPresentation';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';

export function AiModelControl({session:s,showDestination=true}:{readonly session:MeetingSession;readonly showDestination?:boolean}){
 const chosen=s.models.find(model=>s.modelKey(model)===s.model);
 return <div className={layout.commonAi}>
  {s.models.length?<label className={layout.modelSelect}>사용할 AI<select value={s.model} disabled={s.mode==='summarizing'||s.liveSummaryRunning} onChange={event=>s.setModel(event.target.value)}><option value="">AI 선택</option><ModelOptions session={s}/></select></label>:<a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결하기</a>}
  <small>보정·요약·회의록에 함께 사용</small>
  {chosen&&showDestination&&<details><summary>AI 처리 위치</summary><p>{modelDestination(chosen)}</p></details>}
 </div>;
}

export function CorrectionStatus({session:s}:{readonly session:MeetingSession}){
 const correction=s.correction;const chosen=s.models.find(model=>s.modelKey(model)===s.model);
 const text=!correction.enabled?'보정 꺼짐':!chosen?'AI 연결 필요':correction.error?'보정 중단':correction.running?`보정 중 ${correction.completed}/${correction.total}`:correction.blocked?`원음 확인 ${correction.blocked}개`:correction.total&&correction.completed===correction.total?'보정 완료':correction.total?`보정 대기 ${correction.completed}/${correction.total}`:'문장 대기';
 return <span className={layout.aiStatus} role="status">{text}{correction.enabled&&!chosen&&<a href="#ai" onClick={()=>s.navigate('ai')}>연결하기</a>}</span>;
}

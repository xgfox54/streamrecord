'use client';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';
import {CorrectionStatus} from './AiModelControl';
import {segmentLabel} from '../meeting-ko/core';
function CorrectionNotice({correction,onReveal}:{readonly correction:MeetingSession['correction'];readonly onReveal:(index:number)=>void}){
 const link=(index:number,label:string,accessibleLabel?:string)=><a className={layout.issueLink} aria-label={accessibleLabel} href={`#dictation-row-${index}`} onClick={event=>{event.preventDefault();onReveal(index);}}>{label}</a>;
 const shown=correction.blockedRows.slice(0,10);
 const forceApply=()=>void correction.forceApply().then(applied=>{if(applied)onReveal(correction.blockedRows[0]??0);});
 if(correction.error)return <div role="alert" className={styles.error}><p>AI 보정을 멈췄습니다. 녹음과 원문은 유지됩니다. {correction.error}</p><button disabled={correction.blocked?!correction.canForceApply:!correction.enabled||correction.running} onClick={correction.blocked?forceApply:correction.retry}>{correction.blocked?'무시하고 보정 처리':'보정 다시 시도'}</button></div>;
 return correction.blocked>0?<div role="status" className={`${styles.information} ${layout.correctionNotice}`}><p>AI 보정을 취소한 문장이 {link(correction.blockedRows[0]??0,`${correction.blocked}구간`)} 있습니다 ({shown.map((index,i)=><span key={index}>{i>0?', ':''}{link(index,String(index+1),`${segmentLabel(index)}로 이동`)}</span>)}{correction.blocked>shown.length?` 외 ${correction.blocked-shown.length}구간`:''}).<br/>AI가 숫자를 바꾸었거나 문장 길이를 크게 바꿔서 원래 받아쓰기를 그대로 두었습니다.<br/>번호를 누르면 해당 문장으로 이동하니, 원음을 들어 맞는지 확인하세요. ‘무시하고 보정 처리’를 누르면 보류된 AI 문장을 적용합니다. 원문은 보존되며 나머지 문장은 정상적으로 보정합니다.</p><button disabled={!correction.canForceApply} onClick={forceApply}>무시하고 보정 처리</button></div>:null;
}
export function TranscriptOptions({session:s,corrected,compare,setCompare}:{readonly session:MeetingSession;readonly corrected:boolean;readonly compare:boolean;readonly setCompare:(value:boolean)=>void}){
 return <div className={layout.transcriptOptions} role="group" aria-label="받아쓰기 설정">
  <label className={styles.check}><input type="checkbox" checked={s.correction.enabled} onChange={event=>s.correction.setEnabled(event.target.checked)}/>AI 보정</label>
  <CorrectionStatus session={s}/>
  <label className={styles.check}><input type="checkbox" checked={s.diarization.enabled} onChange={event=>s.diarization.setEnabled(event.target.checked)}/>참여자 구분</label>
  <label className={styles.check} title="회의 내용과 영상 제목에 맞는 용어 세트를 AI 보정 참고용으로 선택합니다. 받아쓰기 원문에는 사용하지 않습니다."><input type="checkbox" checked={s.autoGlossary.enabled} onChange={event=>s.autoGlossary.setEnabled(event.target.checked)}/>용어 자동 선택</label>
  {corrected&&<label className={styles.check}><input type="checkbox" checked={compare} onChange={event=>setCompare(event.target.checked)}/>원문 함께 보기</label>}
 </div>;
}
export function TranscriptOptionNotes({session:s,showStatus,onReveal}:{readonly session:MeetingSession;readonly showStatus:boolean;readonly onReveal:(index:number)=>void}){
 const correction=s.correction;
 const transcriptLink=<a href="#transcript" onClick={()=>s.navigate('transcript')}>원음 듣기·직접 수정</a>;
 const slowdown=correction.enabled||s.diarization.enabled;
 return <div className={layout.optionNotes}>
  {slowdown&&<details className={layout.speedHelp}><summary>처리 속도와 원문 보존 안내</summary><p className={styles.hint} data-testid="option-speed-note">AI 보정과 참여자 구분은 기본으로 켜져 있어 받아쓰기가 느려질 수 있습니다. 더 빠르게 받아쓰려면 위의 ‘AI 보정’과 ‘참여자 구분’을 끄세요.<br/>기능을 꺼도 녹음과 원문은 그대로 보존되며, 선택은 다음 실행에도 유지됩니다.</p></details>}
  <CorrectionNotice correction={correction} onReveal={onReveal}/>
  {s.autoGlossary.message&&<p className={styles.hint} data-testid="auto-glossary-note">{s.autoGlossary.message}</p>}
  {s.diarization.enabled?s.mode==='recording'&&<p className={styles.hint}>{s.diarization.status}</p>:<p className={styles.hint}>실시간 참여자 구분이 꺼져 있습니다. 녹음 후 {transcriptLink}에서 전체 참여자 구분을 할 수 있습니다.</p>}
 </div>;
}

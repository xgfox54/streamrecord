'use client';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';
import {ModelOptions,modelDestination} from './connections/modelPresentation';
function CorrectionNotice({correction}:{readonly correction:MeetingSession['correction']}){
 if(correction.error)return <div role="alert" className={styles.error}><p>AI 보정을 멈췄습니다. 녹음과 원문은 유지됩니다. {correction.error}</p><button disabled={!correction.enabled||correction.running} onClick={correction.retry}>보정 다시 시도</button></div>;
 return correction.blocked>0?<div role="status" className={styles.information}><p>AI가 고친 문장 중 {correction.blocked}구간은 숫자가 바뀌었거나 길이가 크게 달라져서 적용하지 않고 원래 받아쓰기를 그대로 두었습니다. 나머지 구간은 정상적으로 보정합니다. 'AI 보정본'에서 ‘원음 확인’ 표시가 붙은 문장을 원음으로 들어 확인하세요.</p><button disabled={!correction.enabled||correction.running} onClick={correction.retry}>확인 구간 다시 보정</button></div>:null;
}
export function TranscriptOptions({session:s,corrected,compare,setCompare}:{readonly session:MeetingSession;readonly corrected:boolean;readonly compare:boolean;readonly setCompare:(value:boolean)=>void}){
 return <div className={layout.transcriptOptions} role="group" aria-label="받아쓰기 설정">
  <label className={styles.check}><input type="checkbox" checked={s.correction.enabled} onChange={event=>s.correction.setEnabled(event.target.checked)}/>AI 보정</label>
  {s.models.length>0&&<label className={layout.modelSelect}>보정 AI<select value={s.model} onChange={event=>s.setModel(event.target.value)}><option value="">AI 선택</option><ModelOptions session={s}/></select></label>}
  <label className={styles.check}><input type="checkbox" checked={s.diarization.enabled} onChange={event=>s.diarization.setEnabled(event.target.checked)}/>화자 구분</label>
  {corrected&&<label className={styles.check}><input type="checkbox" checked={compare} onChange={event=>setCompare(event.target.checked)}/>원문 함께 보기</label>}
 </div>;
}
export function TranscriptOptionNotes({session:s,showStatus}:{readonly session:MeetingSession;readonly showStatus:boolean}){
 const correction=s.correction;const chosen=s.models.find(model=>s.modelKey(model)===s.model);
 const onThisPc=chosen?.provider==='builtin'||chosen?.provider==='local';
 const transcriptLink=<a href="#transcript" onClick={()=>s.navigate('transcript')}>원음 듣기·직접 수정</a>;
 const slowdown=correction.enabled||s.diarization.enabled;
 return <div className={layout.optionNotes}>
  {slowdown&&<p className={styles.hint} data-testid="option-speed-note">AI 보정과 화자 구분은 기본으로 켜져 있어 받아쓰기가 느려질 수 있습니다. 더 빠르게 받아쓰려면 위의 ‘AI 보정’과 ‘화자 구분’을 끄세요. 꺼도 녹음과 원문은 그대로 보존되며, 선택은 다음 실행에도 유지됩니다.</p>}
  {correction.enabled&&!chosen&&<div role="status" className={styles.information}><p>AI 후보정 모델이 지정되지 않아 AI 보정을 하지 않습니다. 받아쓰기 원문은 그대로 저장되고, AI 보정본에는 원문이 표시됩니다. ChatGPT 계정 연결은 Plus 이상 유료 계정만 지원합니다.</p><a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결에서 보정 모델 선택</a></div>}
  {correction.enabled&&chosen&&<p className={styles.hint}>{showStatus?`AI 보정: ${correction.status}${correction.total>0?` · ${correction.completed}/${correction.total}구간`:''} · `:''}{chosen.id} · 전송 위치: {modelDestination(chosen)}{onThisPc?'. 이 PC에서 처리하므로 원격 AI를 선택하면 받아쓰기가 덜 느려집니다.':''}</p>}
  <CorrectionNotice correction={correction}/>
  {s.diarization.enabled?s.mode==='recording'&&<p className={styles.hint}>{s.diarization.status}</p>:<p className={styles.hint}>실시간 화자 구분이 꺼져 있습니다. 녹음 후 {transcriptLink}에서 전체 화자분리를 할 수 있습니다.</p>}
 </div>;
}

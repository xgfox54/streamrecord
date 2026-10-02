'use client';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';
import {ModelOptions,modelDestination,connectionLabel} from './connections/modelPresentation';
import compactStyles from './compact-reader.module.css';
function CorrectionNotice({correction}:{readonly correction:MeetingSession['correction']}){
 if(correction.error)return <div role="alert" className={styles.error}><p>AI 보정을 멈췄습니다. 녹음과 원문은 유지됩니다. {correction.error}</p><button disabled={!correction.enabled||correction.running} onClick={correction.retry}>보정 다시 시도</button></div>;
 return correction.blocked>0?<div role="status" className={styles.information}><p>숫자·길이 보호로 {correction.blocked}구간의 원문을 유지했습니다. 다른 구간은 독립적으로 보정합니다. 대화에서 확인 사유를 보고 원음과 대조하세요.</p><button disabled={!correction.enabled||correction.running} onClick={correction.retry}>확인 구간 다시 보정</button></div>:null;
}
export function CorrectionControls({session:s,compact=false}:{readonly session:MeetingSession;readonly compact?:boolean}){
 const chosen=s.models.find(model=>s.modelKey(model)===s.model);const correction=s.correction;
 if(compact)return <details className={compactStyles.options}>
  <summary>AI 보정 {correction.enabled?'켜짐':'설정'}</summary>
  <div className={compactStyles.optionBody}>
   <label className={styles.check}><input type="checkbox" checked={correction.enabled} disabled={!chosen} onChange={event=>correction.setEnabled(event.target.checked)}/>확정 문장 자동 보정</label>
   {s.models.length>0&&<label>보정 AI<select value={s.model} onChange={event=>s.setModel(event.target.value)}><option value="">AI 선택</option><ModelOptions session={s}/></select></label>}
   <p className={styles.hint}>{chosen?<>{chosen.id} · {connectionLabel(chosen)} · 전송 위치: {modelDestination(chosen)}</>:<>AI 연결 없이도 받아쓸 수 있습니다.</>}</p>
   <p className={styles.hint}>자동 보정을 켜면 현재 대화와 새 확정 문장·용어집을 처리합니다. <a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결·전송 위치 확인</a></p>
   <CorrectionNotice correction={correction}/>
  </div>
 </details>;
 return <div className={layout.aiControls}>
  <div className={layout.aiToolbar}>
   <label className={styles.check}><input type="checkbox" checked={correction.enabled} disabled={!chosen} onChange={event=>correction.setEnabled(event.target.checked)}/>확정 문장 자동 보정</label>
   <span className={styles.badge} role="status">{correction.status}{chosen&&correction.total>0?` · ${correction.completed}/${correction.total}구간`:''}</span>
   <details className={layout.aiOptions}><summary>보정 AI 설정</summary><div>
    {s.models.length>0&&<label>보정 AI<select value={s.model} onChange={event=>s.setModel(event.target.value)}><option value="">AI 선택</option><ModelOptions session={s}/></select></label>}
    <p className={styles.hint}>자동 보정을 켜면 현재 대화와 새 확정 문장·용어집을 처리합니다. <a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결·전송 위치 확인</a></p>
   </div></details>
  </div>
  <p className={styles.hint}>{!chosen?<>AI 연결 없이도 받아쓸 수 있습니다. <a href="#ai" onClick={()=>s.navigate('ai')}>보정에 사용할 AI 연결하기</a></>:<>{chosen.id} · {connectionLabel(chosen)} · 전송 위치: {modelDestination(chosen)}</>}</p>
  <CorrectionNotice correction={correction}/>
 </div>;
}

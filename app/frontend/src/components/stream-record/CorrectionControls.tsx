'use client';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';
import {ModelOptions,modelDestination,connectionLabel} from './connections/modelPresentation';
export function CorrectionControls({session:s}:{readonly session:MeetingSession}){
 const chosen=s.models.find(model=>s.modelKey(model)===s.model);const correction=s.correction;
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
  {correction.error&&<div role="alert" className={styles.error}><p>AI 보정을 멈췄습니다. 녹음과 원문은 유지됩니다. {correction.error}</p><button disabled={!correction.enabled||correction.running} onClick={correction.retry}>보정 다시 시도</button></div>}
 </div>;
}

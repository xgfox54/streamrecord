'use client';
import {Mic,Square,Settings2} from 'lucide-react';
import {microphoneInputs,timestamp} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import {DictationConversation} from './DictationConversation';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';

export function DictationView({session:s}:{readonly session:MeetingSession}){
 const inputs=microphoneInputs(s.devices);const microphone=inputs.some(input=>input.name===s.microphone)?s.microphone:inputs[0]?.name??'';
 const disabledReason=!s.ready?'앱과 입력 장치를 확인 중입니다.':s.busy?'진행 중인 작업이 끝난 뒤 새 받아쓰기를 시작할 수 있습니다.':!microphone?'사용 가능한 마이크가 없습니다. 녹음 옵션에서 장치를 확인하세요.':!s.consent?'아래 녹음·처리 권한을 확인해 주세요.':'';
 return <div className={layout.page}>
  <section className={`${styles.panel} ${layout.preparation}`} aria-label="받아쓰기 준비">
   <div className={layout.toolbar}><div className={layout.recordState}><Mic size={21} aria-hidden="true"/><strong>{s.mode==='recording'?'받아쓰는 중':s.title}</strong><time>{timestamp(s.elapsed)}</time></div>
    <details className={layout.options}><summary><Settings2 size={18} aria-hidden="true"/>녹음 옵션</summary><div className={layout.optionFields}>
     <label>받아쓰기 제목<input value={s.title} maxLength={100} disabled={s.busy} onChange={event=>s.setTitle(event.target.value)}/></label>
     <label>마이크<select value={microphone} disabled={s.busy} onChange={event=>s.setMicrophone(event.target.value)}><option value="">사용 가능한 입력 없음</option>{inputs.map(input=><option key={input.name} value={input.name}>{input.name}</option>)}</select></label>
     <label>AI 보정에 참고할 용어<input value={s.glossary} maxLength={500} disabled={s.busy} placeholder="사람 이름 · 기관명 · 전문 용어" onChange={event=>s.setGlossary(event.target.value)}/></label>
     <button disabled={s.busy} onClick={()=>void s.refreshDevices().catch(error=>s.setError(s.messageOf(error)))}>장치 새로고침</button>
    </div></details>
    {s.mode==='recording'?<button className={styles.primary} onClick={()=>void s.stop()}><Square size={20} aria-hidden="true"/>받아쓰기 중지 및 저장</button>:<button className={styles.primary} disabled={Boolean(disabledReason)} aria-describedby="dictation-start-help" onClick={()=>{s.setRecordingKind('microphone');void s.start(microphone,'받아쓰기를 시작했습니다. 확정된 문장은 AI 자동 보정을 켜면 순서대로 처리됩니다.');}}><Mic size={20} aria-hidden="true"/>{s.mode==='starting'?'음성 모델 준비 중…':s.mode==='stopping'?'마지막 문장 저장 중…':'받아쓰기 시작'}</button>}
   </div>
   <label className={styles.check}><input type="checkbox" checked={s.consent} disabled={s.busy} onChange={event=>s.setConsent(event.target.checked)}/>참여자에게 녹음을 알렸으며 녹음·처리 권한을 확인했습니다.</label>
   <p id="dictation-start-help" className={styles.hint}>{disabledReason||`입력: ${microphone} · 동봉된 한국어 Whisper로 이 PC에서 받아씁니다.`}</p>
  </section>
  <DictationConversation session={s}/>
 </div>;
}

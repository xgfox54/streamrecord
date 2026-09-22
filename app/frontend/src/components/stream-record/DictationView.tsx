'use client';
import {Mic,Square} from 'lucide-react';
import {microphoneInputs} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import {LiveTranscriptPanel} from './LiveTranscriptPanel';
import styles from '../meeting-ko/workspace.module.css';

export function DictationView({session:s}:{session:MeetingSession}){
 const inputs=microphoneInputs(s.devices);const microphone=inputs.some(input=>input.name===s.microphone)?s.microphone:inputs[0]?.name??'';
 const disabledReason=!s.ready?'앱과 입력 장치를 확인 중입니다.':s.busy?'진행 중인 작업이 끝난 뒤 새 받아쓰기를 시작할 수 있습니다.':!microphone?'사용 가능한 마이크가 없습니다.':!s.consent?'녹음·처리 권한을 확인해 주세요.':'';
 return <div className={styles.viewStack}><section className={styles.panel} aria-label="받아쓰기 준비"><div className={styles.formGrid}><label>받아쓰기 제목<input value={s.title} maxLength={100} disabled={s.busy} onChange={event=>s.setTitle(event.target.value)}/></label><label>마이크<select value={microphone} disabled={s.busy} onChange={event=>s.setMicrophone(event.target.value)}><option value="">사용 가능한 입력 없음</option>{inputs.map(input=><option key={input.name} value={input.name}>{input.name}</option>)}</select></label></div>
  <label className={styles.check}><input type="checkbox" checked={s.consent} disabled={s.busy} onChange={event=>s.setConsent(event.target.checked)}/>발화자에게 녹음을 알렸으며 녹음·처리 권한을 확인했습니다.</label>
  <div className={styles.actions}>{s.mode==='recording'?<button className={styles.primary} onClick={()=>void s.stop()}><Square size={20} aria-hidden="true"/>받아쓰기 중지 및 저장</button>:<button className={styles.primary} disabled={Boolean(disabledReason)} aria-describedby="dictation-start-help" onClick={()=>{s.setRecordingKind('microphone');void s.start(microphone,'받아쓰기를 시작했습니다. 말하는 내용이 아래에 실시간으로 표시됩니다.');}}><Mic size={20} aria-hidden="true"/>받아쓰기 시작</button>}<button disabled={s.busy} onClick={()=>void s.refreshDevices().catch(error=>s.setError(s.messageOf(error)))}>장치 새로고침</button></div><p id="dictation-start-help" className={styles.hint}>{disabledReason||'동봉된 한국어 음성 모델로 처리하며 네트워크 다운로드가 필요하지 않습니다.'}</p></section>
  <LiveTranscriptPanel session={s}/></div>;
}

import {timestamp} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import styles from './guidance.module.css';

export function SessionProgress({session:s}:{readonly session:MeetingSession}) {
  const running = s.mode === 'recording';
  return <div className={styles.sessionProgress} aria-label="현재 녹음 상태">
    <div><span className={running?styles.recordingState:styles.readyState}>{s.modeLabel}</span><strong className={styles.clock} aria-label="녹음 경과 시간">{s.hasRecordingStart?timestamp(s.elapsed):'00:00:00'}</strong></div>
    <p>받아쓴 문장 <strong>{s.rows.filter(row=>!row.is_partial).length}구간</strong></p>
    <a href="#transcript" onClick={()=>s.navigate('transcript')}>전체 결과 보기</a>
  </div>;
}

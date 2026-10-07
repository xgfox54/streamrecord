import {importDuration,remainingImportTime} from './import-progress';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

export function FileImportProgress({session:s}:{readonly session:MeetingSession}){
 const remaining=remainingImportTime(s.importProgress,s.importElapsed);
 const estimate=s.importProgress?.timing?.estimated_total_seconds;
 const saving=s.importProgress?.stage==='saving'||s.importProgress?.stage==='complete';
 return <section aria-label="녹음파일 처리 진행" className={styles.panel}>
  <label>파일 받아쓰기 {Math.round(s.progress)}%<progress value={s.progress} max={100}/></label>
  <p>경과 시간: {s.importStarted?importDuration(s.importElapsed):'준비 중'}</p>
  <p>예상 전체 처리 시간: {estimate!=null?`약 ${importDuration(estimate)}`:saving?'받아쓰기 완료 · 결과 저장 중':'처리 속도를 확인하고 있습니다.'}<br/>
   남은 시간: {saving?'받아쓰기를 마쳤습니다. 결과를 저장하고 있습니다.':remaining!=null?`약 ${importDuration(remaining)}`:estimate!=null?'처리 중 · 예상 시간을 다시 계산하고 있습니다.':'첫 구간을 처리한 뒤 계산합니다.'}</p>
  <p className={styles.hint}>현재 처리 속도에 따른 예상 시간이며 달라질 수 있습니다. 받아쓰기 텍스트는 모든 처리가 끝난 뒤 표시합니다. AI 보정 시간은 별도입니다.</p>
 </section>;
}

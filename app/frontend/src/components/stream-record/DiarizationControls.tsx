import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import compactStyles from './compact-reader.module.css';
export function DiarizationControls({session:s,compact=false}:{readonly session:MeetingSession;readonly compact?:boolean}){
 return <details className={compact?compactStyles.options:styles.disclosure}>
  <summary>{compact?'참여자 구분':'실시간·저장 음성 참여자 구분'}</summary>
  <div className={compact?compactStyles.optionBody:undefined}>
   <p>녹음 중에는 자동 저장된 30초 음성 구간으로 참여자를 구분합니다. 표시되는 번호는 임시 추정이며 이름이나 신원을 뜻하지 않습니다. 녹음 종료 후 저장 음성 전체를 분석해 확인할 수 있습니다. 한 받아쓰기 구간에 여러 참여자가 있으면 함께 표시합니다.</p>
   <p data-testid="diarization-limit-detail">참여자 구분은 최대 8명까지 가능합니다. 참여자가 8명보다 많으면 일부 발언은 번호가 표시되지 않거나 정확하지 않을 수 있습니다.</p>
   <div className={styles.actions}>
    <button disabled={s.busy} onClick={()=>void s.prepareAudio(false)}>참여자를 구분할 원음 연결</button>
    <button disabled={s.busy||!s.audioSource||!s.rows.length} onClick={()=>void s.diarization.run()}>참여자 구분 실행</button>
    {s.diarization.running&&<button onClick={s.diarization.cancel}>참여자 구분 취소</button>}
   </div>
   <p role="status">{s.diarization.status}</p>
  </div>
 </details>;
}

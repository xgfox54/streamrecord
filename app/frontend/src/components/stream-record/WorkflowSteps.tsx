import {CheckIcon} from '../jeju/jeju-icons';
import type {MeetingSession} from './useMeetingSession';
import styles from './guidance.module.css';

export function WorkflowSteps({session:s}:{readonly session:MeetingSession}) {
  const current = s.mode === 'recording' || s.mode === 'stopping' ? 1 : s.rows.length ? 2 : 0;
  return <ol className={styles.steps} aria-label="녹음 이용 순서">
    {['입력 준비', '녹음·받아쓰기', '결과 확인'].map((label,index)=><li key={label} aria-current={index===current?'step':undefined} data-complete={index<current}>
      <span className={styles.stepNumber} aria-hidden="true">{index<current?<CheckIcon/>:index+1}</span>
      <span>{label}<small>{index===current?'현재 단계':index<current?'완료':'다음 단계'}</small></span>
    </li>)}
  </ol>;
}

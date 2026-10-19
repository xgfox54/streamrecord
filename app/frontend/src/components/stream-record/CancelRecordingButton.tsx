import {X} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

export function CancelRecordingButton({session:s}:{readonly session:MeetingSession}){
 if(s.mode!=='recording'&&s.mode!=='stopping'&&s.mode!=='cancelling')return null;
 return <button className={styles.dangerButton} disabled={s.mode==='cancelling'} title="남은 받아쓰기와 최종 저장을 중단합니다. 이미 저장한 자료는 유지합니다." onClick={()=>void s.cancelRecording()}><X size={18} aria-hidden="true"/>{s.mode==='cancelling'?'취소 중':s.mode==='stopping'?'저장 취소':'녹음 취소'}</button>;
}

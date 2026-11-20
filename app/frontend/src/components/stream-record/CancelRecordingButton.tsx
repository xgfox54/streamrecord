import {useEffect,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

export function CancelRecordingButton({session:s}:{readonly session:MeetingSession}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{if(s.mode!=='recording'&&s.mode!=='stopping')setOpen(false);},[s.mode]);
 if(s.mode!=='recording'&&s.mode!=='stopping'&&s.mode!=='cancelling')return null;
 return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button className={styles.dangerButton} disabled={s.mode==='cancelling'} title="남은 받아쓰기와 최종 저장을 중단합니다. 이미 저장한 자료는 유지합니다."><X size={18} aria-hidden="true"/>{s.mode==='cancelling'?'취소 중':s.mode==='stopping'?'저장 취소':'녹음 취소'}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className={styles.dialogOverlay}/><Dialog.Content className={styles.workspace+' '+styles.dialog}><Dialog.Title>남은 처리를 중단할까요?</Dialog.Title><Dialog.Description>이미 저장한 음성과 받아쓰기는 유지합니다. 남은 받아쓰기와 최종 저장은 중단합니다.</Dialog.Description><div className={styles.actions}><Dialog.Close asChild><button>돌아가기</button></Dialog.Close><button className={styles.dangerButton} onClick={()=>{setOpen(false);void s.cancelRecording();}}>남은 처리 중단</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

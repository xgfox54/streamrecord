'use client';
import {useRef} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
export function SessionDialog({session:s}:{session:MeetingSession}){
 const keep=useRef<HTMLButtonElement>(null);const returnFocus=useRef<HTMLElement|null>(null);const blocked=s.mode!=='idle'&&s.mode!=='recording';
 return <Dialog.Root open={s.exitOpen} onOpenChange={open=>{if(!s.exiting)s.setExitOpen(open);}}><Dialog.Portal><Dialog.Overlay className={styles.dialogOverlay}/><Dialog.Content className={`${styles.workspace} ${styles.dialog}`} onOpenAutoFocus={event=>{event.preventDefault();returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;keep.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();if(returnFocus.current?.isConnected)returnFocus.current.focus();else document.getElementById('workspace-content')?.querySelector('h1')?.focus();}} onEscapeKeyDown={event=>{if(s.exiting)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()}>
  <Dialog.Title className={styles.dialogTitle}>Stream-Record를 종료할까요?</Dialog.Title><Dialog.Description>{s.mode==='recording'?'녹음을 중지하고 마지막 음성 처리와 원문·회의록 저장을 마친 뒤 앱을 완전히 종료합니다.':blocked?'진행 중인 처리를 먼저 마쳐야 합니다. 현재 구간 후 취소를 선택한 경우에도 저장이 끝날 때까지 기다려 주세요.':'최근 작업과 원문·검토본·회의록을 저장한 뒤 앱을 완전히 종료합니다.'}</Dialog.Description>
  {s.stopFailure&&<div className={styles.error}><div><strong>원음 저장을 보장할 수 없습니다.</strong><p>{s.stopFailure}</p><label className={styles.check}><input type="checkbox" checked={s.acknowledgeStopFailure} onChange={event=>s.setAcknowledgeStopFailure(event.target.checked)}/>원음 저장 실패 가능성을 확인했습니다. 화면의 전사·회의록을 보존한 뒤 종료합니다.</label></div></div>}
  {s.error&&<p role="alert" className={styles.error}>{s.error}</p>}<div className={styles.actions}><button ref={keep} disabled={s.exiting} onClick={()=>s.setExitOpen(false)}>계속 사용</button><button className={styles.dangerButton} disabled={blocked||s.exiting||Boolean(s.stopFailure&&!s.acknowledgeStopFailure)} onClick={()=>void s.confirmExit()}>{s.exiting?'저장 후 종료하는 중…':s.mode==='recording'?'녹음을 중지하고 저장한 뒤 종료':s.stopFailure?'전사·회의록을 보존하고 종료':'저장하고 완전히 종료'}</button></div>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

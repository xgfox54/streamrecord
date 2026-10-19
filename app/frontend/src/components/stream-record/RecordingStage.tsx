'use client';
import {Mic,Pause,Play,Square} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import {CancelRecordingButton} from './CancelRecordingButton';
import styles from './studio.module.css';
export function RecordingStage({session:s}:{readonly session:MeetingSession}){
 const running=s.mode==='recording';
 return <section className={styles.recordingStage} aria-label="녹음 조작"><span className={styles.recordStatus}>{s.paused?'일시 정지':s.modeLabel}</span><div className={styles.clock} aria-label="녹음 시간">{Math.floor(s.elapsed/60).toString().padStart(2,'0')}:{Math.floor(s.elapsed%60).toString().padStart(2,'0')}</div><p className={styles.inputCaption}><Mic size={16}/>{s.recordingInput==='microphone'?s.microphone:'PC 소리'} · {s.paused?'녹음을 잠시 멈췄습니다':running?'녹음하고 있습니다':'남은 음성과 받아쓰기를 처리하고 있습니다'}</p><div className={styles.wave} data-active={running&&!s.paused} aria-hidden="true">{Array.from({length:64},(_,index)=><i key={index} style={{height:`${10+(index*17%53)}px`,animationDelay:`${-index*.09}s`}}/>)}</div><div className={styles.stageActions}><button disabled={!running||s.pausePending} onClick={()=>void s.togglePause()}>{s.paused?<Play size={18}/>:<Pause size={18}/>} {s.paused?'녹음 계속하기':'일시 정지'}</button><button className={styles.primary} disabled={!running} onClick={()=>void s.stop()}><Square size={18}/>{running?'저장하고 종료':'저장 처리 중'}</button></div><div className={styles.cancelRow}><p>{running?'화면을 나가도 녹음은 계속됩니다.':'저장이 끝나기 전에도 취소할 수 있습니다.'}</p><CancelRecordingButton session={s}/></div></section>;
}

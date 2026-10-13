'use client';
import {convertFileSrc} from '@tauri-apps/api/core';
import {segmentLabel} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
export function OriginalAudioPlayer({session:s}:{readonly session:MeetingSession}){
 if(!s.audioSource)return null;
 return <div className={styles.audioPanel}><p className={styles.hint} role="status">{s.playbackIndex===null?`연결된 원음: ${s.audioSource.filename}`:`${segmentLabel(s.playbackIndex)} · ${s.audioPlaying?'원음 재생 중':'원음 일시정지'}`}</p><audio ref={s.audioElement} controls preload="metadata" src={convertFileSrc(s.audioSource.path)} onLoadedMetadata={()=>s.resumePlayback()} onPlay={()=>{if(s.modeRef.current!=='idle')s.pausePlayback();else s.setAudioPlaying(true);}} onPause={()=>s.setAudioPlaying(false)} onEnded={s.stopPlayback} onTimeUpdate={()=>{const player=s.audioElement.current;if(player&&s.playbackEnd.current!==null&&player.currentTime>=s.playbackEnd.current)s.stopPlayback();}} onError={()=>{s.stopPlayback();s.setError('원음 재생 실패. 지원하는 음성 파일인지 확인하고 다시 선택하세요.');}} aria-label="연결한 원본 음성 재생"/></div>;
}

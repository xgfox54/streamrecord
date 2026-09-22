'use client';
import {Link2,Play,Square,Youtube} from 'lucide-react';
import {stereoMixName} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import {LiveTranscriptPanel} from './LiveTranscriptPanel';
import {LiveSummaryPanel} from './LiveSummaryPanel';
import styles from '../meeting-ko/workspace.module.css';

export function YoutubeView({session:s}:{session:MeetingSession}){
 const stereo=stereoMixName(s.devices);
 const disabledReason=!s.ready?'앱과 입력 장치를 확인 중입니다.':s.busy?'진행 중인 작업이 끝난 뒤 새 영상 전사를 시작할 수 있습니다.':!stereo?'Stereo Mix 입력을 찾지 못했습니다. Windows 녹음 장치에서 활성화해 주세요.':!s.videoUrl.trim()?'YouTube 링크를 입력해 주세요.':!s.consent?'녹음·처리 권한을 확인해 주세요.':'';
 return <div className={styles.youtubeLayout}><section className={styles.panel} aria-label="YouTube 영상 준비"><label>YouTube 링크<input type="url" value={s.videoUrl} maxLength={500} disabled={s.busy} placeholder="https://www.youtube.com/watch?v=…" onChange={event=>s.setVideoUrl(event.target.value)} aria-describedby="youtube-help"/></label><p id="youtube-help" className={styles.hint}>영상은 내려받지 않습니다. 앱 안의 플레이어를 직접 재생하고 소리를 켜 두세요. Stereo Mix로 실제 재생 소리만 녹음합니다.</p>
  <div className={styles.actions}><button disabled={s.busy||!s.videoUrl.trim()} onClick={()=>void s.prepareVideo()}><Link2 size={18} aria-hidden="true"/>영상 불러오기</button></div>
  <div className={styles.mediaFrame}>{s.videoEmbedUrl?<iframe src={s.videoEmbedUrl} title="전사할 YouTube 영상" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>:<div className={styles.mediaPlaceholder}><Youtube size={40} aria-hidden="true"/><p>링크를 확인하면 영상이 이곳에 표시됩니다.</p></div>}</div>
  <label className={styles.check}><input type="checkbox" checked={s.consent} disabled={s.busy} onChange={event=>s.setConsent(event.target.checked)}/>콘텐츠를 녹음·처리할 권한이 있음을 확인했습니다.</label>
  <div className={styles.actions}>{s.mode==='recording'?<button className={styles.primary} onClick={()=>void s.stop()}><Square size={20} aria-hidden="true"/>영상 전사 중지 및 저장</button>:<button className={styles.primary} disabled={Boolean(disabledReason)} aria-describedby="youtube-start-help" onClick={()=>void s.startVideo()}><Play size={20} aria-hidden="true"/>영상 녹음·전사 시작</button>}<button disabled={s.busy} onClick={()=>void s.refreshDevices().catch(error=>s.setError(s.messageOf(error)))}>장치 새로고침</button></div><p id="youtube-start-help" className={styles.hint}>{disabledReason||`입력 장치: ${stereo}. 녹음 시작 뒤 플레이어에서 영상을 재생하세요.`}</p></section>
  <div className={styles.youtubeResults}><LiveTranscriptPanel session={s}/><LiveSummaryPanel session={s}/></div></div>;
}

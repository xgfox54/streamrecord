'use client';
import {Link2,Play,Square,Youtube} from 'lucide-react';
import {stereoMixName} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import {DictationConversation} from './DictationConversation';
import {LiveSummaryPanel} from './LiveSummaryPanel';
import {SessionProgress} from './SessionProgress';
import styles from '../meeting-ko/workspace.module.css';

export function YoutubeView({session:s}:{readonly session:MeetingSession}) {
  const stereo=stereoMixName(s.devices);
  const reason=!s.ready?'입력 장치를 확인하고 있습니다.':s.busy?'현재 작업을 마치면 다시 시작할 수 있습니다.':!stereo?'PC 소리 입력(Stereo Mix)이 없습니다. 아래 장치 도움말을 확인하세요.':!s.videoEmbedUrl?'먼저 링크를 입력하고 영상 불러오기를 눌러 주세요.':!s.consent?'녹음·처리 권한을 확인해 주세요.':'';
  return <div className={styles.viewStack}>
    <SessionProgress session={s}/>
    <div className={styles.youtubeLayout}>
      <section className={styles.panel} aria-label="YouTube 영상 준비">
        <h2>1. 영상 링크를 불러오세요</h2>
        <label>YouTube 링크<input type="url" value={s.videoUrl} maxLength={500} disabled={s.busy} placeholder="https://www.youtube.com/watch?v=…" onChange={event=>s.setVideoUrl(event.target.value)} aria-describedby="youtube-help"/></label>
        <div className={styles.actions}><button disabled={s.busy||!s.videoUrl.trim()} onClick={()=>void s.prepareVideo()}><Link2 size={18} aria-hidden="true"/>영상 불러오기</button></div>
        <p id="youtube-help" className={styles.hint}>영상은 내려받지 않습니다. 녹음을 먼저 시작한 뒤, 아래 플레이어에서 원하는 위치부터 재생하세요.</p>
        <div className={styles.mediaFrame}>{s.videoEmbedUrl?<iframe src={s.videoEmbedUrl} title="전사할 YouTube 영상" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>:<div className={styles.mediaPlaceholder}><Youtube size={40} aria-hidden="true"/><p>링크를 불러오면 영상이 여기에 표시됩니다.</p></div>}</div>
        <h2>2. 녹음을 시작한 뒤 영상을 재생하세요</h2>
        <label className={styles.check}><input type="checkbox" checked={s.consent} disabled={s.busy} onChange={event=>s.setConsent(event.target.checked)}/>콘텐츠를 녹음·처리할 권한이 있음을 확인했습니다.</label>
        <div className={styles.actions}>{s.mode==='recording'?<button className={styles.primary} onClick={()=>void s.stop()}><Square size={20} aria-hidden="true"/>영상 전사 중지 및 저장</button>:<button className={styles.primary} disabled={Boolean(reason)} aria-describedby="youtube-start-help" onClick={()=>void s.startVideo()}><Play size={20} aria-hidden="true"/>{s.mode==='starting'?'음성 모델 준비 중…':s.mode==='stopping'?'마지막 문장 저장 중…':'영상 녹음·전사 시작'}</button>}</div>
        <p id="youtube-start-help" className={styles.hint}>{reason||`입력: ${stereo}. 녹음 시작 → 플레이어 재생 → 끝나면 중지 및 저장 순서입니다.`}</p>
        <p className={styles.hint}>플레이어 음소거를 해제하고 PC 음량을 켜 주세요. 다른 영상·알림 소리도 함께 녹음되므로 꺼 주세요. 메뉴를 이동해도 영상은 유지됩니다.</p>
        <details className={styles.disclosure} open={s.ready&&!stereo}><summary>PC 소리가 녹음되지 않나요?</summary><p>Windows 설정 → 시스템 → 소리 → 더 많은 소리 설정 → 녹음에서 스테레오 믹스를 사용으로 설정하세요. 장치가 지원하지 않는 PC는 녹음파일 첨부를 이용하세요.</p><button disabled={s.busy} onClick={()=>void s.refreshDevices().catch(error=>s.setError(s.messageOf(error)))}>장치 새로고침</button></details>
      </section>
      <DictationConversation session={s}/>
      <LiveSummaryPanel session={s}/>
    </div>
  </div>;
}

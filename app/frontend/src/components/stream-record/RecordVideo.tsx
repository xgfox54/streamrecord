'use client';
import {Link2,Youtube} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import {CaptureActions} from './RecordToolbar';
import layout from './record-controls.module.css';
export function RecordVideo({session:s}:{readonly session:MeetingSession}){
 return <section className={layout.video} aria-label="YouTube 영상">
  <div className={layout.videoLink}><label><span><Youtube size={18} aria-hidden="true"/>YouTube 링크</span><input id="record-video-url" type="url" value={s.videoUrl} maxLength={500} disabled={s.busy} placeholder="https://www.youtube.com/watch?v=…" onChange={event=>s.setVideoUrl(event.target.value)}/></label><button disabled={s.busy||!s.videoUrl.trim()} onClick={()=>void s.prepareVideo()}><Link2 size={18} aria-hidden="true"/>영상 불러오기</button></div>
  <div className={layout.player}>{s.videoEmbedUrl?<iframe width="1280" height="720" src={s.videoEmbedUrl} title="전사할 YouTube 영상" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>:<div className={layout.placeholder}><Youtube size={32} aria-hidden="true"/><p>링크를 불러오면 영상이 표시됩니다.</p><p>녹음을 시작한 뒤 영상의 재생 버튼을 눌러 주세요.</p></div>}</div>
  <div className={layout.videoActions}><CaptureActions session={s} input="youtube"/></div>
 </section>;
}

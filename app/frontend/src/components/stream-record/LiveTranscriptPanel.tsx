'use client';
import {SpeakerLabel} from './SpeakerLabel';
import {useEffect,useRef} from 'react';
import {ArrowDown,MessageSquareText} from 'lucide-react';
import {rowTime} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';

export function LiveTranscriptPanel({session:s}:{readonly session:MeetingSession}){
 const scroll=useRef<HTMLDivElement>(null);
 const recent=s.rows.slice(-80);
 useEffect(()=>{if(s.follow&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[recent,s.follow]);
 return <section className={`${styles.panel} ${styles.liveTranscriptPanel} ${layout.conversation}`} data-testid="live-transcript" aria-label="실시간 전사">
  <div className={styles.panelHead}><div><p className={styles.eyebrow}>실시간</p><h2>받아쓰기 <span className={styles.badge}>{s.rows.length}구간</span></h2></div><button disabled={!s.rows.length} onClick={()=>{s.setFollow(true);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;}}><ArrowDown size={18} aria-hidden="true"/>최신 문장</button></div>
  <div ref={scroll} className={layout.reader} tabIndex={0} role="log" aria-live="off" aria-label="녹음 중 전사 내용" onScroll={event=>{const element=event.currentTarget;if(element.scrollHeight-element.scrollTop-element.clientHeight>64)s.setFollow(false);}}>
   {!recent.length&&<div className={layout.empty}><MessageSquareText size={30} aria-hidden="true"/><h3>녹음을 시작하면 여기에 표시됩니다</h3><p>말하는 동안 마지막 문장이 이어서 입력되고, 인식이 끝나면 확정 문장으로 남습니다.</p></div>}
   {recent.map(row=><article key={row.sequence_id??row.id??`${rowTime(row)}-${row.text}`} className={layout.utterance} data-partial={row.is_partial===true}><div className={layout.meta}><time>{rowTime(row)}</time><SpeakerLabel row={row}/><span className={row.is_partial?styles.liveTyping:styles.badge}>{row.is_partial?'입력 중':'확정'}</span></div><p>{row.text}</p></article>)}
  </div>
  <p className={styles.hint}>최근 80구간을 표시합니다. 전체 원문과 검토 기능은 ‘전체 전사’에서 사용할 수 있습니다.</p>
 </section>;
}

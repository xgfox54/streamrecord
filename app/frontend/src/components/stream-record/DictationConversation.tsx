'use client';
import {SpeakerLabel} from './SpeakerLabel';
import {DiarizationControls} from './DiarizationControls';
import {useEffect,useRef,useState} from 'react';
import {ArrowDown,MessageSquareText} from 'lucide-react';
import {rowTime} from '../meeting-ko/core';
import {correctedText} from '../meeting-ko/transcript-correction';
import {CorrectionControls} from './CorrectionControls';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';
export function DictationConversation({session:s}:{readonly session:MeetingSession}){
 const [corrected,setCorrected]=useState(true);const [compare,setCompare]=useState(false);const [query,setQuery]=useState('');const [pageStart,setPageStart]=useState<number|null>(null);const scroll=useRef<HTMLDivElement>(null);
 const filtered=s.rows.map((row,index)=>({row,index})).filter(({row})=>!query||`${row.text} ${correctedText(row)??''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const lastStart=Math.max(0,filtered.length-200);const start=Math.min(pageStart??lastStart,lastStart);const visible=filtered.slice(start,start+200);
 useEffect(()=>{if(s.follow&&pageStart===null&&!query&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[s.rows,s.follow,pageStart,query,corrected]);
 const latest=()=>{setPageStart(null);setQuery('');s.setFollow(true);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;};
 return <section className={`${styles.panel} ${layout.conversation}`} aria-label="전체 받아쓰기 대화" data-testid="dictation-conversation">
  <div className={layout.conversationHeading}><div><h2>전체 대화 <span className={styles.badge}>{s.rows.length}구간</span></h2><p>1차 Whisper 받아쓰기 → 2차 AI 보정</p></div><button disabled={!s.rows.length} onClick={latest}><ArrowDown size={18} aria-hidden="true"/>최신 문장</button></div>
  <CorrectionControls session={s}/><DiarizationControls session={s}/>
  <div className={layout.readingTools}><div className={layout.switcher} role="group" aria-label="대화 표시 방식"><button aria-pressed={!corrected} onClick={()=>setCorrected(false)}>실시간 원문</button><button aria-pressed={corrected} onClick={()=>setCorrected(true)}>AI 보정본</button></div>{corrected&&<label className={styles.check}><input type="checkbox" checked={compare} onChange={event=>setCompare(event.target.checked)}/>원문 함께 보기</label>}<label className={layout.search}>대화 검색<input type="search" placeholder="전체 대화에서 찾기" value={query} onChange={event=>{setQuery(event.target.value);setPageStart(0);s.setFollow(false);}}/></label></div>
  <p className={styles.hint}>{corrected?'AI 보정은 원음 검증이 아닙니다. 보정 전 문장도 빠짐없이 원문으로 표시합니다.':'Whisper가 인식한 최초 원문입니다. AI 보정과 관계없이 그대로 보존됩니다.'}</p>
  <div ref={scroll} className={layout.reader} tabIndex={0} role="log" aria-live="off" aria-label={corrected?'AI 보정 대화 내용':'Whisper 실시간 원문'} onScroll={event=>{const node=event.currentTarget;if(node.scrollHeight-node.scrollTop-node.clientHeight>64){s.setFollow(false);if(pageStart===null)setPageStart(start);}}}>
   {!s.rows.length&&<div className={layout.empty}><MessageSquareText size={30} aria-hidden="true"/><h3>말하는 내용이 이곳에 쌓입니다</h3><p>받아쓰기를 시작하면 원문이 바로 나타납니다.<br/>자동 보정을 켜면 확정된 문장부터 AI가 다듬습니다.</p></div>}
   {s.rows.length>0&&!filtered.length&&<p>검색어와 일치하는 대화가 없습니다.</p>}
   {visible.map(({row,index})=>{const text=correctedText(row);const id=`S${String(index+1).padStart(6,'0')}`;return <article key={row.sequence_id??row.id??id} className={layout.utterance} data-partial={Boolean(row.is_partial)}>
    <div className={layout.meta}><time>{rowTime(row)}</time><SpeakerLabel row={row}/><span>{id}</span><span>{row.is_partial?'입력 중':corrected&&text!==null?'AI 보정됨':corrected?'보정 전 원문':'확정 원문'}</span></div>
    <p>{corrected?(text??row.text):row.text}</p>
    {corrected&&compare&&text!==null&&<div className={layout.original}><small>최초 원문 · 보정 모델: {row.ai_correction?.model_key}</small><p>{row.text}</p></div>}
   </article>;})}
  </div>
  <div className={layout.pagination}><span>{filtered.length?`${start+1}–${Math.min(start+200,filtered.length)} / ${filtered.length}구간`:'0구간'}{query?' · 전체 검색 결과':''}</span><div><button disabled={start===0} onClick={()=>{setPageStart(Math.max(0,start-200));s.setFollow(false);if(scroll.current)scroll.current.scrollTop=0;}}>앞선 대화</button><button disabled={start>=lastStart} onClick={()=>{setPageStart(Math.min(lastStart,start+200));s.setFollow(false);if(scroll.current)scroll.current.scrollTop=0;}}>다음 대화</button></div></div>
  <div className={styles.actions}><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('corrected')}>AI 보정본 TXT 저장</button><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('transcript')}>최초 원문 TXT 저장</button><a href="#transcript" onClick={()=>s.navigate('transcript')}>원음 듣기·직접 수정</a></div>
 </section>;
}

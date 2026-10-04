'use client';
import {SpeakerLabel} from './SpeakerLabel';
import {useEffect,useRef,useState} from 'react';
import {ArrowDown,FolderOpen,MessageSquareText} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {rowTime} from '../meeting-ko/core';
import {correctedText,correctionIssue,correctionIssueMessages} from '../meeting-ko/transcript-correction';
import {TranscriptOptionNotes,TranscriptOptions} from './TranscriptOptions';
import {useStoredFlag} from './useStoredFlag';
import type {MeetingSession} from './useMeetingSession';
import {LoadingLine,LoadingPanel,TranscribingIndicator,WaitingPanel} from './TranscriptActivity';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';
import compactStyles from './compact-reader.module.css';
export function DictationConversation({session:s,compact=false,video=false}:{readonly session:MeetingSession;readonly compact?:boolean;readonly video?:boolean}){
 const [corrected,setCorrected]=useState(false);const [compare,setCompare]=useStoredFlag('compare-original',false);const [query,setQuery]=useState('');const [pageStart,setPageStart]=useState<number|null>(null);const scroll=useRef<HTMLDivElement>(null);
 const confirmed=s.rows.flatMap((row,index)=>row.is_partial?[]:[String(row.sequence_id??row.id??index)]);
 const [seen,setSeen]=useState(()=>({key:s.readerSessionKey,ids:new Set(confirmed)}));
 const unread=seen.key===s.readerSessionKey&&!s.follow?confirmed.filter(id=>!seen.ids.has(id)).length:0;
 useEffect(()=>{
  const sessionChanged=seen.key!==s.readerSessionKey;
  if(sessionChanged){setPageStart(null);setQuery('');}
  if(sessionChanged||s.follow)setSeen(previous=>previous.key===s.readerSessionKey&&previous.ids.size===confirmed.length&&confirmed.every(id=>previous.ids.has(id))?previous:{key:s.readerSessionKey,ids:new Set(confirmed)});
 },[s.rows,s.follow,s.readerSessionKey,seen.key]);
 const filtered=s.rows.map((row,index)=>({row,index})).filter(({row})=>!query||`${row.text} ${correctedText(row)??''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const lastStart=Math.max(0,filtered.length-200);const start=Math.min(pageStart??lastStart,lastStart);const visible=filtered.slice(start,start+200);
 useEffect(()=>{if(s.follow&&pageStart===null&&!query&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[s.rows,s.follow,pageStart,query,corrected,s.mode]);
 const preparing=s.mode==='starting';const live=s.mode==='recording'||s.mode==='stopping';
 const searchField=<label className={layout.search}>대화 내용 검색<input type="search" placeholder="전체 대화에서 찾기" value={query} onChange={event=>{setQuery(event.target.value);setPageStart(0);s.setFollow(false);}}/></label>;
 const latest=()=>{setPageStart(null);setQuery('');setSeen({key:s.readerSessionKey,ids:new Set(confirmed)});s.setFollow(true);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;};
 return <section className={`${styles.panel} ${layout.conversation} ${compact?compactStyles.conversation:''}`} aria-label="전체 받아쓰기 대화" data-testid="dictation-conversation" data-video={video}>
  {!video&&<div className={layout.conversationHeading}><div><h2>{compact?'받아쓰기':'전체 받아쓰기'} <span className={styles.badge}>{s.rows.length}구간</span></h2>{!compact&&<p>1차 Whisper 받아쓰기 → 2차 AI 보정</p>}</div>{compact&&<span className={compactStyles.status} role="status">{s.correction.status}{s.correction.total>0?` · ${s.correction.completed}/${s.correction.total}구간`:''}</span>}<button disabled={!s.rows.length} onClick={latest}><ArrowDown size={18} aria-hidden="true"/>{unread?`새 문장 ${unread}개 · 최신으로`:'최신 문장'}</button></div>}
  <div className={layout.readingTools}><div className={layout.switcher} role="group" aria-label="대화 표시 방식"><button aria-pressed={!corrected} onClick={()=>setCorrected(false)}>실시간 원문</button><button aria-pressed={corrected} onClick={()=>setCorrected(true)}>AI 보정본</button></div>{video&&<button disabled={!s.rows.length} onClick={latest}><ArrowDown size={18} aria-hidden="true"/>{unread?`새 문장 ${unread}개`:'최신 문장'}</button>}<TranscriptOptions session={s} corrected={corrected} compare={compare} setCompare={setCompare}/>{searchField}</div>
  <TranscriptOptionNotes session={s} showStatus={!compact||video}/>
  <p className={styles.hint}>{corrected?'AI 보정은 원음 검증이 아닙니다. 보정 전 문장도 빠짐없이 원문으로 표시합니다.':'Whisper가 인식한 최초 원문입니다. AI 보정과 관계없이 그대로 보존됩니다.'}</p>
  <div ref={scroll} className={`${layout.reader} ${compact?compactStyles.reader:''}`} tabIndex={0} role="log" aria-live="off" aria-label={corrected?'AI 보정 대화 내용':'Whisper 실시간 원문'} onScroll={event=>{const node=event.currentTarget;if(node.scrollHeight-node.scrollTop-node.clientHeight>64){s.setFollow(false);if(pageStart===null)setPageStart(start);}}}>
   {!s.rows.length&&(preparing?<LoadingPanel/>:live?<WaitingPanel stopping={s.mode==='stopping'}/>:<div className={layout.empty}><MessageSquareText size={30} aria-hidden="true"/><h3>녹음을 시작하면 여기에 받아쓰기가 표시됩니다</h3><p>위에서 소리를 선택하고 녹음 시작을 누르세요.<br/>녹음이 끝나면 내용을 확인하고 회의록으로 정리할 수 있습니다.</p></div>)}
   {s.rows.length>0&&!filtered.length&&<p>검색어와 일치하는 대화가 없습니다.</p>}
   {visible.map(({row,index})=>{const text=correctedText(row);const issue=correctionIssue(row);const id=`S${String(index+1).padStart(6,'0')}`;return <article key={row.sequence_id??row.id??id} className={layout.utterance} data-partial={Boolean(row.is_partial)} data-correction-review={issue?.reason}>
    <div className={layout.meta}><time>{rowTime(row)}</time><SpeakerLabel row={row}/><span>{id}</span><span>{row.is_partial?'입력 중':corrected&&issue?'원음 확인 · 원문':corrected&&text!==null?'AI 보정됨':corrected?'보정 전 원문':'확정 원문'}</span></div>
    <p>{corrected?(text??row.text):row.text}</p>
    {corrected&&issue&&<p className={styles.hint}>{correctionIssueMessages[issue.reason]}</p>}
    {corrected&&compare&&text!==null&&<div className={layout.original}><small>최초 원문 · 보정 모델: {row.ai_correction?.model_key}</small><p>{row.text}</p></div>}
   </article>;})}
   {s.rows.length>0&&preparing&&<LoadingLine/>}
   {s.rows.length>0&&live&&!query&&<TranscribingIndicator stopping={s.mode==='stopping'}/>}
  </div>
  <div className={layout.pagination}><span>{filtered.length?`${start+1}–${Math.min(start+200,filtered.length)} / ${filtered.length}구간`:'0구간'}{query?' · 전체 검색 결과':''}</span><div><button disabled={start===0} onClick={()=>{setPageStart(Math.max(0,start-200));s.setFollow(false);if(scroll.current)scroll.current.scrollTop=0;}}>앞선 대화</button><button disabled={start>=lastStart} onClick={()=>{setPageStart(Math.min(lastStart,start+200));s.setFollow(false);if(scroll.current)scroll.current.scrollTop=0;}}>다음 대화</button></div></div>
  <div className={styles.actions}><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('corrected')}>AI 보정본 TXT 저장</button><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('transcript')}>최초 원문 TXT 저장</button><button onClick={()=>void invoke('ko_open_exports_folder').catch(error=>s.setError(`TXT 저장 폴더 열기 실패: ${s.messageOf(error)}`))}><FolderOpen size={18} aria-hidden="true"/>TXT 저장 폴더 열기</button><a href="#transcript" onClick={()=>s.navigate('transcript')}>원음 듣기·직접 수정</a></div>
 </section>;
}

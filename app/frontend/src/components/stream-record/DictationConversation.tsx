'use client';
import {FeatureIcon} from './FeatureIcon';
import {SpeakerLabel} from './SpeakerLabel';
import {useEffect,useRef,useState} from 'react';
import {ArrowDown,FolderOpen,Pencil} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {rowTime,segmentLabel} from '../meeting-ko/core';
import {correctedText,correctionIssue,correctionIssueMessages} from '../meeting-ko/transcript-correction';
import {TranscriptOptionNotes,TranscriptOptions} from './TranscriptOptions';
import {useStoredFlag} from './useStoredFlag';
import type {MeetingSession} from './useMeetingSession';
import {LoadingLine,LoadingPanel,TranscribingIndicator,WaitingPanel} from './TranscriptActivity';
import styles from '../meeting-ko/workspace.module.css';
import layout from './dictation.module.css';
import compactStyles from './compact-reader.module.css';
export function DictationConversation({session:s,compact=false,video=false,compactText=false}:{readonly session:MeetingSession;readonly compact?:boolean;readonly video?:boolean;readonly compactText?:boolean}){
 const [corrected,setCorrected]=useState(false);const [compare,setCompare]=useStoredFlag('compare-original',false);const [query,setQuery]=useState('');const [pageStart,setPageStart]=useState<number|null>(null);const scroll=useRef<HTMLDivElement>(null);
 const confirmed=s.rows.flatMap((row,index)=>row.is_partial?[]:[String(row.sequence_id??row.id??index)]);
 const [seen,setSeen]=useState(()=>({key:s.readerSessionKey,ids:new Set(confirmed)}));
 const unread=seen.key===s.readerSessionKey&&!s.follow?confirmed.filter(id=>!seen.ids.has(id)).length:0;
 useEffect(()=>{
  const sessionChanged=seen.key!==s.readerSessionKey;
  if(sessionChanged){setPageStart(null);setQuery('');}
  if(sessionChanged||s.follow)setSeen(previous=>previous.key===s.readerSessionKey&&previous.ids.size===confirmed.length&&confirmed.every(id=>previous.ids.has(id))?previous:{key:s.readerSessionKey,ids:new Set(confirmed)});
 },[s.rows,s.follow,s.readerSessionKey,seen.key]);
 const filtered=s.rows.map((row,index)=>({row,index})).filter(({row})=>!query||`${row.text} ${correctedText(row)??''} ${row.reviewed_text??''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const lastStart=Math.max(0,filtered.length-200);const start=Math.min(pageStart??lastStart,lastStart);const visible=filtered.slice(start,start+200);
 useEffect(()=>{if(s.follow&&pageStart===null&&!query&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[s.rows,s.follow,pageStart,query,corrected,s.mode]);
 const preparing=s.mode==='starting';const live=s.mode==='recording'||s.mode==='stopping';
 const searchField=<label className={layout.search}>대화 내용 검색<input type="search" placeholder="전체 대화에서 찾기" value={query} onChange={event=>{setQuery(event.target.value);setPageStart(0);s.setFollow(false);}}/></label>;
 // Jump from the correction notice to a kept-original sentence: show it in the AI view and center it in the reader.
 const [target,setTarget]=useState<number|null>(null);const rowNodes=useRef(new Map<number,HTMLElement>());
 const reveal=(index:number)=>{setQuery('');setCorrected(true);s.setFollow(false);setPageStart(Math.max(0,Math.min(index-100,s.rows.length-200)));setTarget(index);};
 useEffect(()=>{if(target===null)return;const node=rowNodes.current.get(target);if(!node)return;node.scrollIntoView({block:'center'});node.focus({preventScroll:true});},[target,pageStart,corrected]);
 // Per-sentence editing. Allowed while idle or recording; other jobs rewrite rows from their own snapshot.
 const [edit,setEdit]=useState<{index:number;sequence:unknown;draft:string}|null>(null);const [editError,setEditError]=useState('');
 const canEdit=s.mode==='idle'||s.mode==='recording'||s.mode==='reviewing';
 const saveEdit=async(value:string)=>{if(!edit)return;try{await s.saveReview(edit.index,edit.sequence,value);setEdit(null);setEditError('');s.setNotice(`${segmentLabel(edit.index)} 수정 내용을 저장했습니다. 최초 원문은 그대로 보존됩니다.`);}catch(error){setEditError(s.messageOf(error));}};
 const latest=()=>{setPageStart(null);setQuery('');setSeen({key:s.readerSessionKey,ids:new Set(confirmed)});s.setFollow(true);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;};
 return <section className={`${styles.panel} ${layout.conversation} ${compact?compactStyles.conversation:''}`} aria-label="전체 받아쓰기 대화" data-testid="dictation-conversation" data-video={video} data-compact-text={video||compactText}>
  {!video&&<div className={layout.conversationHeading}><div><h2>{compact?'받아쓰기':'전체 받아쓰기'} <span className={styles.badge}>{s.rows.length}구간</span></h2>{!compact&&<p>1차 Whisper 받아쓰기 → 2차 AI 보정</p>}</div>{compact&&<span className={compactStyles.status} role="status">{s.correction.status}{s.correction.total>0?` · ${s.correction.completed}/${s.correction.total}구간`:''}</span>}<button disabled={!s.rows.length} onClick={latest}><ArrowDown size={18} aria-hidden="true"/>{unread?`새 문장 ${unread}개 · 최신으로`:'최신 문장'}</button></div>}
  <div className={layout.readingTools}><div className={layout.switcher} role="group" aria-label="대화 표시 방식"><button aria-pressed={!corrected} onClick={()=>setCorrected(false)}>실시간 원문</button><button aria-pressed={corrected} onClick={()=>setCorrected(true)}>AI 보정본</button></div>{video&&<button disabled={!s.rows.length} onClick={latest}><ArrowDown size={18} aria-hidden="true"/>{unread?`새 문장 ${unread}개`:'최신 문장'}</button>}<TranscriptOptions session={s} corrected={corrected} compare={compare} setCompare={setCompare}/>{searchField}</div>
  <TranscriptOptionNotes session={s} showStatus={!compact||video} onReveal={reveal}/>
  <p className={styles.hint}>{corrected?'AI 보정은 원음 검증이 아닙니다. 보정 전 문장도 빠짐없이 원문으로 표시합니다.':'Whisper가 인식한 최초 원문입니다. AI 보정과 관계없이 그대로 보존됩니다.'}</p>
  <div ref={scroll} className={`${layout.reader} ${compact?compactStyles.reader:''}`} tabIndex={0} role="log" aria-live="off" aria-label={corrected?'AI 보정 대화 내용':'Whisper 실시간 원문'} onScroll={event=>{const node=event.currentTarget;if(node.scrollHeight-node.scrollTop-node.clientHeight>64){s.setFollow(false);if(pageStart===null)setPageStart(start);}}}>
   {!s.rows.length&&(preparing?<LoadingPanel/>:live?<WaitingPanel stopping={s.mode==='stopping'}/>:<div className={layout.empty}><FeatureIcon kind="dictation" size="empty"/><h3>녹음을 시작하면 여기에 받아쓰기가 표시됩니다</h3><p>위에서 소리를 선택하고 녹음 시작을 누르세요.<br/>녹음이 끝나면 내용을 확인하고 회의록으로 정리할 수 있습니다.</p></div>)}
   {s.rows.length>0&&!filtered.length&&<p>검색어와 일치하는 대화가 없습니다.</p>}
   {visible.map(({row,index})=>{const text=correctedText(row);const issue=correctionIssue(row);const reviewed=typeof row.reviewed_text==='string'?row.reviewed_text:null;const editingRow=edit?.index===index;const id=segmentLabel(index);return <article key={row.sequence_id??row.id??id} id={`dictation-row-${index}`} ref={node=>{if(node)rowNodes.current.set(index,node);else rowNodes.current.delete(index);}} tabIndex={-1} className={layout.utterance} data-partial={Boolean(row.is_partial)} data-correction-review={issue?.reason} data-target={target===index}>
    <div className={layout.meta}><time>{rowTime(row)}</time><SpeakerLabel row={row}/><span>{id}</span><span>{row.is_partial?'입력 중':reviewed!==null?'직접 수정됨':corrected&&issue?'원음 확인 · 원문':corrected&&text!==null?'AI 보정됨':corrected?'보정 전 원문':'확정 원문'}</span>{!row.is_partial&&!editingRow&&<button className={layout.editButton} disabled={!canEdit||(edit!==null&&!editingRow)} aria-label={`${id} 편집`} onClick={()=>{s.setFollow(false);setEditError('');setEdit({index,sequence:row.sequence_id??row.id,draft:reviewed??(corrected?(text??row.text):row.text)});}}><Pencil size={16} aria-hidden="true"/>편집</button>}</div>
    {editingRow&&edit?<div className={layout.editor}><label>{id} 수정<textarea autoFocus value={edit.draft} onChange={event=>setEdit({...edit,draft:event.target.value})}/></label>{editError&&<p role="alert" className={styles.error}>{editError}</p>}<div className={styles.actions}><button className={styles.primary} onClick={()=>void saveEdit(edit.draft)}>저장</button><button onClick={()=>{setEdit(null);setEditError('');}}>취소</button>{reviewed!==null&&<button onClick={()=>void saveEdit(row.text)}>원래 받아쓰기로 되돌리기</button>}</div></div>:<p>{reviewed??(corrected?(text??row.text):row.text)}</p>}
    {reviewed!==null&&!editingRow&&<div className={layout.original}><small>최초 원문 (보존됨)</small><p>{row.text}</p></div>}
    {corrected&&issue&&reviewed===null&&<p className={styles.hint}>{correctionIssueMessages[issue.reason]}</p>}
    {corrected&&compare&&text!==null&&reviewed===null&&<div className={layout.original}><small>최초 원문 · 보정 모델: {row.ai_correction?.model_key}</small><p>{row.text}</p></div>}
   </article>;})}
   {s.rows.length>0&&preparing&&<LoadingLine/>}
   {s.rows.length>0&&live&&!query&&<TranscribingIndicator stopping={s.mode==='stopping'}/>}
  </div>
  <div className={layout.pagination}><span>{filtered.length?`${start+1}–${Math.min(start+200,filtered.length)} / ${filtered.length}구간`:'0구간'}{query?' · 전체 검색 결과':''}</span><div><button disabled={start===0} onClick={()=>{setPageStart(Math.max(0,start-200));s.setFollow(false);if(scroll.current)scroll.current.scrollTop=0;}}>앞선 대화</button><button disabled={start>=lastStart} onClick={()=>{setPageStart(Math.min(lastStart,start+200));s.setFollow(false);if(scroll.current)scroll.current.scrollTop=0;}}>다음 대화</button></div></div>
  <div className={styles.actions}><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('corrected')}>AI 보정본 TXT 저장</button><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('transcript')}>최초 원문 TXT 저장</button><button onClick={()=>void invoke('ko_open_exports_folder').catch(error=>s.setError(`TXT 저장 폴더 열기 실패: ${s.messageOf(error)}`))}><FolderOpen size={18} aria-hidden="true"/>TXT 저장 폴더 열기</button><a href="#transcript" onClick={()=>s.navigate('transcript')}>원음 듣기·직접 수정</a></div>
 </section>;
}

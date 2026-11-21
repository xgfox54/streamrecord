'use client';
import {Fragment,useMemo,useState} from 'react';
import {ArrowDownUp,ArrowRight,Check,ChevronRight,FileText,Search,Star,Upload} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import {durationLabel,inputLabels,recordDisplayTitle} from './record-presentation';
import {BodyMatches} from './BodyMatches';
import {useBodySearch} from './useBodySearch';
import styles from './studio.module.css';
export function LibraryView({session:s}:{readonly session:MeetingSession}){
 const [query,setQuery]=useState('');const [newest,setNewest]=useState(true);
 const [includeBody,setIncludeBody]=useState(false);
 const term=query.trim().toLocaleLowerCase();
 const candidates=useMemo(()=>{
   if(s.libraryFilter==='star')return s.records.filter(record=>s.starredRecords.includes(record.id));
   if(s.libraryFilter==='review')return s.records.filter(record=>!record.hasMinutes);
   if(s.libraryFilter==='minutes')return s.records.filter(record=>record.hasMinutes);
   return s.records;
 },[s.libraryFilter,s.records,s.starredRecords]);
 const search=useBodySearch(candidates,includeBody?term:'',s.activeRecordId,s.rows);
 const records=candidates.filter(record=>recordDisplayTitle(record.title,record.updatedAt,record.inputKind).toLocaleLowerCase().includes(term)||search.hits.has(record.id)).sort((a,b)=>newest?b.updatedAt.localeCompare(a.updatedAt):a.updatedAt.localeCompare(b.updatedAt));
 const reset=()=>{setQuery('');s.setLibraryFilter('all');};
 const emptyTitle=term?'검색한 기록이 없습니다':s.libraryFilter==='star'?'중요 표시한 기록이 없습니다':s.libraryFilter==='review'?'검토할 기록이 없습니다':s.libraryFilter==='minutes'?'회의록이 있는 기록이 없습니다':'아직 기록이 없습니다';
 const latest=s.records[0];
 const open=(id:string)=>void s.openRecord(id).catch(error=>s.setError(s.messageOf(error)));
 const importFile=async()=>{try{await s.newRecord();s.setRequestedInput('file');}catch(error){s.setError(s.messageOf(error));}};
 return <div className={styles.library}>
  <div className={styles.pageHeading}><div><p className={styles.eyebrow}>MY LIBRARY</p><h2>나의 기록</h2><p>대화를 모으고, 필요한 내용을 다시 찾습니다.</p></div><button disabled={s.recordSwitchBlocked||!s.ready} onClick={()=>void importFile()}><Upload size={18}/>파일 가져오기</button></div>
  {s.error&&<p role="alert" className={styles.error}>{s.error}</p>}<p role="status" className={styles.notice}>{s.notice}</p>
  {latest&&<section className={styles.continueCard}><div><p>이어서 검토하기</p><h3>{recordDisplayTitle(latest.title,latest.updatedAt,latest.inputKind)}</h3><p className={styles.muted}>{new Date(latest.updatedAt).toLocaleString('ko-KR')} · {durationLabel(latest.durationSeconds)||`${latest.rowCount}구간`}</p><button disabled={s.recordSwitchBlocked} onClick={()=>open(latest.id)}><ArrowRight size={18}/>기록 이어 보기</button></div><div className={styles.paper} aria-hidden="true"><strong>MEETING<br/>NOTE</strong><i/><i/><i/><i/><span><Check size={20}/></span></div></section>}
  <div className={styles.libraryTools}><label className={styles.search}><Search size={19}/><span className={styles.srOnly}>{includeBody?'기록 제목과 본문 검색':'기록 제목 검색'}</span><input type="search" placeholder={includeBody?'제목이나 발언 내용으로 검색':'기록 제목으로 검색'} value={query} onChange={event=>setQuery(event.target.value)}/></label><label><input type="checkbox" checked={includeBody} onChange={event=>setIncludeBody(event.target.checked)}/> 받아쓰기 본문도 검색</label><div className={styles.filters} aria-label="기록 필터">{([{id:'all',name:'전체'},{id:'review',name:'검토할 기록'},{id:'minutes',name:'회의록'}] as const).map(filter=><button key={filter.id} aria-pressed={s.libraryFilter===filter.id} onClick={()=>s.setLibraryFilter(filter.id)}>{filter.name}</button>)}</div><button onClick={()=>setNewest(value=>!value)}><ArrowDownUp size={18}/>{newest?'최신순':'오래된 순'}</button></div>
  <div className={styles.listMeta}><span>{s.libraryFilter==='star'?'중요 기록':'저장된 기록'}</span><span>{records.length}개의 기록</span></div>
  {search.busy&&<p role="status">받아쓰기 본문을 검색하고 있습니다.</p>}
  {search.errors>0&&<p role="alert">기록 {search.errors}개의 본문을 읽지 못했습니다.</p>}
  {s.historyError&&<p role="alert" className={styles.error}>{s.historyError}</p>}
  {s.recordsLoading?<p role="status">기록을 불러오고 있습니다.</p>:<div className={styles.records}>{records.map(record=><Fragment key={record.id}><div className={styles.recordRow}><button className={styles.recordOpen} disabled={s.recordSwitchBlocked} onClick={()=>open(record.id)}><span className={styles.recordGlyph} data-complete={Boolean(record.hasMinutes)}><FileText size={22}/></span><span className={styles.recordTitle}><strong>{recordDisplayTitle(record.title,record.updatedAt,record.inputKind)}</strong><small>{new Date(record.updatedAt).toLocaleDateString('ko-KR')}{record.inputKind?` · ${inputLabels[record.inputKind]}`:''} · {record.rowCount}구간</small></span><span className={styles.recordStatus} data-complete={Boolean(record.hasMinutes)}>{record.hasMinutes?'회의록 있음':'검토할 기록'}</span><small className={styles.duration}>{durationLabel(record.durationSeconds)}</small><ChevronRight size={18}/></button><button className={styles.star} aria-label={`${record.title} 중요 표시`} aria-pressed={s.starredRecords.includes(record.id)} onClick={()=>s.toggleRecordStar(record.id)}><Star size={18} fill={s.starredRecords.includes(record.id)?'currentColor':'none'}/></button></div>{search.hits.has(record.id)&&<BodyMatches hits={search.hits.get(record.id)??[]} disabled={s.recordSwitchBlocked} onSelect={async hit=>{
    try{
      await s.openRecord(record.id);
      s.setRequestedClip({record:record.id,index:hit.index,text:hit.text,time:hit.time,play:hit.playable});
    }catch(error){s.setError(s.messageOf(error));}
  }}/>}</Fragment>)}</div>}
  {!s.recordsLoading&&!search.busy&&!records.length&&<div className={styles.empty}><FileText size={32}/><h3>{emptyTitle}</h3>{term||s.libraryFilter!=='all'?<button onClick={reset}>전체 기록 보기</button>:<p>새 녹음이나 파일 가져오기로 첫 기록을 만듭니다.</p>}</div>}
 </div>;
}

'use client';
import {useState} from 'react';
import {ArrowDownUp,ArrowRight,Check,ChevronRight,FileText,Search,Star,Upload} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import {durationLabel,inputLabels,recordDisplayTitle} from './record-presentation';
import styles from './studio.module.css';
export function LibraryView({session:s}:{readonly session:MeetingSession}){
 const [query,setQuery]=useState('');const [newest,setNewest]=useState(true);
 const records=[...s.records].filter(record=>(s.libraryFilter!=='star'||s.starredRecords.includes(record.id))&&(s.libraryFilter!=='review'||!record.hasMinutes)&&(s.libraryFilter!=='minutes'||record.hasMinutes)&&recordDisplayTitle(record.title,record.updatedAt,record.inputKind).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>newest?b.updatedAt.localeCompare(a.updatedAt):a.updatedAt.localeCompare(b.updatedAt));
 const latest=s.records[0];
 const open=(id:string)=>void s.openRecord(id).catch(error=>s.setError(s.messageOf(error)));
 const importFile=async()=>{try{await s.newRecord();s.setRequestedInput('file');}catch(error){s.setError(s.messageOf(error));}};
 return <div className={styles.library}>
  <div className={styles.pageHeading}><div><p className={styles.eyebrow}>MY LIBRARY</p><h2>나의 기록</h2><p>대화를 모으고, 필요한 내용을 다시 찾습니다.</p></div><button disabled={s.recordSwitchBlocked||!s.ready} onClick={()=>void importFile()}><Upload size={18}/>파일 가져오기</button></div>
  {s.error&&<p role="alert" className={styles.error}>{s.error}</p>}<p role="status" className={styles.notice}>{s.notice}</p>
  {latest&&<section className={styles.continueCard}><div><p>이어서 검토하기</p><h3>{recordDisplayTitle(latest.title,latest.updatedAt,latest.inputKind)}</h3><p className={styles.muted}>{new Date(latest.updatedAt).toLocaleString('ko-KR')} · {durationLabel(latest.durationSeconds)||`${latest.rowCount}구간`}</p><button disabled={s.recordSwitchBlocked} onClick={()=>open(latest.id)}><ArrowRight size={18}/>기록 이어 보기</button></div><div className={styles.paper} aria-hidden="true"><strong>MEETING<br/>NOTE</strong><i/><i/><i/><i/><span><Check size={20}/></span></div></section>}
  <div className={styles.libraryTools}><label className={styles.search}><Search size={19}/><span className={styles.srOnly}>기록 제목 검색</span><input type="search" placeholder="기록 제목으로 검색" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className={styles.filters} aria-label="기록 필터">{([{id:'all',name:'전체'},{id:'review',name:'검토할 기록'},{id:'minutes',name:'회의록'}] as const).map(filter=><button key={filter.id} aria-pressed={s.libraryFilter===filter.id} onClick={()=>s.setLibraryFilter(filter.id)}>{filter.name}</button>)}</div><button onClick={()=>setNewest(value=>!value)}><ArrowDownUp size={18}/>{newest?'최신순':'오래된 순'}</button></div>
  <div className={styles.listMeta}><span>{s.libraryFilter==='star'?'중요 기록':'저장된 기록'}</span><span>{records.length}개의 기록</span></div>
  {s.historyError&&<p role="alert" className={styles.error}>{s.historyError}</p>}
  {s.recordsLoading?<p role="status">기록을 불러오고 있습니다.</p>:<div className={styles.records}>{records.map(record=><div className={styles.recordRow} key={record.id}><button className={styles.recordOpen} disabled={s.recordSwitchBlocked} onClick={()=>open(record.id)}><span className={styles.recordGlyph} data-complete={Boolean(record.hasMinutes)}><FileText size={22}/></span><span className={styles.recordTitle}><strong>{recordDisplayTitle(record.title,record.updatedAt,record.inputKind)}</strong><small>{new Date(record.updatedAt).toLocaleDateString('ko-KR')}{record.inputKind?` · ${inputLabels[record.inputKind]}`:''} · {record.rowCount}구간</small></span><span className={styles.recordStatus} data-complete={Boolean(record.hasMinutes)}>{record.hasMinutes?'회의록 있음':'검토할 기록'}</span><small className={styles.duration}>{durationLabel(record.durationSeconds)}</small><ChevronRight size={18}/></button><button className={styles.star} aria-label={`${record.title} 중요 표시`} aria-pressed={s.starredRecords.includes(record.id)} onClick={()=>s.toggleRecordStar(record.id)}><Star size={18} fill={s.starredRecords.includes(record.id)?'currentColor':'none'}/></button></div>)}</div>}
  {!s.recordsLoading&&!records.length&&<div className={styles.empty}><FileText size={32}/><h3>{query?'검색한 기록이 없습니다':'아직 기록이 없습니다'}</h3><p>{query?'다른 제목으로 검색해 주세요.':'새 녹음이나 파일 가져오기로 첫 기록을 만듭니다.'}</p></div>}
 </div>;
}

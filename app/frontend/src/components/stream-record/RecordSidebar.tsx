'use client';
import {useState} from 'react';
import {Plus,Search,FileText,RefreshCw} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import layout from './record-workspace.module.css';
function recordDate(value:string){const date=new Date(value);return Number.isNaN(date.valueOf())?'날짜 미상':date.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'});}
export function RecordSidebar({session:s,onSelected}:{readonly session:MeetingSession;readonly onSelected:()=>void}){
 const [query,setQuery]=useState('');const filtered=s.records.filter(item=>item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const run=async(action:()=>Promise<void>)=>{try{await action();onSelected();}catch(error){s.setError(s.messageOf(error));}};
 return <>
  <button className={styles.primary+' '+layout.newRecord} disabled={!s.ready||s.recordSwitchBlocked} onClick={()=>void run(()=>s.newRecord())}><Plus size={20} aria-hidden="true"/>새 기록</button>
  <label className={layout.recordSearch}><span><Search size={16} aria-hidden="true"/>기록 검색</span><input type="search" value={query} placeholder="제목으로 찾기" onChange={event=>setQuery(event.target.value)}/></label>
  <div className={layout.listHeading}><h2>내 기록</h2><button aria-label="기록 목록 새로고침" disabled={s.recordsLoading||s.recordSwitchBlocked} onClick={()=>void run(()=>s.refreshRecords())}><RefreshCw size={16} aria-hidden="true"/></button></div>
  {s.historyError&&<p role="alert" className={layout.historyError}>{s.historyError}</p>}
  {s.recordsLoading&&<p className={layout.listHint} role="status">기록을 불러오는 중…</p>}
  <nav aria-label="저장된 기록" className={layout.recordList}>
   {!s.records.some(item=>item.id===s.activeRecordId)&&<button aria-current={s.view!=='ai'&&s.view!=='settings'?'page':undefined} onClick={()=>{s.navigate('recording');onSelected();}}><FileText size={17} aria-hidden="true"/><span><strong>{s.title||'새 기록'}</strong><small>현재 작성 중 · {s.rows.length}구간</small></span></button>}
   {filtered.map((item,index)=><div key={item.id}>{(index===0||recordDate(filtered[index-1].updatedAt)!==recordDate(item.updatedAt))&&<p className={layout.dateGroup}>{recordDate(item.updatedAt)}</p>}<button aria-current={item.id===s.activeRecordId?'page':undefined} disabled={s.recordSwitchBlocked} onClick={()=>void run(()=>s.openRecord(item.id))}><FileText size={17} aria-hidden="true"/><span><strong>{item.id===s.activeRecordId?s.title:item.title||'제목 없는 기록'}</strong><small>{item.rowCount}구간{item.id===s.activeRecordId?' · 현재 기록':''}</small></span></button></div>)}
   {!filtered.length&&!s.recordsLoading&&<p className={layout.listHint}>{query?'일치하는 기록이 없습니다.':'저장한 기록이 여기에 쌓입니다.'}</p>}
  </nav>
  {s.recordSwitchBlocked&&<p className={layout.listHint}>{s.recordSwitchBlockedReason}</p>}
 </>;
}

'use client';
import {useEffect,useState} from 'react';
import {AppShell} from '../stream-record/AppShell';
import {RecordWorkspace} from '../stream-record/RecordWorkspace';
import {AiConnectionsView} from '../stream-record/AiConnectionsView';
import {SettingsView} from '../stream-record/SettingsView';
import {SessionDialog} from '../stream-record/SessionDialog';
import {useMeetingSession} from '../stream-record/useMeetingSession';
import {sourceParts} from './structured-minutes';
import styles from './workspace.module.css';
export default function KoreanWorkspace(){
 const session=useMeetingSession();const [evidence,setEvidence]=useState<string|null>(null);const [focusMode,setFocusMode]=useState(false);
 useEffect(()=>{const original=document.documentElement.style.fontSize;try{const size=window.localStorage.getItem('stream-record.display-scale');if(size==='100'||size==='112.5'||size==='125')document.documentElement.style.fontSize=String(size)+'%';}catch{session.setNotice('화면 표시 설정을 읽지 못해 기본 크기로 표시합니다.');}return()=>{document.documentElement.style.fontSize=original;};},[]);
 const openEvidence=(id:string)=>{if(!sourceParts(session.rows).some(source=>source.id===id)){session.setError('근거 '+id+'에 해당하는 받아쓰기 구간이 없습니다. 회의록의 ID와 현재 원문을 확인하세요.');return;}const number=Number(id.match(/^S(\d+)/)?.[1]);session.setQuery('');session.setPage(Math.floor((session.rows.length-number)/300));session.setFollow(false);session.setEditing(null);setEvidence(id);session.navigate('transcript');};
 const utility=session.view==='ai'||session.view==='settings';
 return <AppShell session={session} focusMode={focusMode&&!utility} onFocusModeChange={()=>setFocusMode(false)}>
  <div hidden={utility}><RecordWorkspace session={session} evidence={evidence} onEvidence={openEvidence} onEvidenceShown={()=>setEvidence(null)} focusMode={focusMode} onFocusModeChange={()=>setFocusMode(value=>!value)}/></div>
  {utility&&<><a href="#dictation" onClick={()=>session.navigate('dictation')}>현재 기록으로 돌아가기</a>{session.error&&<div role="alert" className={styles.error}><p>{session.error}</p><button onClick={()=>session.setError('')}>오류 안내 닫기</button></div>}<p role="status" className={styles.hint}>{session.notice}</p></>}
  {session.view==='ai'&&<AiConnectionsView session={session}/>}
  {session.view==='settings'&&<SettingsView session={session}/>}
  <SessionDialog session={session}/>
 </AppShell>;
}

'use client';
import {useEffect,useState} from 'react';
import {AppShell} from '../stream-record/AppShell';
import {RecordingView} from '../stream-record/RecordingView';
import {DictationView} from '../stream-record/DictationView';
import {YoutubeView} from '../stream-record/YoutubeView';
import {TranscriptView} from '../stream-record/TranscriptView';
import {MinutesView} from '../stream-record/MinutesView';
import {AiConnectionsView} from '../stream-record/AiConnectionsView';
import {SettingsView} from '../stream-record/SettingsView';
import {SessionDialog} from '../stream-record/SessionDialog';
import {useMeetingSession} from '../stream-record/useMeetingSession';
import {sourceParts} from './structured-minutes';
import styles from './workspace.module.css';
export default function KoreanWorkspace(){
 const session=useMeetingSession();const [evidence,setEvidence]=useState<string|null>(null);const [trayNotice,setTrayNotice]=useState(false);
 useEffect(()=>{const original=document.documentElement.style.fontSize;try{const size=window.localStorage.getItem('stream-record.display-scale');if(size==='100'||size==='112.5'||size==='125')document.documentElement.style.fontSize=`${size}%`;setTrayNotice(window.localStorage.getItem('stream-record.tray-notice')!=='seen');}catch{setTrayNotice(true);}return()=>{document.documentElement.style.fontSize=original;};},[]);
 const openEvidence=(id:string)=>{if(!sourceParts(session.rows).some(source=>source.id===id)){session.setError(`근거 ${id}에 해당하는 전사 구간이 없습니다. 회의록의 ID와 현재 원문을 확인하세요.`);return;}const number=Number(id.match(/^S(\d+)/)?.[1]);session.setQuery('');session.setPage(Math.floor((session.rows.length-number)/300));session.setFollow(false);session.setEditing(null);setEvidence(id);session.navigate('transcript');};
 return <AppShell view={session.view} onNavigate={session.navigate} status={session.modeLabel} recording={session.mode==='recording'} onStop={()=>void session.stop()}>
  {session.error&&<div role="alert" className={styles.error}><p>{session.error}</p><button onClick={()=>session.setError('')}>오류 안내 닫기</button></div>}
  <div role="status" aria-live="polite" aria-atomic="true" className={styles.status}>{session.notice}</div>
  {session.mode==='importing'&&<div className={styles.importProgress}><label htmlFor="import-progress">파일 전사 진행률 {Math.round(session.progress)}%</label><progress id="import-progress" value={session.progress} max={100}/></div>}
  {session.savedPath&&<details className={styles.savedNotice}><summary>최근 저장 완료</summary><p>{session.savedPath}</p></details>}
  {session.view==='recording'&&<RecordingView session={session}/>}
  {session.view==='dictation'&&<DictationView session={session}/>}
  <div hidden={session.view!=='youtube'}><YoutubeView session={session}/></div>
  {session.view==='transcript'&&<TranscriptView session={session} evidence={evidence} onEvidenceShown={()=>setEvidence(null)}/>}
  {session.view==='minutes'&&<MinutesView session={session} onEvidence={openEvidence}/>}
  {session.view==='ai'&&<AiConnectionsView session={session}/>}
  {session.view==='settings'&&<SettingsView session={session}/>}
  {trayNotice&&<aside className={styles.information}><p><strong>창 닫기 안내</strong> 창의 X는 앱을 트레이로 숨깁니다. 완전히 종료하려면 설정 또는 트레이의 ‘Stream-Record 종료’를 사용하세요.</p><button onClick={()=>{setTrayNotice(false);try{window.localStorage.setItem('stream-record.tray-notice','seen');}catch{}}}>확인</button></aside>}
  <SessionDialog session={session}/>
 </AppShell>;
}

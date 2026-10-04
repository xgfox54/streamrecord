'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Download,PanelLeft,Plug,Settings,Square} from 'lucide-react';
import {useAppUpdate} from './useAppUpdate';
import type {MeetingSession} from './useMeetingSession';
import {RecordSidebar} from './RecordSidebar';
import {AppVersion} from './AppVersion';
import styles from '../meeting-ko/workspace.module.css';
import layout from './record-workspace.module.css';
export type WorkspaceView='recording'|'dictation'|'youtube'|'transcript'|'minutes'|'ai'|'settings';
export function AppShell({session:s,children,focusMode=false,onFocusModeChange}:{readonly session:MeetingSession;readonly children:ReactNode;readonly focusMode?:boolean;readonly onFocusModeChange?:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);const [listOpen,setListOpen]=useState(false);
 const updates=useAppUpdate(s,true);
 const utility=s.view==='ai'||s.view==='settings';const name=s.view==='ai'?'AI 연결':s.view==='settings'?'설정':s.title||'새 기록';
 useEffect(()=>{if(s.view==='transcript'&&document.activeElement?.id.startsWith('source-'))return;heading.current?.focus({preventScroll:true});setListOpen(false);},[s.view,s.activeRecordId]);
 return <div className={styles.workspace+' '+layout.shell} data-focus={focusMode}>
  <a className={styles.skip} href="#workspace-content" onClick={event=>{event.preventDefault();heading.current?.focus();}}>본문으로 바로가기</a>
  <header className={layout.appHeader}>
   <div className={layout.brandGroup}><button className={layout.listToggle} aria-label="기록 목록" aria-expanded={listOpen} aria-controls="record-sidebar" onClick={()=>setListOpen(value=>!value)}><PanelLeft size={20} aria-hidden="true"/></button><a href="#recording" className={styles.brand} onClick={()=>s.navigate('recording')}><img src="/streamrecord-icon.png" alt="" width={32} height={32}/><span>Stream-Record</span></a><span className={layout.localLabel}>이 PC의 기록</span></div>
   <div className={styles.headerState}>{updates.update&&<button className={layout.updateButton} disabled={!updates.ready||updates.phase==='installing'} title={updates.ready?`v${updates.update.version}로 업데이트 · 현재 기록을 저장하고 설치합니다`:'녹음·처리가 끝나면 업데이트할 수 있습니다'} onClick={()=>void updates.install()}><Download size={18} aria-hidden="true"/>{updates.phase==='installing'?'업데이트 준비 중…':`새 버전 v${updates.update.version} 업데이트`}</button>}<nav aria-label="도움 및 설정" className={layout.utilityNav}><a href="#ai" aria-current={s.view==='ai'?'page':undefined} onClick={()=>s.navigate('ai')}><Plug size={18} aria-hidden="true"/>AI 연결</a><a href="#settings" aria-current={s.view==='settings'?'page':undefined} onClick={()=>s.navigate('settings')}><Settings size={18} aria-hidden="true"/>설정</a></nav><AppVersion/>{focusMode&&<button onClick={onFocusModeChange}>집중 모드 끝내기</button>}<span className={s.mode==='recording'?styles.live:styles.badge}>{s.mode==='recording'&&<span aria-hidden="true" className={styles.recordDot}/>} {s.modeLabel}</span>{s.mode==='recording'&&<button onClick={()=>void s.stop()}><Square size={18} aria-hidden="true"/>녹음 중지</button>}</div>
  </header>
  <div className={layout.appBody} data-list-open={listOpen}>
   <aside id="record-sidebar" className={layout.sidebar} aria-label="기록 보관함"><RecordSidebar session={s} onSelected={()=>setListOpen(false)}/></aside>
   <main id="workspace-content" className={layout.main} data-utility={utility}><h1 ref={heading} tabIndex={-1} className={utility?layout.utilityHeading:layout.srOnly}>{name}</h1>{children}</main>
  </div>
 </div>;
}

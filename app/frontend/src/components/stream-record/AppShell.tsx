'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {Download,Plug,Settings,Square,Layers,Star,CheckCircle2,Plus,Mic,HardDrive} from 'lucide-react';
import {useAppUpdate} from './useAppUpdate';
import type {MeetingSession} from './useMeetingSession';
import {BrandMark} from './BrandMark';
import studio from './studio.module.css';
import {AppVersion} from './AppVersion';
import {CancelRecordingButton} from './CancelRecordingButton';
import styles from '../meeting-ko/workspace.module.css';
import layout from './record-workspace.module.css';
export type WorkspaceView='library'|'recording'|'dictation'|'youtube'|'transcript'|'minutes'|'ai'|'settings';
export function AppShell({session:s,children,focusMode=false,onFocusModeChange}:{readonly session:MeetingSession;readonly children:ReactNode;readonly focusMode?:boolean;readonly onFocusModeChange?:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 const updates=useAppUpdate(s,true);
 const utility=s.view==='ai'||s.view==='settings';const name=s.view==='library'?'나의 기록':s.view==='ai'?'AI 연결':s.view==='settings'?'설정':s.title||'새 기록';
 useEffect(()=>{if(s.view==='transcript'&&document.activeElement?.id.startsWith('source-'))return;heading.current?.focus({preventScroll:true});},[s.view,s.activeRecordId]);
 const filter=(value:MeetingSession['libraryFilter'])=>{s.setLibraryFilter(value);s.navigate('library');void s.refreshRecords().catch(error=>s.setError(s.messageOf(error)));};
 return <div className={styles.workspace+' '+layout.shell+' '+studio.theme} data-focus={focusMode}>
  <a className={styles.skip} href="#workspace-content" onClick={event=>{event.preventDefault();heading.current?.focus();}}>본문으로 바로가기</a>
  <header className={layout.appHeader+' '+studio.header}>
   <div className={layout.brandGroup}><a href="#library" className={studio.brand} onClick={()=>filter('all')}><BrandMark/><span>Stream Record</span></a><span className={layout.localLabel}>이 PC의 기록</span></div>
   <div className={styles.headerState}>{updates.update&&<button className={layout.updateButton} disabled={!updates.ready||updates.phase==='installing'} title={updates.ready?`v${updates.update.version}로 업데이트 · 현재 기록을 저장하고 설치합니다`:'녹음·처리가 끝나면 업데이트할 수 있습니다'} onClick={()=>void updates.install()}><Download size={18} aria-hidden="true"/>{updates.phase==='installing'?'업데이트 준비 중…':`새 버전 v${updates.update.version} 업데이트`}</button>}<nav aria-label="도움 및 설정" className={layout.utilityNav}><a href="#ai" aria-current={s.view==='ai'?'page':undefined} onClick={()=>s.navigate('ai')}><Plug size={18} aria-hidden="true"/>AI 연결</a><a href="#settings" aria-current={s.view==='settings'?'page':undefined} onClick={()=>s.navigate('settings')}><Settings size={18} aria-hidden="true"/>설정</a></nav><AppVersion/>{focusMode&&<button onClick={onFocusModeChange}>집중 모드 끝내기</button>}<span className={s.mode==='recording'?styles.live:styles.badge}>{s.mode==='recording'&&<span aria-hidden="true" className={styles.recordDot}/>} {s.modeLabel}</span>{s.mode==='recording'&&<button onClick={()=>void s.stop()}><Square size={18} aria-hidden="true"/>녹음 중지</button>}</div>
   <CancelRecordingButton session={s}/>
  </header>
  <div className={layout.appBody+' '+studio.body}>
   <aside id="record-sidebar" className={layout.sidebar+' '+studio.sidebar} aria-label="기록 보관함"><button className={styles.primary} disabled={!s.ready||s.recordSwitchBlocked} onClick={()=>void s.newRecord().then(()=>s.setRequestedInput('microphone')).catch(error=>s.setError(s.messageOf(error)))}><Plus size={20}/>새 녹음</button><nav className={studio.sidebarNav} aria-label="기록 탐색"><small>라이브러리</small><button className={studio.navLink} aria-current={s.view==='library'&&s.libraryFilter==='all'?'page':undefined} onClick={()=>filter('all')}><Layers size={18}/>전체 기록<span>{s.records.length}</span></button><button className={studio.navLink} aria-current={s.view==='library'&&s.libraryFilter==='star'?'page':undefined} onClick={()=>filter('star')}><Star size={18}/>중요 기록<span>{s.records.filter(record=>s.starredRecords.includes(record.id)).length}</span></button><button className={studio.navLink} aria-current={s.view==='library'&&s.libraryFilter==='review'?'page':undefined} onClick={()=>filter('review')}><CheckCircle2 size={18}/>검토할 기록</button><small>현재 작업</small><button className={studio.navLink} aria-current={!utility&&s.view!=='library'?'page':undefined} onClick={()=>s.navigate(s.mode==='recording'?'recording':'dictation')}><Mic size={18}/>{s.mode==='recording'?'녹음 중인 기록':'현재 기록'}</button></nav><div className={studio.sidebarFoot}><strong><HardDrive size={18}/> 나의 기록 공간</strong><p>원음과 검토본을 함께 보관합니다.</p><div className={studio.swatches} aria-hidden="true"><i/><i/><i/></div></div></aside>
   <main id="workspace-content" className={layout.main+' '+studio.main} data-utility={utility}><h1 ref={heading} tabIndex={-1} className={utility?layout.utilityHeading:layout.srOnly}>{name}</h1>{children}</main>
  </div>
 </div>;
}

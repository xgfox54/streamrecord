'use client';
import {useEffect,useState} from 'react';
import {PanelRight,Maximize2,FileText,MessageSquareText,ArrowLeft} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import {RecordToolbar,type RecordInput} from './RecordToolbar';
import {RecordVideo} from './RecordVideo';
import {DictationConversation} from './DictationConversation';
import {LiveSummaryPanel} from './LiveSummaryPanel';
import {MinutesView} from './MinutesView';
import {TranscriptView} from './TranscriptView';
import styles from '../meeting-ko/workspace.module.css';
import layout from './record-workspace.module.css';
export function RecordWorkspace({session:s,evidence,onEvidence,onEvidenceShown,focusMode,onFocusModeChange}:{readonly session:MeetingSession;readonly evidence:string|null;readonly onEvidence:(id:string)=>void;readonly onEvidenceShown:()=>void;readonly focusMode:boolean;readonly onFocusModeChange:()=>void}){
 const [input,setInput]=useState<RecordInput>('microphone');const [summaryOpen,setSummaryOpen]=useState(true);
 useEffect(()=>{if(s.view==='youtube')setInput('youtube');},[s.view]);
 useEffect(()=>{if(s.mode==='idle'||s.mode==='reviewing')setInput(s.videoUrl?'youtube':'microphone');},[s.activeRecordId,s.ready]);
 const isMinutes=s.view==='minutes';const isReview=s.view==='transcript';
 const selectInput=(next:RecordInput)=>{setInput(next);if(next==='microphone'||next==='pc')s.setRecordingKind(next);s.navigate(next==='youtube'?'youtube':'dictation');};
 return <div className={layout.recordWorkspace} data-video={input==='youtube'}>
  <div className={layout.recordHeading}><label className={layout.titleLabel}><span>기록 제목</span><input value={s.title} maxLength={100} disabled={s.busy} onChange={event=>s.setTitle(event.target.value)} placeholder="기록 제목을 입력하세요"/></label><div className={layout.recordActions}><button aria-pressed={focusMode} onClick={onFocusModeChange}><Maximize2 size={17} aria-hidden="true"/>읽기 집중 모드</button><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('bundle')}>기록 내보내기</button></div></div>
  <RecordToolbar session={s} input={input} onInputChange={selectInput}/>
  <div className={layout.sessionMessages}>
   {s.error&&<div role="alert" className={styles.error}><p>{s.error}</p><button onClick={()=>s.setError('')}>오류 안내 닫기</button></div>}
   <p role="status" aria-live="polite" aria-atomic="true">{s.notice}</p>
   {s.mode==='importing'&&<label>파일 전사 {Math.round(s.progress)}%<progress value={s.progress} max={100}/></label>}
   {s.savedPath&&<details><summary>저장 위치</summary><p>{s.savedPath}</p></details>}
  </div>
  <div className={layout.contentGrid} data-summary={summaryOpen&&!focusMode}>
   <div className={layout.documentColumn}>
    <div hidden={input!=='youtube'}><RecordVideo session={s}/></div>
    <div className={layout.documentTabs}><nav aria-label="현재 기록 보기"><a href="#dictation" aria-current={!isMinutes?'page':undefined} onClick={()=>s.navigate('dictation')}><MessageSquareText size={18} aria-hidden="true"/>3. 받아쓰기 <span>{s.rows.length}</span></a><a href="#minutes" aria-current={isMinutes?'page':undefined} onClick={()=>s.navigate('minutes')}><FileText size={18} aria-hidden="true"/>회의록</a></nav><button aria-expanded={summaryOpen&&!focusMode} aria-controls="record-summary" onClick={()=>{if(focusMode)onFocusModeChange();setSummaryOpen(value=>focusMode?true:!value);}}><PanelRight size={18} aria-hidden="true"/>{summaryOpen&&!focusMode?'요약 접기':'요약 열기'}</button></div>
    <div hidden={isMinutes||isReview} className={layout.conversationSurface}><DictationConversation session={s} compact video={input==='youtube'}/></div>
    <div hidden={!isMinutes} className={layout.resultSurface}><MinutesView session={s} onEvidence={onEvidence}/></div>
    {isReview&&<div className={layout.resultSurface}><button className={layout.backLink} onClick={()=>s.navigate('dictation')}><ArrowLeft size={18} aria-hidden="true"/>받아쓰기로 돌아가기</button><TranscriptView session={s} evidence={evidence} onEvidenceShown={onEvidenceShown}/></div>}
   </div>
   <aside id="record-summary" hidden={!summaryOpen||focusMode} className={layout.summaryRail} aria-label="현재 기록 요약"><LiveSummaryPanel session={s} compact/><div className={layout.summaryNext}><p>전사를 확인했다면</p><button disabled={!s.rows.length} onClick={()=>s.navigate('minutes')}>회의록 작성하기</button></div></aside>
  </div>
 </div>;
}

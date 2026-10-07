'use client';
import {useEffect,useRef,useState} from 'react';
import {PanelRight,Maximize2,ArrowLeft} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import {FeatureIcon} from './FeatureIcon';
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
 const [narrow,setNarrow]=useState(false);const [summaryActive,setSummaryActive]=useState(false);
 const [preparation,setPreparation]=useState<{id:string|null;open:boolean}|null>(null);
 const preparationOpen=preparation?.id===s.activeRecordId?preparation.open:!s.rows.length&&!s.minutes&&['idle','loading'].includes(s.mode);
 const setPreparationOpen=(open:boolean)=>setPreparation({id:s.activeRecordId,open});
 useEffect(()=>{const query=window.matchMedia('(max-width:1199px)');const sync=()=>{setNarrow(query.matches);if(!query.matches)setSummaryActive(false);};sync();query.addEventListener('change',sync);return()=>query.removeEventListener('change',sync);},[]);
 useEffect(()=>{setSummaryActive(false);},[s.activeRecordId]);
 useEffect(()=>{if(s.mode==='starting'||s.mode==='importing')setPreparationOpen(false);},[s.mode]);
 useEffect(()=>{if(s.view==='youtube')setInput('youtube');},[s.view]);
 useEffect(()=>{if(s.mode==='idle'||s.mode==='reviewing')setInput(s.recordingInput??(s.videoUrl?'youtube':'microphone'));},[s.activeRecordId,s.ready]);
 const isMinutes=s.view==='minutes';const isReview=s.view==='transcript';
 // '회의록 정리하기' opens the minutes tab and brings its title to the top of the scrolling area once it is visible.
 const conversation=useRef<HTMLDivElement>(null);const [revealDictation,setRevealDictation]=useState(false);
 const minutes=useRef<HTMLDivElement>(null);const summary=useRef<HTMLElement>(null);const [revealMinutes,setRevealMinutes]=useState(false);const [revealSummary,setRevealSummary]=useState(false);
 useEffect(()=>{if(!revealMinutes||!isMinutes)return;setRevealMinutes(false);minutes.current?.scrollIntoView({block:'start'});},[revealMinutes,isMinutes]);
 useEffect(()=>{if(!revealSummary)return;setRevealSummary(false);summary.current?.scrollIntoView({block:'start'});},[revealSummary,summaryActive,summaryOpen,focusMode]);
 useEffect(()=>{if(s.ready&&s.rows.length&&!s.videoUrl&&s.recordingInput!=='youtube')setRevealDictation(true);},[s.activeRecordId,s.ready]);
 useEffect(()=>{if(!revealDictation||isMinutes||isReview||summaryActive)return;setRevealDictation(false);conversation.current?.scrollIntoView({block:'start'});},[revealDictation,isMinutes,isReview,summaryActive]);
 const openDictation=()=>{setSummaryActive(false);s.navigate('dictation');setRevealDictation(true);};
 const openMinutes=()=>{setSummaryActive(false);s.navigate('minutes');setRevealMinutes(true);};
 const openSummary=()=>{if(focusMode){onFocusModeChange();setSummaryOpen(true);}if(narrow){setSummaryOpen(true);setSummaryActive(true);setRevealSummary(true);}else if(!focusMode){setSummaryOpen(value=>!value);}};
 const selectInput=(next:RecordInput)=>{setSummaryActive(false);setInput(next);s.setNotice('');if(next==='microphone'||next==='pc')s.setRecordingKind(next);s.navigate(next==='youtube'?'youtube':'dictation');};
 const workspace=useRef<HTMLDivElement>(null);const navigation=useRef<HTMLDivElement>(null);
 useEffect(()=>{const nav=navigation.current;if(!nav)return;const update=()=>workspace.current?.style.setProperty('--sr-navigation-height',`${nav.getBoundingClientRect().height}px`);update();const observer=new ResizeObserver(update);observer.observe(nav);return()=>observer.disconnect();},[]);
 return <div ref={workspace} className={layout.recordWorkspace} data-video={input==='youtube'}>
  <div className={layout.recordHeading}><label className={layout.titleLabel}><span>기록 제목</span><input value={s.title} maxLength={100} disabled={s.busy} onChange={event=>s.setTitle(event.target.value)} placeholder="기록 제목을 입력하세요"/></label><div className={layout.recordActions}><button aria-pressed={focusMode} onClick={onFocusModeChange}><Maximize2 size={17} aria-hidden="true"/>읽기 집중 모드</button><button disabled={s.saving||!s.rows.length} onClick={()=>s.save('bundle')}>기록 내보내기</button></div></div>
  <RecordToolbar session={s} input={input} onInputChange={selectInput} compact={!preparationOpen} onPreparationChange={setPreparationOpen}/>
  <div className={layout.sessionMessages}>
   {s.error&&<div role="alert" className={styles.error}><p>{s.error}</p><button onClick={()=>s.setError('')}>오류 안내 닫기</button></div>}
   <p role="status" aria-live="polite" aria-atomic="true" className={!preparationOpen&&s.notice==='기록을 불러왔습니다. 왼쪽 목록에서 저장한 기록을 다시 열 수 있습니다.'?layout.srOnly:undefined}>{s.notice}</p>
   {s.mode==='importing'&&<label>파일 받아쓰기 {Math.round(s.progress)}%<progress value={s.progress} max={100}/></label>}
   {s.savedPath&&<details><summary>저장 위치</summary><p>{s.savedPath}</p></details>}
  </div>
  <div ref={navigation} className={layout.documentTabs}><nav aria-label="현재 기록 보기"><a href="#dictation" aria-current={!isMinutes&&!summaryActive?'page':undefined} onClick={event=>{event.preventDefault();openDictation();}}><FeatureIcon kind="dictation" size="tab"/>받아쓰기 <span>{s.rows.length}</span></a><button className={layout.summaryTab} aria-pressed={summaryActive} aria-controls="record-summary" onClick={openSummary}><FeatureIcon kind="summary" size="tab"/>AI 요약</button><a href="#minutes" aria-current={isMinutes&&!summaryActive?'page':undefined} onClick={event=>{event.preventDefault();openMinutes();}}><FeatureIcon kind="minutes" size="tab"/>회의록</a></nav><div className={layout.documentActions}><button className={layout.summaryToggle} aria-expanded={summaryOpen&&!focusMode} aria-controls="record-summary" onClick={openSummary}><PanelRight size={18} aria-hidden="true"/>{summaryOpen&&!focusMode?'요약 접기':'요약 열기'}</button><button className={layout.organizeMinutes} disabled={!s.rows.length} onClick={openMinutes}>회의록 정리하기</button></div></div>
  <div className={layout.contentGrid} data-summary={summaryOpen&&!focusMode&&!narrow}>
   <div className={layout.documentColumn} hidden={narrow&&summaryActive&&!focusMode}>
    <div hidden={input!=='youtube'}><RecordVideo session={s}/></div>
    <div ref={conversation} hidden={isMinutes||isReview} className={layout.conversationSurface}><DictationConversation session={s} compact video={input==='youtube'} compactText={input==='microphone'||input==='pc'}/></div>
    <div ref={minutes} hidden={!isMinutes} className={`${layout.resultSurface} ${layout.minutesTarget}`}><MinutesView session={s} onEvidence={onEvidence}/></div>
    {isReview&&<div className={layout.resultSurface}><button className={layout.backLink} onClick={()=>s.navigate('dictation')}><ArrowLeft size={18} aria-hidden="true"/>받아쓰기로 돌아가기</button><TranscriptView session={s} evidence={evidence} onEvidenceShown={onEvidenceShown}/></div>}
   </div>
   <aside ref={summary} id="record-summary" hidden={!summaryOpen||focusMode||(narrow&&!summaryActive)} className={layout.summaryRail} aria-label="현재 기록 요약"><LiveSummaryPanel session={s} compact/><p className={styles.hint}>‘회의록 정리하기’에서 AI와 내용을 확인한 뒤 정리를 시작합니다.</p></aside>
  </div>
 </div>;
}

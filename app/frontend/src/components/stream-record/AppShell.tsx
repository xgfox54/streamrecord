'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {Mic,FileText,NotebookPen,Plug,Settings,Square,TextCursorInput,Youtube} from 'lucide-react';
import styles from '../meeting-ko/workspace.module.css';
export type WorkspaceView='recording'|'dictation'|'youtube'|'transcript'|'minutes'|'ai'|'settings';
type Page={id:WorkspaceView;name:string;description:string;icon:typeof Mic};
const groups:ReadonlyArray<{label:string;items:ReadonlyArray<Page>}>= [
 {label:'기록',items:[
  {id:'recording',name:'회의 녹음',description:'녹음과 동시에 전사와 현재 요약을 확인하세요.',icon:Mic},
  {id:'dictation',name:'받아쓰기',description:'말하는 내용을 큰 글자로 바로 확인하고 저장하세요.',icon:TextCursorInput},
  {id:'youtube',name:'YouTube 전사',description:'영상을 앱 안에서 보면서 소리와 전사를 함께 확인하세요.',icon:Youtube},
 ]},
 {label:'결과',items:[
  {id:'transcript',name:'전체 전사',description:'최초 원문을 보존하면서 발언을 검토하세요.',icon:FileText},
  {id:'minutes',name:'회의록',description:'검토한 전사를 근거가 있는 회의록으로 정리하세요.',icon:NotebookPen},
 ]},
 {label:'연결 및 설정',items:[
  {id:'ai',name:'AI 연결',description:'현재 사용 가능한 연결과 전송 위치를 확인하세요.',icon:Plug},
  {id:'settings',name:'설정',description:'표시 방식, 저장 위치와 앱 정보를 관리하세요.',icon:Settings},
 ]},
] as const;
const pages=groups.flatMap(group=>group.items);
export function AppShell({view,onNavigate,status,recording,onStop,children}:{view:WorkspaceView;onNavigate:(view:WorkspaceView)=>void;status:string;recording:boolean;onStop:()=>void;children:ReactNode}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(view==='transcript'&&document.activeElement?.id.startsWith('source-'))return;heading.current?.focus();},[view]);
 const page=pages.find(item=>item.id===view)??pages[0];
 return <div className={styles.workspace}>
  <a className={styles.skip} href="#workspace-content" onClick={event=>{event.preventDefault();heading.current?.focus();}}>본문으로 바로가기</a>
  <header className={styles.appHeader}><a href="#recording" className={styles.brand} onClick={()=>onNavigate('recording')}><img src="/streamrecord-icon.png" alt="" width={40} height={40}/><span>Stream-Record<small>한국어 음성 기록</small></span></a><div className={styles.headerState}><span className={recording?styles.live:styles.badge}>{recording&&<span aria-hidden="true" className={styles.recordDot}/>} {status}</span>{recording&&<button onClick={onStop}><Square size={18} aria-hidden="true"/>녹음 중지</button>}</div></header>
  <div className={styles.appBody}><aside className={styles.sidebar}><nav aria-label="주요 화면">{groups.map(group=><div className={styles.navGroup} key={group.label}><p>{group.label}</p>{group.items.map(item=><a key={item.id} href={`#${item.id}`} aria-current={view===item.id?'page':undefined} onClick={()=>onNavigate(item.id)}><item.icon size={21} aria-hidden="true"/>{item.name}</a>)}</div>)}</nav><p className={styles.sidebarNote}>기록은 이 PC에 보관됩니다.<br/>요약 전에는 AI 전송 위치를 확인하세요.</p></aside>
   <main id="workspace-content" className={styles.main}><div className={styles.pageHeading}><p className={styles.kicker}>음성을 기록으로, 기록을 업무로</p><h1 ref={heading} tabIndex={-1}>{page.name}</h1><p>{page.description}</p></div>{children}<footer className={styles.footer}>최근 작업 자동 저장 · 최초 전사 원문 보존 · 한국어 음성 인식</footer></main>
  </div>
 </div>;
}

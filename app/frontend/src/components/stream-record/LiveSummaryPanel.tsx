'use client';
import {Sparkles} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

export function LiveSummaryPanel({session:s}:{session:MeetingSession}){
 const chosen=s.models.find(item=>s.modelKey(item)===s.model);
 return <section className={`${styles.panel} ${styles.liveSummaryPanel}`} aria-label="실시간 요약">
  <div className={styles.panelHead}><div><p className={styles.eyebrow}>AI 보조</p><h2>현재까지의 요약</h2></div><span className={styles.badge}>{s.liveSummaryStatus}</span></div>
  <label className={styles.check}><input type="checkbox" checked={s.liveSummaryEnabled} onChange={event=>s.setLiveSummaryEnabled(event.target.checked)}/>확정 문장이 추가되면 요약 갱신</label>
  {s.models.length>0?<label className={styles.liveModelLabel}>요약 모델<select value={s.model} disabled={s.liveSummaryRunning} onChange={event=>s.setModel(event.target.value)}>{s.models.map(item=><option key={s.modelKey(item)} value={s.modelKey(item)}>{item.id} · {item.provider==='local'?'이 PC':'연결 계정/API'}</option>)}</select></label>:<div className={styles.liveEmpty}><Sparkles size={30} aria-hidden="true"/><h3>연결된 요약 모델이 없습니다</h3><p>녹음과 실시간 전사는 그대로 사용할 수 있습니다.</p><a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결 설정 열기</a></div>}
  {s.models.length>0?<div className={styles.liveSummaryText}>{s.liveSummary?<p>{s.liveSummary}</p>:<div className={styles.liveEmpty}><Sparkles size={30} aria-hidden="true"/><h3>{s.liveSummaryEnabled?'요약할 문장을 기다리는 중입니다':'실시간 요약은 선택 사항입니다'}</h3><p>{s.liveSummaryEnabled?'녹음 중 확정된 문장을 모아 핵심 내용을 표시합니다.':'위의 요약 갱신을 켜면 녹음 중 핵심 내용을 정리합니다. 받아쓰기는 그대로 사용할 수 있습니다.'}</p></div>}</div>:null}
  {chosen&&<p className={styles.hint}>{chosen.provider==='local'?'요약 내용은 이 PC의 로컬 모델에서 처리됩니다.':'확정 전사문이 사용자가 설정한 연결 서버로 전송됩니다.'}</p>}
 </section>;
}

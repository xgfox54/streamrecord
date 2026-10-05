'use client';
import {SummaryTimeline} from './SummaryTimeline';
import {rowTime} from '../meeting-ko/core';
import {FeatureIcon} from './FeatureIcon';
import {useEffect,useRef} from 'react';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import {ModelOptions,modelDestination} from './connections/modelPresentation';
import compactStyles from './compact-reader.module.css';

export function LiveSummaryPanel({session:s,compact=false}:{readonly session:MeetingSession;readonly compact?:boolean}){
 const finalRow=s.rows.filter(row=>!row.is_partial).at(-1);
 const chosen=s.models.find(item=>s.modelKey(item)===s.model);
 // The whole cumulative summary scrolls in place; a new summary follows to the bottom unless the reader scrolled up to reread.
 const scroll=useRef<HTMLDivElement>(null);const follow=useRef(true);
 useEffect(()=>{const node=scroll.current;if(node&&follow.current)node.scrollTop=node.scrollHeight;},[s.liveSummary]);
 const modelControl=<label className={styles.liveModelLabel}>요약 모델<select value={s.model} disabled={s.liveSummaryRunning} onChange={event=>s.setModel(event.target.value)}><option value="">사용할 모델 선택</option><ModelOptions session={s}/></select></label>;
 return <section className={`${styles.panel} ${styles.liveSummaryPanel} ${compact?compactStyles.summary:''}`} aria-label="실시간 요약">
  <div className={styles.panelHead}><div>{!compact&&<p className={styles.eyebrow}>AI 보조</p>}<h2 className={styles.featureHeading}><FeatureIcon kind="summary"/><span>{compact?'AI 요약':'현재까지의 요약'}</span></h2></div><span className={styles.badge} role="status">{s.liveSummaryStatus}</span></div>
  <label className={styles.check}><input type="checkbox" checked={s.liveSummaryEnabled} disabled={compact&&!chosen} onChange={event=>s.setLiveSummaryEnabled(event.target.checked)}/>{compact?'실시간 요약 켜기':'확정 문장이 추가되면 요약 갱신'}</label>
  {s.models.length>0?compact?<details className={compactStyles.options}><summary>{chosen?`요약 AI · ${chosen.id}`:'요약 AI 선택'}</summary><div className={compactStyles.optionBody}>{modelControl}{chosen&&<p className={styles.hint}>전송 위치: {modelDestination(chosen)}</p>}</div></details>:modelControl:<div className={`${styles.liveEmpty} ${compact?compactStyles.empty:''}`}><FeatureIcon kind="summary" size="empty"/><h3>연결된 요약 모델이 없습니다</h3><p>녹음과 실시간 받아쓰기는 그대로 사용할 수 있습니다.</p><a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결 설정 열기</a></div>}
  {s.models.length>0||s.liveSummary?<div ref={scroll} data-testid="live-summary-scroll" tabIndex={s.liveSummary?0:undefined} role={s.liveSummary?'region':undefined} aria-label={s.liveSummary?'전체 요약 내용':undefined} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<48;}} className={`${styles.liveSummaryText} ${styles.liveSummaryScroll} ${compact?compactStyles.summaryText:''}`}>{s.liveSummary?<SummaryTimeline text={s.liveSummary} fallbackTime={finalRow?rowTime(finalRow):null}/>:<div className={`${styles.liveEmpty} ${compact?compactStyles.empty:''}`}><FeatureIcon kind="summary" size="empty"/><h3>{s.liveSummaryEnabled?'요약할 문장을 기다리는 중입니다':'실시간 요약은 선택 사항입니다'}</h3><p>{s.liveSummaryEnabled?'녹음 중 확정된 문장을 모아 핵심 내용을 표시합니다.':'위의 요약 갱신을 켜면 녹음 중 핵심 내용을 정리합니다. 받아쓰기는 그대로 사용할 수 있습니다.'}</p></div>}</div>:null}
  <p className={styles.hint}>받아쓰기 오류 가능성이 있어 사용자 확인이 필요한 내용은 빨간색 글자로 표시됩니다.</p>
  {chosen&&!compact&&<p className={styles.hint}>전송 위치: {modelDestination(chosen)}</p>}
 </section>;
}

'use client';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import {ModelOptions,modelDestination} from './connections/modelPresentation';
export function MinutesView({session:s,onEvidence}:{session:MeetingSession;onEvidence:(id:string)=>void}){
 const selected=s.models.find(model=>s.modelKey(model)===s.model);const evidence=Array.from(new Set(s.minutes.match(/\bS\d{6}(?:p\d+)?\b/g)||[]));
 return <section className={styles.panel}><div className={styles.panelHead}><h2>{s.title||'회의록'}</h2><span className={styles.badge}>{s.mode==='summarizing'?'구간 처리 중':s.minutes?'편집 가능한 회의록 초안':'생성 전'}</span></div>
  <p>전사 내용을 확인한 뒤 생성하세요. 녹음·변환 중에는 회의록을 생성하지 않습니다.</p><div className={styles.modelRow}><label>요약 모델<select value={s.model} disabled={s.busy} onChange={event=>s.setModel(event.target.value)}><option value="">사용할 모델 선택</option><ModelOptions session={s}/></select></label><button disabled={s.busy} onClick={()=>void s.refreshModels().catch(error=>s.setError(s.messageOf(error)))}>모델 새로고침</button></div>
  <div className={styles.destination}><strong>전송 위치</strong><p>{selected?modelDestination(selected):'모델을 선택하면 실제 연결 경로를 표시합니다.'}</p></div>
  <div className={styles.actions}><button className={styles.primary} disabled={s.busy||!s.rows.length||!selected} onClick={()=>void s.summarize()}>회의록 생성</button>{s.mode==='summarizing'&&<button onClick={()=>{s.cancelSummary.current=true;s.setNotice('현재 구간 응답과 저장이 끝나면 취소합니다. 완료된 구간은 보존됩니다.');}}>현재 구간 처리 후 취소</button>}<a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결 관리</a></div>
  <p className={styles.hint}>{s.busy?'현재 처리가 끝난 뒤 생성할 수 있습니다.':!s.rows.length?'전사 원문이 필요합니다. 녹음 또는 파일 전사를 먼저 완료하세요.':!selected?'서버를 준비하고 사용 가능한 모델을 선택하세요.':'구간 ID와 인용을 확인하며 생성합니다. 인용 일치 검사는 사실관계 검증을 대신하지 않습니다.'}</p>
  <label className={styles.minutesLabel}>회의록 본문 (Markdown)<textarea className={styles.minutes} value={s.minutes} disabled={s.busy} onChange={event=>s.setMinutes(event.target.value)} placeholder="생성한 회의록이 여기에 표시됩니다. 기존 Markdown 회의록도 원래 형식으로 유지됩니다."/></label>
  {evidence.length>0&&<details open className={styles.disclosure}><summary>전사 근거 찾아가기 · {evidence.length}개</summary><p className={styles.hint}>회의록에 적힌 ID의 전사 구간으로 이동합니다. 잘못된 ID는 오류로 표시합니다.</p><div className={styles.actions}>{evidence.map(id=><button key={id} onClick={()=>onEvidence(id)}>{id} 원문 보기</button>)}</div></details>}
  <div className={styles.actions}><button disabled={s.saving||!s.minutes} onClick={()=>s.save('minutes')}>회의록 Markdown 저장</button><button disabled={s.saving||(!s.rows.length&&!s.minutes)} onClick={()=>s.save('bundle')}>원문·검토본·회의록 JSON 저장</button></div><p className={styles.hint}>결정사항·담당자·기한은 원문 근거를 대조하세요. 기존 Markdown에 없는 구조화 항목을 임의로 채우지 않습니다.</p>
 </section>;
}

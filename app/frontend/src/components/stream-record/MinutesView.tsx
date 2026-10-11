'use client';
import {useState} from 'react';
import {FolderOpen} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {FeatureIcon} from './FeatureIcon';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import {modelDestination} from './connections/modelPresentation';
import {sourceLabel} from '../meeting-ko/core';
import {MinutesDocument} from './MinutesDocument';
import documentStyles from './minutes.module.css';
export function MinutesView({session:s,onEvidence}:{session:MeetingSession;onEvidence:(id:string)=>void}){
 const selected=s.models.find(model=>s.modelKey(model)===s.model);const evidence=Array.from(new Set(s.minutes.match(/\bS\d{6}(?:p\d+)?\b/g)||[]));
 const [editingRecord,setEditingRecord]=useState<{id:string|null;active:boolean}>({id:null,active:false});
 const editing=editingRecord.id===s.activeRecordId&&editingRecord.active;
 return <section className={styles.panel}><div className={styles.panelHead}><h2 className={styles.featureHeading}><FeatureIcon kind="minutes"/><span>{s.minutes?'회의록':s.title||'회의록'}</span></h2><span className={styles.badge}>{s.mode==='summarizing'?'구간 처리 중':s.minutes?'편집 가능한 회의록 초안':'생성 전'}</span></div>
  <details key={s.minutes?'result':'empty'} open={!s.minutes||s.mode==='summarizing'} className={styles.disclosure}><summary>회의록 생성 설정</summary>
  <p>AI와 받아쓰기 내용을 확인하세요.<br/>아래 ‘회의록 생성’을 누르면 정리를 시작합니다.<br/>녹음·변환이 끝난 뒤에 회의록을 생성할 수 있습니다.</p><div className={styles.modelRow}><p>사용할 AI: <strong>{selected?selected.id:'선택되지 않음'}</strong><br/><small>받아쓰기 보정·실시간 요약과 같은 AI를 사용합니다.</small></p><a href="#ai" onClick={()=>s.navigate('ai')}>{selected?'사용할 AI 변경':'AI 연결하기'}</a></div>
  <details className={styles.disclosure}><summary>AI 처리 위치</summary><p>{selected?modelDestination(selected):'AI를 선택하면 연결 위치를 표시합니다.'}</p></details>
  <div className={styles.actions}><button className={styles.primary} disabled={s.busy||!s.rows.length||!selected} onClick={()=>{setEditingRecord({id:s.activeRecordId,active:false});void s.summarize();}}>회의록 생성</button>{s.mode==='summarizing'&&<button onClick={()=>{s.cancelSummary.current=true;s.setNotice('현재 구간 응답과 저장이 끝나면 취소합니다. 완료된 구간은 보존됩니다.');}}>현재 구간 처리 후 취소</button>}<a href="#ai" onClick={()=>s.navigate('ai')}>AI 연결 관리</a></div>
  <p className={styles.hint}>{s.busy?'현재 처리가 끝난 뒤 생성할 수 있습니다.':!s.rows.length?'받아쓰기 원문이 필요합니다. 녹음 또는 파일 받아쓰기를 먼저 완료하세요.':!selected?'AI 연결에서 사용할 AI를 선택하면 회의록을 생성할 수 있습니다.':'받아쓰기를 바탕으로 정리합니다. 중요한 숫자·결정사항은 원음과 대조하세요.'}</p>
  </details>
  {(s.minutesError||s.minutesProgress)&&<div className={styles.destination} data-testid="minutes-feedback" role={s.minutesError?'alert':'status'} aria-live={s.minutesError?'assertive':'polite'}>
   <strong>{s.minutesError?'회의록 생성을 완료하지 못했습니다.':s.mode==='summarizing'?'회의록 생성 진행 상황':'회의록 생성 결과'}</strong>
   <p>{s.minutesError||s.minutesProgress}</p>
   {s.minutesError&&<p>받아쓰기와 완료된 구간은 보존됩니다. 사용할 AI와 연결 상태를 확인한 뒤 ‘회의록 생성’을 다시 누르세요. 같은 AI이면 이미 처리한 묶음은 건너뜁니다. 받아쓰기를 고친 묶음만 다시 처리합니다.</p>}
   {s.mode==='summarizing'&&!s.minutesError&&<p>긴 기록은 여러 묶음으로 처리하며 완료된 결과를 구간마다 저장합니다. AI 응답이 늦으면 몇 분 동안 같은 구간이 표시될 수 있습니다.</p>}
  </div>}
  <div className={documentStyles.toolbar} role="group" aria-label="회의록 표시 방식"><button type="button" aria-pressed={!editing} onClick={()=>setEditingRecord({id:s.activeRecordId,active:false})}>회의록 보기</button><button type="button" aria-pressed={editing} disabled={s.busy} onClick={()=>setEditingRecord({id:s.activeRecordId,active:true})}>직접 수정</button></div>
  {editing?<label className={styles.minutesLabel}>회의록 본문 (Markdown)<textarea className={styles.minutes} value={s.minutes} disabled={s.busy} onChange={event=>s.setMinutes(event.target.value)} placeholder="생성한 회의록을 직접 수정하거나 Markdown 회의록을 입력하세요."/></label>:s.minutes?<MinutesDocument text={s.minutes} onEvidence={onEvidence}/>:<p className={documentStyles.empty}>{s.mode==='summarizing'?'회의록을 정리하고 있습니다. 완료되면 여기에 문서로 표시합니다.':'받아쓰기를 마친 뒤 회의록을 생성하면 제목과 주제별 내용이 정리됩니다.'}</p>}
  {evidence.length>0&&<details className={styles.disclosure}><summary>받아쓰기 근거 찾아가기 · {evidence.length}개</summary><p className={styles.hint}>회의록에 적힌 ID의 받아쓰기 구간으로 이동합니다. 잘못된 ID는 오류로 표시합니다.</p><div className={styles.actions}>{evidence.map(id=><button key={id} onClick={()=>onEvidence(id)}>{sourceLabel(id)} 원문 보기</button>)}</div></details>}
  <div className={styles.actions}><button disabled={s.saving||!s.minutes} onClick={()=>s.save('minutes')}>회의록 Markdown 저장</button><button disabled={s.saving||(!s.rows.length&&!s.minutes)} onClick={()=>s.save('bundle')}>원문·검토본·회의록 JSON 저장</button><button onClick={()=>void invoke('ko_open_exports_folder').catch(error=>s.setError(`저장 폴더 열기 실패: ${s.messageOf(error)}`))}><FolderOpen size={18} aria-hidden="true"/>저장 폴더 열기</button></div><p className={styles.hint}>결정사항·담당자·기한은 원문 근거를 대조하세요. 기존 Markdown에 없는 구조화 항목을 임의로 채우지 않습니다.</p>
 </section>;
}

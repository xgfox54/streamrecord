'use client';
import {SpeakerLabel} from './SpeakerLabel';
import {DiarizationControls} from './DiarizationControls';
import {QueueRecoveryPanel} from './QueueRecoveryPanel';
import {useEffect,useRef,useState} from 'react';
import {convertFileSrc} from '@tauri-apps/api/core';
import {repeatedPassages} from '../meeting-ko/transcript-review';
import guide from './guidance.module.css';
import {rowTime,segmentLabel} from '../meeting-ko/core';
import {reviewText} from '../meeting-ko/structured-minutes';
import {playbackRange} from '../meeting-ko/review-core';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
export function TranscriptView({session:s,evidence,onEvidenceShown}:{session:MeetingSession;evidence:string|null;onEvidenceShown:()=>void}){
 const scroll=useRef<HTMLDivElement>(null);const previous=useRef(s.rows.length);const [newRows,setNewRows]=useState(0);
 const [repeatsOnly,setRepeatsOnly]=useState(false);const repeats=repeatedPassages(s.rows);
 const filtered=s.rows.map((row,index)=>({row,index})).filter(({row,index})=>(!repeatsOnly||repeats.has(index))&&(!s.query||`${row.text}\n${reviewText(row)}`.toLocaleLowerCase().includes(s.query.toLocaleLowerCase())));
 const maxPage=Math.max(0,Math.ceil(filtered.length/300)-1);const page=Math.min(s.page,maxPage);
 const displayed=filtered.slice(Math.max(0,filtered.length-(page+1)*300),filtered.length-page*300);
 useEffect(()=>{const added=Math.max(0,s.rows.length-previous.current);previous.current=s.rows.length;
  if(s.follow&&page===0&&!s.query&&s.editing===null){const container=scroll.current;if(container)container.scrollTop=container.scrollHeight;setNewRows(0);}else if(added)setNewRows(value=>value+added);
 },[s.rows,s.follow,page,s.query,s.editing]);
 useEffect(()=>{if(!evidence)return;if(repeatsOnly){setRepeatsOnly(false);return;}const target=document.getElementById(`source-${evidence.replace(/p\d+$/,'')}`);if(target){target.focus();target.scrollIntoView({block:'center'});onEvidenceShown();}},[evidence,page,repeatsOnly,onEvidenceShown]);
 const recent=()=>{s.setEditing(null);s.setQuery('');setRepeatsOnly(false);s.setPage(0);s.setFollow(true);setNewRows(0);};
 return <section className={styles.panel} aria-label="받아쓰기 원문과 검토본"><div className={styles.panelHead}><h2>받아쓰기 원문 <span className={styles.badge}>{s.rows.length}구간</span></h2><label className={styles.check}><input type="checkbox" checked={s.follow} onChange={event=>{s.setFollow(event.target.checked);if(event.target.checked)recent();}}/>새 구간 따라가기</label></div>
  <p className={styles.hint}>최초 원문은 수정되지 않습니다. 검토본 편집은 사람이 검증을 마쳤다는 뜻이 아닙니다. 참여자 번호는 저장 원음 분석 결과이며 사람 이름을 식별하지 않습니다.</p>
  <div className={guide.reviewToolbar}><p>{s.audioSource?'원음이 연결됐습니다. 각 문장의 듣기 버튼으로 확인하세요.':'오인식이 의심되나요? 원음을 연결하면 문장별로 다시 들을 수 있습니다.'}</p><button disabled={s.busy} onClick={()=>void s.prepareAudio(false)}>{s.audioSource?'연결된 원음 확인':'원음 연결하고 검토'}</button></div>
  <DiarizationControls session={s}/><QueueRecoveryPanel session={s}/>
  {repeats.size>0&&<label className={styles.check}><input type="checkbox" checked={repeatsOnly} onChange={event=>{setRepeatsOnly(event.target.checked);s.setPage(0);s.setFollow(false);}}/>반복 확인 대상만 보기 · {repeats.size}구간 (원문은 그대로 보존)</label>}
  <label>전체 받아쓰기 검색<input type="search" value={s.query} placeholder="원문과 검토본 전체에서 검색" onChange={event=>{s.setQuery(event.target.value);s.setPage(0);s.setFollow(false);}}/></label>
  <div className={styles.actions}><button disabled={page>=maxPage} onClick={()=>{s.setPage(page+1);s.setFollow(false);}}>앞선 300구간</button><button disabled={page===0} onClick={()=>{s.setPage(page-1);s.setFollow(false);}}>다음 300구간</button><button onClick={recent}>최신 구간 보기{newRows>0?` · 새 구간 ${newRows}개`:''}</button></div><p className={styles.hint}>검색 결과 {filtered.length}구간 · {page+1}/{maxPage+1}페이지 (시간 순). 검색은 표시된 페이지뿐 아니라 모든 원문·검토본에 적용됩니다.</p>
  <div ref={scroll} className={styles.transcript} role="log" aria-live="off" aria-label="받아쓰기 구간 목록" onScroll={event=>{const element=event.currentTarget;if(element.scrollHeight-element.scrollTop-element.clientHeight>64)s.setFollow(false);}}>
   {!s.rows.length&&<div className={styles.empty}><h3>아직 받아쓰기 내용이 없습니다</h3><p>녹음을 시작하거나 권한이 있는 녹음파일을 첨부하세요.</p><a href="#recording" onClick={()=>s.navigate('recording')}>녹음 화면으로 이동</a></div>}
   {s.rows.length>0&&!filtered.length&&<p className={styles.empty}>일치하는 구간이 없습니다. 다른 검색어를 입력하세요.</p>}
   {displayed.map(({row,index})=>{const id=`S${String(index+1).padStart(6,'0')}`;const label=segmentLabel(index);const reviewed=typeof row.reviewed_text==='string';return <article tabIndex={-1} id={`source-${id}`} key={row.sequence_id??row.id??id} className={styles.segment}><div className={styles.segmentHeading}><time>{rowTime(row)}</time><SpeakerLabel row={row}/><span>{label}</span><span className={reviewed?styles.reviewBadge:styles.badge}>{row.is_partial?'미확정':reviewed?'검토본 있음 · 검증 미확인':'최초 원문'}</span></div>
    {s.editing===index?<label>검토본 편집<textarea autoFocus disabled={s.busy} value={reviewText(row)} onChange={event=>s.setRows(s.rows.map((item,i)=>i===index?{...item,reviewed_text:event.target.value}:item))}/></label>:<p>{reviewText(row)}</p>}
    <div>{repeats.has(index)&&<p className={guide.reviewHint}>앞 구간과 같은 문장이 가까운 시간에 있습니다. 실제 반복 발언인지 원음을 들어 확인하세요.</p>}</div>
    <div className={styles.actions}><button disabled={s.busy||!s.audioSource||!playbackRange(row,s.audioSource.duration_seconds)} onClick={()=>s.playRow(row)} aria-label={`${label} 듣기`}>구간 듣기</button><button disabled={s.busy||row.is_partial} onClick={()=>{s.setFollow(false);if(s.editing===index){void s.persist().then(()=>{s.setEditing(null);s.setNotice(`${label} 검토본을 저장했습니다. 최초 원문은 유지됩니다.`);}).catch(error=>s.setError(s.messageOf(error)));}else s.setEditing(index);}}>{s.editing===index?'검토본 저장':'검토본 수정'}</button></div>
    {reviewed&&<details className={styles.disclosure}><summary>AI 최초 원문 보기</summary><p>{row.text}</p></details>}
   </article>;})}
  </div>
  <div className={styles.actions}><button className={styles.primary} disabled={s.saving||!s.rows.length} onClick={()=>s.save('transcript')}>전체 최초 원문 TXT 저장</button><button disabled={s.saving||(!s.rows.length&&!s.minutes)} onClick={()=>s.save('bundle')}>원문·검토본 JSON 저장</button></div>
  <details className={styles.disclosure}><summary>원음 듣기와 저장 음성 받아쓰기·이어하기</summary><p>구간 듣기는 원음 연결과 시간정보가 있어야 사용할 수 있습니다. 연결할 때 SHA-256을 확인합니다. 받아쓰기·이어하기는 24초 구간마다 결과를 저장합니다.</p><div className={styles.actions}><button disabled={s.busy} onClick={()=>void s.prepareAudio(false)}>연결된 원음 준비</button><button disabled={s.busy} onClick={()=>void s.prepareAudio(true)}>원음 파일 다시 선택</button><button disabled={s.busy||!s.audioSource||!s.consent} onClick={()=>void s.recover()}>저장 음성 받아쓰기·이어하기</button>{s.mode==='recovering'&&<button onClick={()=>{s.cancelRecovery.current=true;s.setNotice('현재 음성 구간 저장 후 중단합니다.');}}>현재 구간 후 중단</button>}</div><p className={styles.hint}>{!s.consent?'녹음 화면에서 녹음·처리 권한을 확인한 뒤 받아쓰기·이어하기를 실행하세요.':'기존 원문이 있으면 JSON으로 보관한 뒤 새 결과를 적용합니다.'}</p></details>
  {s.audioSource&&<div className={styles.audioPanel}><p className={styles.hint}>연결된 원음: {s.audioSource.filename}</p><audio ref={s.audioElement} controls preload="metadata" src={convertFileSrc(s.audioSource.path)} onPlay={()=>{if(s.modeRef.current!=='idle')s.audioElement.current?.pause();}} onTimeUpdate={()=>{const player=s.audioElement.current;if(player&&s.playbackEnd.current!==null&&player.currentTime>=s.playbackEnd.current){player.pause();s.playbackEnd.current=null;}}} onError={()=>s.setError('원음 재생 실패. 지원하는 음성 파일인지 확인하고 다시 선택하세요.')} aria-label="연결한 원본 음성 재생"/></div>}
 </section>;
}

'use client';
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {z} from 'zod';
import {readRows,type TranscriptRow} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
const candidateSchema=z.object({directory:z.string(),sessionId:z.string().nullable(),pending:z.number(),failed:z.number(),deferred:z.number(),cancelled:z.number(),resultCount:z.number(),partialWrites:z.number(),active:z.boolean(),legacy:z.boolean(),inspectionError:z.string().nullable().optional()}).passthrough();
type Candidate=z.infer<typeof candidateSchema>;
const resultSchema=z.object({rows:z.array(z.object({sourceId:z.string(),update:z.unknown()})),complete:z.boolean(),pending:z.number(),failed:z.number(),deferred:z.number(),cancelled:z.number(),partialWrites:z.number()}).passthrough();
export function QueueRecoveryPanel({session:s}:{readonly session:MeetingSession}){
 const [candidates,setCandidates]=useState<Candidate[]>([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [retryFailed,setRetryFailed]=useState(false);const [preview,setPreview]=useState<{rows:TranscriptRow[];complete:boolean;remaining:string}|null>(null);
 const refresh=async()=>{setLoading(true);setError('');try{setCandidates(z.array(candidateSchema).parse(await invoke('ko_list_transcription_recovery')));}catch(reason){setError(String(reason));}finally{setLoading(false);}};
 useEffect(()=>{if(s.ready)void refresh();},[s.ready]);
 const resume=async(candidate:Candidate)=>{if(s.busy||loading)return;setLoading(true);setError('');setPreview(null);s.setRecoveryBusy(true);
  try{const result=resultSchema.parse(await invoke('ko_resume_transcription_recovery',{directory:candidate.directory,retryFailed}));const rows=readRows(result.rows.map(item=>({...z.record(z.unknown()).parse(item.update),id:item.sourceId,recovery_source_id:item.sourceId})));setPreview({rows,complete:result.complete,remaining:`미처리 ${result.pending} · 실패 ${result.failed} · 보류 ${result.deferred+result.cancelled} · 부분 쓰기 ${result.partialWrites}`});}
  catch(reason){setError(String(reason));}finally{setLoading(false);s.setRecoveryBusy(false);}
 };
 return <details className={styles.disclosure}><summary>중단된 녹음의 미처리 받아쓰기 복구 {candidates.length>0?`· ${candidates.length}개`:''}</summary><p>앱 종료 전에 디스크에 저장한 음성 구간을 다시 처리합니다. 복구 결과는 먼저 확인하며 기존 작업에 자동으로 합치지 않습니다.</p><div className={styles.actions}><button disabled={s.busy||loading} onClick={()=>void refresh()}>복구할 기록 찾기</button><label className={styles.check}><input type="checkbox" disabled={s.busy||loading} checked={retryFailed} onChange={event=>setRetryFailed(event.target.checked)}/>실패했던 구간도 재시도</label></div>
 {loading&&<p role="status">저장된 받아쓰기 대기열 처리 중입니다. 원본 음성은 보존됩니다.</p>}{error&&<p role="alert">{error}</p>}
 {!loading&&!candidates.length&&<p>발견된 복구 대기열이 없습니다.</p>}
 {candidates.map((candidate,index)=><div key={candidate.directory} className={styles.connectionCard}><h3>녹음 기록 {index+1}</h3><p>미처리 {candidate.pending} · 실패 {candidate.failed} · 보류 {candidate.deferred+candidate.cancelled} · 저장 결과 {candidate.resultCount} · 부분 쓰기 {candidate.partialWrites}</p>{candidate.active&&<p>현재 다른 녹음 작업이 사용 중입니다.</p>}{candidate.legacy&&<p>이전 버전의 세션 연결정보가 없습니다. 원음 파일의 받아쓰기·이어하기를 사용하세요.</p>}{candidate.inspectionError&&<p>대기열 정보를 읽지 못했습니다: {candidate.inspectionError}</p>}<button disabled={s.busy||loading||candidate.active||candidate.legacy||Boolean(candidate.inspectionError)} onClick={()=>void resume(candidate)}>{candidate.pending+candidate.failed+candidate.deferred+candidate.cancelled?'미처리 구간 복구':'저장된 복구 결과 보기'}</button></div>)}
 {preview&&<div><p role="status">{preview.complete?'대기열 처리 완료':'일부 구간 미처리'} · {preview.rows.length}개 받아쓰기 결과</p><p>{preview.remaining}</p><p>이 결과는 디스크 대기열에 남아 있던 구간입니다. 녹음 전체 받아쓰기와 같다는 뜻은 아닙니다. 적용하면 현재 작업을 JSON으로 보관한 뒤 별도 작업으로 엽니다.</p><button disabled={s.busy||!preview.rows.length} onClick={()=>void s.applyQueueRecovery(preview.rows,preview.complete).then(()=>setPreview(null)).catch(reason=>setError(String(reason)))}>현재 작업 보관 후 복구 결과 열기</button></div>}
 </details>;
}

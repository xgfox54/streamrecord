'use client';
import {useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {z} from 'zod';
import type {MeetingSession} from '../useMeetingSession';
import {catalogSchema,connectionTemplates,errorMessage,type ConnectionProfile,type ProfileInput} from './contracts';
import {ProfileEditor} from './ProfileEditor';
import styles from '../../meeting-ko/workspace.module.css';

type Props={readonly profile:ConnectionProfile;readonly session:MeetingSession;readonly onSave:(input:ProfileInput)=>Promise<void>;readonly onRemove:(id:string)=>Promise<void>};
export function ProfileCard({profile,session:s,onSave,onRemove}:Props){
 const [editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [catalog,setCatalog]=useState('미확인');
 const [inference,setInference]=useState('미실행');
 const [model,setModel]=useState('');
 const models=s.models.filter(item=>item.provider===`connection:${profile.id}`);
 const available=Array.from(new Set([...models.map(item=>item.id),...profile.manualModelIds]));
 const template=connectionTemplates.find(item=>item.kind===profile.kind);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}};
 const testCatalog=()=>run(async()=>{
  setCatalog('확인 중');
  try{const result=catalogSchema.parse(await invoke('ko_test_connection',{id:profile.id}));setCatalog(profile.manualModelIds.length?`목록 조회 완료 · ${result.models.length}개 (직접 입력 포함)`:`${result.models.length}개 응답 수신`);await s.refreshModels();}
  catch(reason){setCatalog('목록 조회 실패');throw reason;}
 });
 const testInference=()=>run(async()=>{
  setInference('시험 요청 중');
  try{const result=z.object({inference:z.literal(true),destination:z.string(),responseCharacters:z.number().positive()}).parse(await invoke('ko_probe_connection',{id:profile.id,model}));setInference(`시험 응답 수신 · ${result.responseCharacters}자 · 회의록 품질은 별도 확인`);}
  catch(reason){setInference('시험 실패');throw reason;}
 });
 return <article className={styles.connectionCard} aria-label={profile.label}>
  <span className={styles.badge}>{profile.enabled?'사용 켜짐':'사용 꺼짐'}</span><h3>{profile.label}</h3><p>{template?.title}</p><code>{profile.base}</code>
  {editing?<ProfileEditor profile={profile} kind={profile.kind} onCancel={()=>setEditing(false)} onSave={async input=>{await onSave(input);setEditing(false);setCatalog('설정 변경 · 다시 확인 필요');setInference('설정 변경 · 다시 시험 필요');setModel('');}}/>:<>
   <dl className={styles.facts}>
    <div><dt>인증 정보</dt><dd>{profile.hasApiKey?'OS 보안 저장소에 저장됨':'저장된 인증 정보 없음'}</dd></div>
    <div><dt>모델 목록</dt><dd>{catalog==='미확인'&&models.length?`${models.length}개 모델 · 응답 시험 전`:catalog}</dd></div>
    <div><dt>실제 추론</dt><dd><span role="status">{inference}</span></dd></div>
   </dl>
   {!profile.enabled&&<p className={styles.hint}>연결 수정에서 ‘이 연결의 모델 사용’을 켜면 목록 조회와 시험 요청을 할 수 있습니다.</p>}
   <p className={styles.hint}>모델 목록 조회는 서버가 요청을 허용했다는 뜻이며, 계정의 추론 권한·요약 품질까지 확인한 것은 아닙니다.</p>
   {error&&<p role="alert" className={styles.error}>{error}</p>}
   <div className={styles.actions}>
    <button disabled={busy||!profile.enabled} onClick={()=>void testCatalog()}>모델 목록 확인</button>
    <button disabled={busy} onClick={()=>setEditing(true)}>연결 수정</button>
   </div>
   <details className={styles.disclosure}><summary>시험 요청 · 연결 삭제</summary>
    <label>시험할 모델<select value={model} disabled={busy} onChange={event=>setModel(event.target.value)}><option value="">모델 선택</option>{available.map(id=><option key={id} value={id}>{id}{profile.manualModelIds.includes(id)?' · 직접 입력':''}</option>)}</select></label>
    <p className={styles.hint}>회의 내용 대신 짧은 시험 문장을 전송합니다. 서비스에 따라 API 사용료가 발생할 수 있습니다.</p>
    <div className={styles.actions}><button disabled={busy||!model||!profile.enabled||(profile.kind==='openclaw'&&!profile.textOnlyConfirmed)} onClick={()=>void testInference()}>시험 응답 확인</button><button disabled={busy} onClick={()=>void run(()=>onRemove(profile.id))}>이 연결 삭제</button></div>
    {!profile.enabled&&<p className={styles.hint}>시험하려면 연결 수정에서 ‘이 연결의 모델 사용’을 켜세요.</p>}
   </details>
  </>}
 </article>;
}

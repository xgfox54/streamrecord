'use client';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {z} from 'zod';
import type {MeetingSession} from '../useMeetingSession';
import {errorMessage} from './contracts';
import styles from '../../meeting-ko/workspace.module.css';

const statusSchema=z.object({pending:z.boolean(),error:z.string().nullable(),activeAccountId:z.string().nullable(),accounts:z.array(z.object({id:z.string(),label:z.string(),connected:z.boolean(),planEnabled:z.boolean()}))});
type LoginStatus=z.infer<typeof statusSchema>;
const readStatus=async()=>statusSchema.parse(await invoke('ko_chatgpt_status'));

export function ChatGptConnection({session:s}:{readonly session:MeetingSession}){
 const refreshRef=useRef(s.refreshModels);refreshRef.current=s.refreshModels;
 const [status,setStatus]=useState<LoginStatus|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [account,setAccount]=useState('');
 const [message,setMessage]=useState('');
 const active=status?.accounts.find(item=>item.id===status.activeAccountId);
 const models=s.models.filter(item=>item.provider==='chatgpt');
 useEffect(()=>{let alive=true;void readStatus().then(value=>{if(alive){setStatus(value);setAccount(value.activeAccountId??'');}}).catch(reason=>{if(alive)setError(errorMessage(reason));});return()=>{alive=false;};},[]);
 useEffect(()=>{
  if(!status?.pending)return;
  let alive=true;let checking=false;
  const timer=window.setInterval(()=>{
   if(checking)return;checking=true;
   void readStatus().then(async value=>{if(!alive)return;setStatus(value);if(!value.pending){setAccount(value.activeAccountId??'');await refreshRef.current();}}).catch(reason=>{if(alive)setError(errorMessage(reason));}).finally(()=>{checking=false;});
  },1500);
  return()=>{alive=false;window.clearInterval(timer);};
 },[status?.pending]);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await action();}catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}};
 const login=(consent:boolean)=>run(async()=>{setStatus(statusSchema.parse(await invoke('ko_chatgpt_login',{accountId:account||null,requestConsent:consent})));});
 return <article className={styles.connectionCard} aria-label="ChatGPT 계정 연결">
  <span className={styles.badge}>공식 OAuth 로그인</span><h3>ChatGPT 계정</h3>
  <p>브라우저에서 ChatGPT 계정으로 로그인합니다. 로컬 요약 모델을 내려받지 않고 사용할 수 있습니다.</p><p role="note" className={styles.hint}>ChatGPT Plus 이상 유료 계정만 지원합니다. 무료 계정은 로그인은 되지만 요약·AI 보정에 사용할 수 없습니다. 무료 계정이면 이 PC의 모델이나 서버·API 연결을 사용하세요.</p>
  <dl className={styles.facts}>
   <div><dt>계정 연결</dt><dd>{status?.pending?'브라우저 로그인 대기 중':active?.connected?'로그인됨':status?'로그인 필요':'상태 확인 중'}</dd></div>
   <div><dt>요약 사용 동의</dt><dd>{active?.planEnabled?'허용됨':active?'동의 필요':'로그인 후 확인'}</dd></div>
   <div><dt>모델 목록</dt><dd>{models.length?`${models.length}개 응답 수신`:'아직 조회된 모델 없음'}</dd></div>
   <div><dt>실제 추론</dt><dd>로그인과 별도 · 요약 또는 시험 결과로 확인</dd></div>
  </dl>
  {status&&status.accounts.length>0&&<label>ChatGPT 계정<select value={account} disabled={busy||status.pending} onChange={event=>setAccount(event.target.value)}><option value="">다른 계정으로 로그인</option>{status.accounts.map(item=><option key={item.id} value={item.id}>{item.label}{item.id===status.activeAccountId?' · 사용 중':''}</option>)}</select></label>}
  {(error||status?.error)&&<p role="alert" className={styles.error}>{error||status?.error}</p>}
  {message&&<p role="status">{message}</p>}
  <div className={styles.actions}>
   <button className={styles.primary} disabled={busy||!status||status.pending} onClick={()=>void login(false)}>Continue with ChatGPT</button>
   {active?.connected&&!active.planEnabled&&<button disabled={busy||status?.pending} onClick={()=>void login(true)}>요약 사용 동의하기</button>}
   {status?.pending&&<button disabled={busy} onClick={()=>void run(async()=>{await invoke('ko_chatgpt_cancel');setStatus(await readStatus());setMessage('로그인을 취소했습니다.');})}>로그인 취소</button>}
   {account&&account!==status?.activeAccountId&&<button disabled={busy||status?.pending} onClick={()=>void run(async()=>{setStatus(statusSchema.parse(await invoke('ko_chatgpt_select',{accountId:account})));await s.refreshModels();})}>선택 계정 사용</button>}
   {account&&<button disabled={busy||status?.pending} onClick={()=>void run(async()=>{const result=z.object({remoteRevoked:z.boolean()}).parse(await invoke('ko_chatgpt_disconnect',{accountId:account}));const next=await readStatus();setStatus(next);setAccount(next.activeAccountId??'');setMessage(result.remoteRevoked?'계정 연결을 해제했습니다.':'이 PC의 연결을 해제했습니다. 원격 권한 해제 여부는 ChatGPT 설정에서 확인하세요.');await s.refreshModels();})}>계정 연결 해제</button>}
   <button disabled={busy||status?.pending} onClick={()=>void run(async()=>{setStatus(await readStatus());await s.refreshModels();})}>상태 다시 확인</button>
  </div>
  <p className={styles.hint}>회의 내용은 모델을 선택하고 요약·AI 보정을 실행할 때 OpenAI로 전송됩니다. 로그인만으로 녹음 내용이 전송되지는 않습니다.</p>
 </article>;
}

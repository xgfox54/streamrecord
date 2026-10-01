'use client';
import {useState} from 'react';
import type {ConnectionKind,ConnectionProfile,ProfileInput} from './contracts';
import {connectionTemplates,errorMessage} from './contracts';
import styles from '../../meeting-ko/workspace.module.css';

type Props={readonly kind:ConnectionKind;readonly profile?:ConnectionProfile;readonly onSave:(input:ProfileInput)=>Promise<void>;readonly onCancel:()=>void};
export function ProfileEditor({kind,profile,onSave,onCancel}:Props){
 const template=connectionTemplates.find(item=>item.kind===kind);
 const [label,setLabel]=useState(profile?.label??template?.title??'');
 const [base,setBase]=useState(profile?.base??template?.base??'');
 const [enabled,setEnabled]=useState(profile?.enabled??false);
 const [apiKey,setApiKey]=useState('');
 const [clearKey,setClearKey]=useState(false);
 const [username,setUsername]=useState(profile?.username??(kind==='opencode'?'opencode':''));
 const [manual,setManual]=useState(profile?.manualModelIds.join('\n')??'');
 const [confirmed,setConfirmed]=useState(profile?.textOnlyConfirmed??false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const save=async()=>{
  setBusy(true);setError('');
  try{
   await onSave({id:profile?.id,label:label.trim(),kind,base:base.trim(),enabled,username,
    manualModelIds:manual.split(/[\n,]/).map(value=>value.trim()).filter(Boolean),textOnlyConfirmed:confirmed,
    apiKey:clearKey?'':apiKey||null});
   setApiKey('');
  }catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
 };
 return <form onSubmit={event=>{event.preventDefault();void save();}} aria-label={`${template?.title} 설정`}>
  <div className={styles.formGrid}>
   <label>연결 이름<input required value={label} disabled={busy} onChange={event=>setLabel(event.target.value)} autoComplete="off"/></label>
   <label>서버 주소<input required type="url" value={base} disabled={busy} onChange={event=>setBase(event.target.value)} placeholder={template?.base||'https://서버주소/v1'} spellCheck={false}/></label>
   {kind==='opencode'&&<label>서버 사용자 이름<input value={username} disabled={busy} onChange={event=>setUsername(event.target.value)} autoComplete="off"/></label>}
   <label>{kind==='opencode'?'서버 비밀번호':'API 키 또는 서버 토큰'}<input type="password" value={apiKey} disabled={busy||clearKey} onChange={event=>setApiKey(event.target.value)} autoComplete="new-password" placeholder={profile?.hasApiKey?'저장됨 · 변경할 때만 입력':'인증이 필요한 서버만 입력'} spellCheck={false}/></label>
  </div>
  {profile?.hasApiKey&&<label className={styles.check}><input type="checkbox" checked={clearKey} disabled={busy} onChange={event=>setClearKey(event.target.checked)}/>저장된 인증 정보 지우기</label>}
  <p className={styles.hint}>서버 주소를 바꿀 때는 인증 정보를 다시 입력하거나 지우세요. 다른 서버로 기존 인증 정보를 보내지 않습니다.</p>
  <label className={styles.check}><input type="checkbox" checked={enabled} disabled={busy} onChange={event=>setEnabled(event.target.checked)}/>이 연결의 모델 사용</label>
  {kind==='openclaw'&&<label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>OpenClaw에서 이 전용 에이전트의 도구 실행을 차단했습니다</label>}
  {kind==='openclaw'&&<p className={styles.hint}>모델 목록은 실제 기반 모델이 아니라 OpenClaw 에이전트를 가리킵니다. 요약 전용 에이전트를 만들고 파일·명령·메시지 등 모든 도구 실행을 서버에서 차단해야 합니다. 이 확인만으로 서버 설정이 변경되지는 않습니다.</p>}
  <details className={styles.disclosure} open={kind==='openclaw'}><summary>모델 ID 직접 지정</summary><label>모델 ID (한 줄에 하나)<textarea value={manual} disabled={busy} onChange={event=>setManual(event.target.value)} rows={3} spellCheck={false}/></label><p className={styles.hint}>목록 API를 제공하지 않는 서버에서 사용하세요. 직접 입력한 모델은 실제 응답 확인 전까지 검증되지 않습니다.</p></details>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  <div className={styles.actions}><button className={styles.primary} disabled={busy} type="submit">{busy?'저장 중':'연결 저장'}</button><button type="button" disabled={busy} onClick={onCancel}>취소</button></div>
 </form>;
}

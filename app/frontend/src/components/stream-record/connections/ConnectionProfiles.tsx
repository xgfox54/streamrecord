'use client';
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {MeetingSession} from '../useMeetingSession';
import {connectionTemplates,errorMessage,profileSchema,type ConnectionKind,type ConnectionProfile,type ProfileInput} from './contracts';
import {ProfileEditor} from './ProfileEditor';
import {ProfileCard} from './ProfileCard';
import styles from '../../meeting-ko/workspace.module.css';

export function ConnectionProfiles({session:s}:{readonly session:MeetingSession}){
 const [profiles,setProfiles]=useState<ConnectionProfile[]>([]);
 const [adding,setAdding]=useState<ConnectionKind|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const reload=async()=>{const result=profileSchema.array().parse(await invoke('ko_list_connections'));setProfiles(result);};
 useEffect(()=>{let alive=true;void invoke('ko_list_connections').then(value=>{const result=profileSchema.array().parse(value);if(alive)setProfiles(result);}).catch(reason=>{if(alive)setError(errorMessage(reason));}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[]);
 const save=async(profile:ProfileInput)=>{await invoke('ko_save_connection',{profile});await reload();setAdding(null);await s.refreshModels();};
 const remove=async(id:string)=>{await invoke('ko_remove_connection',{id});await reload();await s.refreshModels();};
 return <section className={styles.panel} aria-label="서버 및 API 연결 관리">
  <h2>서버 및 API 연결</h2><p>사용 중인 서비스를 골라 연결하세요. 연결마다 이름과 주소·인증 정보·모델을 따로 관리합니다.</p>
  {loading&&<p role="status">저장된 연결을 불러오는 중입니다.</p>}
  {error&&<div role="alert" className={styles.error}><p>연결 설정을 불러오지 못했습니다. {error}</p><button onClick={()=>{setError('');setLoading(true);void reload().catch(reason=>setError(errorMessage(reason))).finally(()=>setLoading(false));}}>다시 불러오기</button></div>}
  {profiles.length>0&&<div className={styles.connectionGrid}>{profiles.map(profile=><ProfileCard key={profile.id+profile.revision} profile={profile} session={s} onSave={save} onRemove={remove}/>)}</div>}
  <details className={styles.disclosure} open={profiles.length===0}><summary>새 연결 추가</summary><div className={styles.connectionGrid}>
   {connectionTemplates.map(template=><article key={template.kind} className={styles.connectionCard}><h3>{template.title}</h3><p>{template.description}</p>{adding===template.kind?<ProfileEditor kind={template.kind} onSave={save} onCancel={()=>setAdding(null)}/>:<div className={styles.actions}><button disabled={loading||Boolean(error)} onClick={()=>setAdding(template.kind)}>{template.title} 추가</button></div>}</article>)}
  </div></details>
  <p className={styles.hint}>로컬 중계 서버도 외부 서비스로 내용을 전달할 수 있습니다. 연결한 서버의 목적지와 계정 권한을 확인하세요. 서버 연결 없이도 녹음과 한국어 전사는 사용할 수 있습니다.</p>
 </section>;
}

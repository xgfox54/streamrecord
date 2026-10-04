'use client';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {MeetingSession} from './useMeetingSession';

export type AvailableUpdate={readonly currentVersion:string;readonly version:string;readonly notes:string;readonly releaseUrl:string};
type Phase='idle'|'checking'|'current'|'available'|'installing'|'failed';
const FIRST_CHECK_MS=15_000;
const RECHECK_MS=6*60*60*1000;

/** Signed GitLab update channel. Automatic mode checks shortly after launch and every six hours; failures stay quiet. */
export function useAppUpdate(s:MeetingSession,automatic:boolean){
 const [update,setUpdate]=useState<AvailableUpdate|null>(null);const [phase,setPhase]=useState<Phase>('idle');const [message,setMessage]=useState('');
 const alive=useRef(true);
 const check=async(quiet:boolean)=>{
  if(!quiet){setPhase('checking');setMessage('');}
  try{const found=await invoke<AvailableUpdate|null>('ko_update_check');if(!alive.current)return;setUpdate(found);setPhase(found?'available':'current');if(!quiet)setMessage(found?`새 버전 v${found.version}을 설치할 수 있습니다.`:'최신 버전을 사용하고 있습니다.');}
  catch(error){if(!alive.current)return;if(!quiet){setPhase('failed');setMessage(`업데이트 확인 실패: ${s.messageOf(error)}`);}}
 };
 useEffect(()=>{alive.current=true;if(!automatic)return()=>{alive.current=false;};const first=setTimeout(()=>void check(true),FIRST_CHECK_MS);const timer=window.setInterval(()=>void check(true),RECHECK_MS);return()=>{alive.current=false;clearTimeout(first);window.clearInterval(timer);};
  // One schedule per mount; check reads the latest session through its closure arguments only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[automatic]);
 const ready=s.mode==='idle';
 const install=async()=>{
  if(!update||!ready)return;
  if(!window.confirm(`Stream-Record v${update.version}로 업데이트합니다.\n현재 기록을 저장하고 앱을 닫은 뒤, 새 버전을 내려받아 설치하고 다시 실행합니다. 원음과 받아쓰기 기록은 그대로 유지됩니다.\n계속할까요?`))return;
  setPhase('installing');setMessage('업데이트를 내려받아 서명과 해시를 확인하고 있습니다.');
  try{await s.persist();await invoke('ko_update_install',{version:update.version});s.setNotice('업데이트 설치를 시작합니다. 앱을 닫고 새 버전을 설치한 뒤 다시 실행합니다.');await invoke('ko_exit_app');}
  catch(error){if(!alive.current)return;setPhase('available');const text=`업데이트를 설치하지 못했습니다. 지금 버전은 그대로 사용할 수 있습니다. ${s.messageOf(error)}`;setMessage(text);s.setError(text);}
 };
 return {update,phase,message,ready,check:()=>check(false),install};
}

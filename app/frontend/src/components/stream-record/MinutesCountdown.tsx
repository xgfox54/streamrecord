'use client';
import {useEffect,useState} from 'react';
import {importDuration} from './import-progress';
import {remainingMinutesSeconds,type MinutesTiming} from './minutes-timing';
import styles from '../meeting-ko/workspace.module.css';

export function MinutesCountdown({timing}:{readonly timing:MinutesTiming}) {
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  setNow(Date.now());
  const timer=window.setInterval(()=>setNow(Date.now()),1000);
  return ()=>window.clearInterval(timer);
 },[]);
 const remaining=remainingMinutesSeconds(timing,Math.max(now,timing.updatedAt));
 return <div data-testid="minutes-countdown" aria-live="off">
  <p><strong>예상 남은 시간: </strong><span role="timer">{remaining===null?timing.phase==='preparing'?'계산 중':timing.phase==='saving'?'결과 저장 중 · 예상 시간을 다시 계산하고 있습니다.':'처리 중 · 예상 시간을 다시 계산하고 있습니다.':`약 ${importDuration(remaining)}`}</span></p>
  {timing.total>0&&<p>완료 {timing.completed}/{timing.total}구간{timing.reused>0?` · 저장된 ${timing.reused}구간 재사용`:''}{timing.phase==='saving'?' · 회의록 저장 중':''}</p>}
  <p className={styles.hint}>{timing.phase==='waiting'?'앞선 AI 처리 대기 중입니다. 대기 시간은 예상 시간에서 제외하며 카운트다운을 잠시 멈춥니다.':timing.sampledUnits>0?'실제 처리 속도로 예상 시간을 갱신합니다. AI 응답과 저장 속도에 따라 달라질 수 있습니다.':'남은 분량으로 계산한 초기 예상 시간입니다. 구간이 완료되면 실제 처리 속도로 갱신합니다.'}</p>
 </div>;
}

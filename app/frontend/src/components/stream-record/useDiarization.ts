'use client';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {assignSpeakers,diarizationSchema} from '../meeting-ko/speakers';
import type {TranscriptRow} from '../meeting-ko/core';
import type {ReviewAudio} from '../meeting-ko/review-core';
import {applyLiveSpeakerState,mergeFullSpeakers,mergeLiveSpeakers,type LiveSpeakerState,type LiveWindow} from '../meeting-ko/live-speakers';
import {useStoredFlag} from './useStoredFlag';
type Input={audio:ReviewAudio|null;rows:TranscriptRow[];rowsRef:{current:TranscriptRow[]};mode:string;epoch:number;busy:boolean;setBusy:(value:boolean)=>void;setRows:(value:TranscriptRow[])=>void;persist:()=>Promise<unknown>;report:(message:string)=>void};
export function useDiarization(input:Input){
 const latest=useRef(input);latest.current=input;
 const live=useRef<{cursor:number;state:LiveSpeakerState|null}>({cursor:-1,state:null});
 const liveEpoch=useRef(input.epoch);
 if(liveEpoch.current!==input.epoch){liveEpoch.current=input.epoch;live.current={cursor:-1,state:null};}
 // Live speaker separation shares the CPU with Whisper; users can turn it off when transcription lags.
 const [enabled,setEnabled]=useStoredFlag('live-diarization',true);
 useEffect(()=>{
  if(input.mode!=='recording'||!enabled)return;
  live.current={cursor:-1,state:null};
  let active=true;let inFlight=false;let retryAfter=0;let fullAt=Date.now()+300000;
  setStatus('실시간 참여자 구분: 자동 저장된 30초 음성 구간을 기다리는 중입니다. 번호는 임시입니다.');
  const poll=async()=>{
   if(!active||inFlight||Date.now()<retryAfter)return;
   inFlight=true;
   try{
    // Every few minutes, re-analyse the whole recording so far so people keep one number all meeting.
    // Longer meetings take longer to analyse, so the next run waits at least four times as long as the last one.
    if(live.current.cursor>=3&&Date.now()>=fullAt){
     const began=Date.now();
     try{
      const anchored=await invoke<LiveWindow|null>('ko_poll_live_diarization',{afterCheckpoint:live.current.cursor,full:true});
      if(!active)return;
      if(!anchored){fullAt=Date.now()+30000;return;}
      fullAt=Date.now()+Math.max(300000,(Date.now()-began)*4);
      const merged=mergeFullSpeakers(latest.current.rowsRef.current,anchored,live.current.state);
      live.current.cursor=merged.state.checkpointIndex;live.current.state=merged.state;
      if(merged.rows.some((row,index)=>row!==latest.current.rowsRef.current[index])){latest.current.setRows(merged.rows);await latest.current.persist();}
      setStatus(`실시간 참여자 구분: 처음부터 ${Math.round(anchored.windowEndSeconds/60)}분까지 다시 분석해 참여자 번호를 정리했습니다. 번호는 임시이며 원음과 대조해 확인하세요.`);
     }catch(reason){if(active){fullAt=Date.now()+300000;setStatus(`실시간 참여자 구분: 전체 다시 분석 실패, 5분 뒤 재시도 (${reason instanceof Error?reason.message:String(reason)})`);}}
     return;
    }
    const result=await invoke<LiveWindow|null>('ko_poll_live_diarization',{afterCheckpoint:live.current.cursor});
    if(!active||!result)return;
    retryAfter=0;
    const merged=mergeLiveSpeakers(latest.current.rowsRef.current,result,live.current.state);
    live.current.cursor=result.checkpointIndex;live.current.state=merged.state;
    if(merged.rows.some((row,index)=>row!==latest.current.rowsRef.current[index])){
     latest.current.setRows(merged.rows);await latest.current.persist();
    }
    setStatus(`실시간 참여자 구분: ${Math.round(result.windowEndSeconds)}초까지 분석했습니다. 번호는 녹음 종료 후 전체 분석으로 확인하세요.`);
   }catch(reason){if(active){retryAfter=Date.now()+30000;setStatus(`실시간 참여자 구분 대기: ${reason instanceof Error?reason.message:String(reason)} (30초 후 재시도)`);}}
   finally{inFlight=false;}
  };
  void poll();const timer=window.setInterval(()=>void poll(),3000);
  return()=>{active=false;window.clearInterval(timer);if(inFlight)void invoke('ko_cancel_diarization').catch(()=>{});};
  // One polling session per recording epoch and toggle. Other input fields use `latest`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[input.mode,input.epoch,enabled]);
 const [running,setRunning]=useState(false);const [status,setStatus]=useState('저장된 원음을 연결한 뒤 참여자를 구분할 수 있습니다.');
 const run=async()=>{if(input.busy||running||!input.audio||!input.rows.length)return;input.setBusy(true);setRunning(true);setStatus('Nemotron으로 저장 음성 전체의 참여자를 분석 중입니다.');
  try{const result=diarizationSchema.parse(await invoke('ko_run_diarization',{path:input.audio.path,expectedSha256:input.audio.sha256}));if(result.audioSha256!==input.audio.sha256)throw new Error('분석한 음성이 현재 원음과 다릅니다.');const next=assignSpeakers(input.rows,result,input.audio.duration_seconds);input.setRows(next);await input.persist();setStatus(`참여자 ${new Set(result.segments.map(item=>item.speaker)).size}명 추정 · 전체 ${result.segments.length}개 음성 구간. 이름은 원음과 대조해 확인하세요.`);}
  catch(reason){const message=reason instanceof Error?reason.message:String(reason);setStatus(`참여자 구분 완료 안 됨: ${message}`);input.report(message);}finally{setRunning(false);input.setBusy(false);}
 };
 const cancel=()=>void invoke('ko_cancel_diarization').catch(reason=>input.report(String(reason)));
 const applyLive=(rows:TranscriptRow[])=>['recording','stopping'].includes(latest.current.mode)&&live.current.state?applyLiveSpeakerState(rows,live.current.state):rows;
 const resetStatus=()=>setStatus('저장된 원음을 연결한 뒤 참여자를 구분할 수 있습니다.');
 return {run,cancel,applyLive,running,status,resetStatus,enabled,setEnabled};
}

'use client';
import {useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {assignSpeakers,diarizationSchema} from '../meeting-ko/speakers';
import type {TranscriptRow} from '../meeting-ko/core';
import type {ReviewAudio} from '../meeting-ko/review-core';
type Input={audio:ReviewAudio|null;rows:TranscriptRow[];busy:boolean;setBusy:(value:boolean)=>void;setRows:(value:TranscriptRow[])=>void;persist:()=>Promise<unknown>;report:(message:string)=>void};
export function useDiarization(input:Input){
 const [running,setRunning]=useState(false);const [status,setStatus]=useState('저장된 원음을 연결한 뒤 화자를 구분할 수 있습니다.');
 const run=async()=>{if(input.busy||running||!input.audio||!input.rows.length)return;input.setBusy(true);setRunning(true);setStatus('Nemotron으로 저장 음성 전체의 화자를 분석 중입니다.');
  try{const result=diarizationSchema.parse(await invoke('ko_run_diarization',{path:input.audio.path,expectedSha256:input.audio.sha256}));if(result.audioSha256!==input.audio.sha256)throw new Error('분석한 음성이 현재 원음과 다릅니다.');const next=assignSpeakers(input.rows,result,input.audio.duration_seconds);input.setRows(next);await input.persist();setStatus(`${new Set(result.segments.map(item=>item.speaker)).size}명 화자 추정 · 전체 ${result.segments.length}개 음성 구간. 이름은 원음과 대조해 확인하세요.`);}
  catch(reason){const message=reason instanceof Error?reason.message:String(reason);setStatus(`화자분리 완료 안 됨: ${message}`);input.report(message);}finally{setRunning(false);input.setBusy(false);}
 };
 const cancel=()=>void invoke('ko_cancel_diarization').catch(reason=>input.report(String(reason)));
 return {run,cancel,running,status};
}

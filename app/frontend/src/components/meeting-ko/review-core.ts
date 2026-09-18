/** Stream-Record local audio review/recovery. MIT. Pure orchestration; no I/O here. */
import type {TranscriptRow} from './core';
export type ReviewAudio = {path:string; filename:string; duration_seconds:number; sha256:string};
export type RecoveredWindow = {text:string; audio_start_time:number; audio_end_time:number; is_partial:boolean};
export type RecoveryCheckpoint = {version:1; key:string; windows:Record<string,RecoveredWindow>};
export const RECOVERY_WINDOW_SECONDS=24;
const RECOVERY_VERSION='stream-record-recovery-v1-prompt1';

export function playbackRange(row:TranscriptRow,duration:number):{start:number;end:number}|null {
 const start=row.audio_start_time??row.chunk_start_time;
 if(typeof start!=='number'||!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=start)return null;
 const supplied=row.audio_end_time;
 const end=typeof supplied==='number'&&Number.isFinite(supplied)&&supplied>start?supplied:start+12;
 return {start,end:Math.min(end,duration)};
}
export function recoveryWindows(duration:number):{start:number;duration:number}[] {
 if(!Number.isFinite(duration)||duration<=0||duration>86400)throw new Error('복구할 음성 길이가 올바르지 않습니다.');
 return Array.from({length:Math.ceil(duration/RECOVERY_WINDOW_SECONDS)},(_,i)=>({start:i*RECOVERY_WINDOW_SECONDS,duration:Math.min(RECOVERY_WINDOW_SECONDS,duration-i*RECOVERY_WINDOW_SECONDS)}));
}
export function validateRecovered(value:unknown,start:number,duration:number):RecoveredWindow {
 if(!value||typeof value!=='object')throw new Error('음성 복구 응답이 비어 있습니다.');
 const v=value as Partial<RecoveredWindow>;
 if(typeof v.text!=='string'||v.text.length>100000||v.is_partial!==false
  ||typeof v.audio_start_time!=='number'||!Number.isFinite(v.audio_start_time)||Math.abs(v.audio_start_time-start)>0.001
  ||typeof v.audio_end_time!=='number'||!Number.isFinite(v.audio_end_time)||v.audio_end_time<=start
  ||v.audio_end_time>start+duration+0.001||v.audio_end_time<start+duration-0.1)
  throw new Error('음성 복구 구간이 잘렸거나 시간정보가 다릅니다. 완료 구간으로 저장하지 않았습니다.');
 return v as RecoveredWindow;
}
export async function recoveryKey(sha256:string,model:string,glossary:string,duration:number):Promise<string> {
 if(!/^[a-f0-9]{64}$/.test(sha256)||!model.trim())throw new Error('원음 식별값 또는 모델 정보가 없습니다.');
 const bytes=new TextEncoder().encode(JSON.stringify([RECOVERY_VERSION,sha256,model,glossary,duration]));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function recoverAudio(options:{
 audio:ReviewAudio; model:string; glossary:string; checkpoint:RecoveryCheckpoint|null;
 decode:(start:number,duration:number)=>Promise<unknown>;
 save:(checkpoint:RecoveryCheckpoint)=>Promise<void>;
 progress:(text:string)=>void; cancelled:()=>boolean;
}):Promise<TranscriptRow[]> {
 const plan=recoveryWindows(options.audio.duration_seconds);
 const key=await recoveryKey(options.audio.sha256,options.model,options.glossary,options.audio.duration_seconds);
 const previous=options.checkpoint?.version===1&&options.checkpoint.key===key?options.checkpoint.windows:{};
 let windows:Record<string,RecoveredWindow>={};
 for(let i=0;i<plan.length;i++){
  if(options.cancelled())throw new Error('전사 복구를 취소했습니다. 저장된 완료 구간부터 다시 시작할 수 있습니다.');
  const {start,duration}=plan[i];const saved=previous?.[String(i)];let current:RecoveredWindow|undefined;
  if(saved){try{current=validateRecovered(saved,start,duration);}catch{/* Reprocess invalid checkpoint rows; never silently skip audio. */}}
  options.progress(`저장 음성 전사 ${i+1}/${plan.length}구간${current?' · 완료 구간 재사용':''}`);
  if(!current)current=validateRecovered(await options.decode(start,duration),start,duration);
  const candidate={...windows,[String(i)]:current};
  await options.save({version:1,key,windows:candidate});
  windows=candidate;
 }
 return plan.flatMap((_,i)=>{
  const item=windows[String(i)];
  return item.text.trim()?[{...item,id:`recovery-${i}`,sequence_id:i,recovery_audio_sha256:options.audio.sha256}]:[];
 });
}

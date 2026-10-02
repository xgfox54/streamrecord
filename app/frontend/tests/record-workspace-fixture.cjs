'use strict';
module.exports=function finalFixture(){
 const old=window.__TAURI_INTERNALS__.invoke;const hash='a'.repeat(64);
 const base={sessionId:'fixture',pending:0,failed:0,deferred:0,cancelled:0,resultCount:0,partialWrites:0,active:false,legacy:false};
 const candidates=[{...base,directory:'QA/pending',pending:2},{...base,directory:'QA/failed',failed:1},{...base,directory:'QA/partial',partialWrites:1,resultCount:1},{...base,directory:'QA/active',active:true,pending:1},{...base,directory:'QA/legacy',legacy:true,pending:1},{...base,directory:'QA/unreadable',inspectionError:'검증용 읽기 실패'}];
 const result={modelId:'nvidia/Nemotron-3-Diarization',modelRevision:'fixture',engineRevision:'fixture',audioSha256:hash,segments:[{start:0,end:2.7,speaker:1},{start:2.5,end:4,speaker:2},{start:4,end:6,speaker:2}]};
 let rejectPending=null;
 window.__qa.diarMode='success';window.__qa.recoveryMode='success';window.__qa.currentSnapshot=null;
 window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
  const log=()=>window.__qa.calls.push({command,args});
  if(command==='ko_save_snapshot')window.__qa.currentSnapshot=JSON.parse(args.content);
  if(command==='ko_open_review_audio'){log();return {path:'/qa-audio.wav',filename:'검증용 음성.wav',duration_seconds:10,sha256:hash};}
  if(command==='ko_run_diarization'){log();if(window.__qa.diarMode==='failure')throw new Error('검증용 화자분리 엔진 오류');if(window.__qa.diarMode==='pending')return new Promise((resolve,reject)=>{rejectPending=reject;});return result;}
  if(command==='ko_cancel_diarization'){log();rejectPending?.(new Error('사용자가 화자분리를 취소했습니다.'));rejectPending=null;return;}
  if(command==='ko_list_transcription_recovery'){log();return candidates;}
  if(command==='ko_resume_transcription_recovery'){log();if(window.__qa.recoveryMode==='failure')throw new Error('검증용 대기열 오류');return {rows:[{sourceId:'queue-source-1',update:{sequence_id:1,text:'복구된 첫 번째 발언입니다.',audio_start_time:0,audio_end_time:2,is_partial:false}},{sourceId:'queue-source-2',update:{sequence_id:2,text:'복구된 두 번째 발언입니다.',audio_start_time:2,audio_end_time:4,is_partial:false}}],complete:false,pending:1,failed:1,deferred:1,cancelled:1,partialWrites:1};}
  if(command==='ko_list_connections')return [];
  if(command==='ko_chatgpt_status')return {pending:false,error:null,activeAccountId:null,accounts:[]};
  return old(command,args);
 };
};

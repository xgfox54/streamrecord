'use client';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {generateText} from '../meeting-ko/generate-text';
import {correctedTranscriptText} from '../meeting-ko/transcript-correction';
import {useTranscriptCorrection} from './useTranscriptCorrection';
import {useLiveSummary} from './useLiveSummary';
import {useDiarization} from './useDiarization';
import {useRecordHistory} from './useRecordHistory';
import {readLiveSummaryCheckpoint,type LiveSummaryCheckpoint} from '../meeting-ko/live-summary';
import {listen,type UnlistenFn} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {ensureKoreanWhisper} from '../meeting-ko/korean-model';
import {isStereoMix,loadAllTranscriptRows,microphoneInputs,readRows,rowTime,transcriptText,upsertRow,type AudioInput,type TranscriptRow} from '../meeting-ko/core';
import {deviceKey,systemAudioDevices,selectedSystemDevice,type StereoMixStatus} from './recording-source';
import {createStructuredMinutes,reviewText,type SummaryCheckpoint} from '../meeting-ko/structured-minutes';
import {playbackRange,recoverAudio,type ReviewAudio,type RecoveryCheckpoint} from '../meeting-ko/review-core';
import {type WorkspaceView} from '../stream-record/AppShell';
import {useStoredFlag} from './useStoredFlag';
type Mode='loading'|'idle'|'starting'|'recording'|'stopping'|'importing'|'summarizing'|'reviewing'|'recovering'|'diarizing';
type Config={provider:string;model:string};
export type ModelOption={id:string;provider:string;connectionId?:string;connectionLabel?:string;destination?:string;revision?:string};
const modelKey=(m:ModelOption)=>`${m.provider}:${m.id}`;
const modelKeyOrEmpty=(model:ModelOption|undefined)=>model?modelKey(model):'';
type AudioFile={path:string;filename:string};
type ImportProgress={progress_percentage:number;message:string};
type ImportResult={meeting_id:string;title:string};
export type Snapshot={version:number;recordId?:string;title:string;rows:TranscriptRow[];minutes:string;startedAt:string|null;videoUrl?:string;glossary?:string;liveSummary?:string;liveSummaryDraft?:LiveSummaryCheckpoint|null;summaryDraft?:SummaryCheckpoint|null;audioPath?:string;audioSha256?:string;recoveryDraft?:RecoveryCheckpoint|null};
const labels:Record<Mode,string>={loading:'초기화 중',idle:'준비',starting:'녹음 시작 중',recording:'녹음 · 실시간 전사 중',stopping:'마지막 음성 처리 중',importing:'녹음파일 전사 중',summarizing:'회의록 작성 중',reviewing:'원음 확인 중',recovering:'저장 음성 전사 복구 중',diarizing:'저장 음성 화자분리 중'};
const messageOf=(e:unknown)=>e instanceof Error?e.message:String(e);
export function youtubeEmbedUrl(watchUrl:string){const id=watchUrl.match(/[?&]v=([A-Za-z0-9_-]{6,32})(?:[&#]|$)/)?.[1];if(!id)throw new Error('검증된 YouTube 영상 ID를 읽지 못했습니다.');return `https://www.youtube-nocookie.com/embed/${id}`;}
export function useMeetingSession(){
 const [epoch,setEpoch]=useState(0);
 const [view,setView]=useState<WorkspaceView>('recording');
 const [recordingKind,setRecordingKind]=useState<'microphone'|'pc'>('microphone');
 const [stopFailure,setStopFailure]=useState('');const [acknowledgeStopFailure,setAcknowledgeStopFailure]=useState(false);
 const [exitOpen,setExitOpen]=useState(false);const [exiting,setExiting]=useState(false);
 const [elapsed,setElapsed]=useState(0);const [modelStatus,setModelStatus]=useState('녹음 시작 시 동봉 모델의 무결성과 적재 상태를 확인합니다.');
 const trayStop=useRef<()=>void>(()=>{});
 const navigate=(next:WorkspaceView)=>{window.location.hash=next;setView(next);};
 useEffect(()=>{const sync=()=>{const hash=window.location.hash.slice(1);if(hash==='recording'||hash==='dictation'||hash==='youtube'||hash==='transcript'||hash==='minutes'||hash==='ai'||hash==='settings')setView(hash);};sync();window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
 const [mode,setModeState]=useState<Mode>('loading');const modeRef=useRef<Mode>('loading');
 const setMode=(v:Mode)=>{modeRef.current=v;setModeState(v);};
 const [ready,setReady]=useState(false);const [title,setTitleState]=useState('새 회의');const titleRef=useRef('새 회의');
 const [videoUrl,setVideoUrlState]=useState('');const videoUrlRef=useRef('');const [videoEmbedUrl,setVideoEmbedUrl]=useState('');
 const [glossary,setGlossaryState]=useState('');const glossaryRef=useRef('');const summaryDraft=useRef<SummaryCheckpoint|null>(null);
 const [query,setQuery]=useState('');const [page,setPage]=useState(0);const [editing,setEditing]=useState<number|null>(null);
 const [devices,setDevices]=useState<AudioInput[]>([]);const [microphone,setMicrophone]=useState('');const [systemDevice,setSystemDevice]=useState('');
  const [stereoMix,setStereoMix]=useState<StereoMixStatus|null>(null);const [stereoMixBusy,setStereoMixBusy]=useState(false);
 const [rows,setRowsState]=useState<TranscriptRow[]>([]);const rowsRef=useRef<TranscriptRow[]>([]);
 const [minutes,setMinutesState]=useState('');const minutesRef=useRef('');const startedAt=useRef<string|null>(null);
 const [models,setModels]=useState<ModelOption[]>([]);const [model,setModel]=useState('');
 const [liveSummaryEnabled,setLiveSummaryEnabled]=useStoredFlag('live-summary',false);const [liveSummary,setLiveSummaryState]=useState('');const liveSummaryRef=useRef('');
 const liveSummaryDraft=useRef<LiveSummaryCheckpoint|null>(null);
 const [saving,setSaving]=useState(false);const saveInFlight=useRef(false);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const [savedPath,setSavedPath]=useState('');
 const [progress,setProgress]=useState(0);const [consent,setConsent]=useState(false);const [follow,setFollow]=useState(true);
 const cancelSummary=useRef(false);const dirty=useRef(0);
 const snapshotQueue=useRef<Promise<unknown>|null>(null);
 const audioPath=useRef('');const audioSha256=useRef('');const recoveryDraft=useRef<RecoveryCheckpoint|null>(null);
 const [audioSource,setAudioSource]=useState<ReviewAudio|null>(null);const audioElement=useRef<HTMLAudioElement>(null);
 const playbackEnd=useRef<number|null>(null);const cancelRecovery=useRef(false);
 const setRows=(v:TranscriptRow[])=>{rowsRef.current=v;setRowsState(v);dirty.current++;};
 const setMinutes=(v:string)=>{minutesRef.current=v;setMinutesState(v);dirty.current++;};
 const setTitle=(v:string)=>{titleRef.current=v;setTitleState(v);dirty.current++;};
 const setVideoUrl=(v:string)=>{videoUrlRef.current=v;setVideoUrlState(v);setVideoEmbedUrl('');dirty.current++;};
 const setLiveSummary=(v:string)=>{liveSummaryRef.current=v;setLiveSummaryState(v);dirty.current++;};
 const snapshot=():Snapshot=>({version:1,title:titleRef.current,rows:rowsRef.current,minutes:minutesRef.current,startedAt:startedAt.current,videoUrl:videoUrlRef.current,glossary:glossaryRef.current,liveSummary:liveSummaryRef.current,liveSummaryDraft:liveSummaryDraft.current,summaryDraft:summaryDraft.current,audioPath:audioPath.current,audioSha256:audioSha256.current,recoveryDraft:recoveryDraft.current});
 const persist=():Promise<unknown>=>{const next=recordHistory.persist();snapshotQueue.current=next;return next;};
 const cumulative=useLiveSummary({rows,model:models.find(item=>modelKey(item)===model),glossary,epoch,mode,enabled:liveSummaryEnabled,checkpoint:liveSummaryDraft,onSummary:setLiveSummary,persist,notice:setNotice});
 const diarization=useDiarization({audio:audioSource,rows,rowsRef,mode,epoch,busy:mode!=='idle',setBusy:value=>setMode(value?'diarizing':'idle'),setRows,persist,report:setError});
 const correction=useTranscriptCorrection({rows,rowsRef,setRows,model:models.find(item=>modelKey(item)===model),glossary,epoch,mode,persist});
 const applySnapshot=(old:Snapshot)=>{audioElement.current?.pause();diarization.resetStatus();setError('');setEpoch(value=>value+1);setRows(readRows(old.rows));setTitle(old.title||'새 기록');setMinutes(old.minutes||'');setVideoUrl(typeof old.videoUrl==='string'?old.videoUrl:'');setLiveSummary(typeof old.liveSummary==='string'?old.liveSummary:'');liveSummaryDraft.current=readLiveSummaryCheckpoint(old.liveSummaryDraft);glossaryRef.current=typeof old.glossary==='string'?old.glossary:'';setGlossaryState(glossaryRef.current);summaryDraft.current=old.summaryDraft??null;audioPath.current=old.audioPath??'';audioSha256.current=old.audioSha256??'';recoveryDraft.current=old.recoveryDraft?.version===1?old.recoveryDraft:null;startedAt.current=old.startedAt;setAudioSource(null);setElapsed(0);setQuery('');setPage(0);setEditing(null);setFollow(true);setConsent(false);setSavedPath('');};
 const recordHistory=useRecordHistory({capture:snapshot,apply:applySnapshot,onTransition:active=>{setMode(active?'reviewing':'idle');if(active)setEpoch(value=>value+1);},blockedReason:()=>modeRef.current!=='idle'?'진행 중인 작업을 마친 뒤 기록을 바꿀 수 있습니다.':saveInFlight.current?'내보내기가 끝난 뒤 다시 시도하세요.':correction.running||cumulative.running?'AI 처리가 끝난 뒤 기록을 바꿀 수 있습니다.':''});
 const exportFile=async(kind:'transcript'|'corrected'|'minutes'|'bundle')=>{
  const content=kind==='transcript'?transcriptText(rowsRef.current):kind==='corrected'?correctedTranscriptText(rowsRef.current):kind==='minutes'?minutesRef.current:JSON.stringify(snapshot(),null,2);
  if(!content.trim())throw new Error('저장할 내용이 없습니다.');
  const path=await invoke<string>('ko_export',{title:kind==='corrected'?`${titleRef.current}-AI보정본`:titleRef.current,kind:kind==='corrected'?'transcript':kind,content});setSavedPath(path);return path;
 };
 const archive=async()=>{if(rowsRef.current.length||minutesRef.current||recoveryDraft.current)await exportFile('bundle');await recordHistory.rotate();liveSummaryDraft.current=null;audioElement.current?.pause();diarization.resetStatus();setError('');audioPath.current='';audioSha256.current='';recoveryDraft.current=null;setAudioSource(null);setEpoch(value=>value+1);setRows([]);setMinutes('');setLiveSummary('');startedAt.current=null;setElapsed(0);summaryDraft.current=null;setPage(0);setQuery('');setEditing(null);};
  const refreshStereoMix=async()=>{try{const status=await invoke<StereoMixStatus>('ko_stereo_mix_status');setStereoMix(status&&typeof status.state==='string'?status:null);}catch{setStereoMix(null);}};
 const refreshDevices=async()=>{const list=await invoke<AudioInput[]>('get_audio_devices');if(!Array.isArray(list))throw new Error('소리 장치 목록 형식 오류');const defaultName=await invoke<string|null>('ko_default_playback_device').catch(()=>null);const preferred=systemAudioDevices(list).find(device=>device.name===defaultName)??systemAudioDevices(list)[0];setDevices(list);setMicrophone(value=>value||microphoneInputs(list)[0]?.name||'');setSystemDevice(value=>value||(preferred?deviceKey(preferred):''));await refreshStereoMix();return list;};
  const enableStereoMix=async()=>{if(stereoMixBusy||modeRef.current!=='idle')return;setStereoMixBusy(true);setError('');setNotice('스테레오 믹스를 켜는 중입니다. 권한 확인 창이 나오면 예를 눌러 주세요.');try{const status=await invoke<StereoMixStatus>('ko_enable_stereo_mix');setStereoMix(status);const list=await refreshDevices();const mix=list.find(isStereoMix);if(mix){setSystemDevice(deviceKey(mix));setRecordingKind('pc');setNotice('스테레오 믹스를 켰습니다. 녹음 장치로 선택했습니다.');}else setError('Windows에서는 켜졌지만 앱의 장치 목록에는 아직 없습니다. 소리 장치 새로고침을 눌러 주세요.');}catch(e){setError(messageOf(e));await refreshStereoMix();}finally{setStereoMixBusy(false);}};
 const refreshModels=async()=>{const list=await invoke<ModelOption[]>('ko_models');if(!Array.isArray(list))throw new Error('요약 모델 목록 형식 오류');setModels(list);let previous='';try{previous=window.localStorage.getItem('stream-record.summary-model')||'';}catch{}setModel(v=>list.some(m=>modelKey(m)===v)?v:list.some(m=>modelKey(m)===previous)?previous:modelKeyOrEmpty(list.find(m=>m.provider==='builtin'||m.provider==='local')));};
 const whisperConfig=async():Promise<Config>=>{const config=await ensureKoreanWhisper(value=>{setNotice(value);setModelStatus(value);});return config;};
 const loadImported=(meetingId:string)=>loadAllTranscriptRows(meetingId,
  (id,limit,offset)=>invoke('api_get_meeting_transcripts',{meetingId:id,limit,offset}));
 const recordingMode=async(fallback:Mode)=>{
  try{return await invoke<boolean>('is_recording')?'recording':'idle';}
  catch(e){setNotice(`녹음 상태 확인 실패: ${messageOf(e)}`);return fallback;}
 };
 useEffect(()=>{
  let cancelled=false;const cleanups:UnlistenFn[]=[];
  const register=async<T,>(name:string,handler:(v:T)=>void)=>{const stop=await listen<T>(name,e=>{if(!cancelled)handler(e.payload);});if(cancelled)stop();else cleanups.push(stop);};
  const initialise=async()=>{
   await register<null>('ko-exit-requested',()=>setExitOpen(true));
   await register<null>('ko-show-settings',()=>navigate('settings'));
   await register<null>('ko-stop-requested',()=>trayStop.current());
   await register<null>('ko-recording-toggle-requested',()=>{if(modeRef.current==='recording')trayStop.current();else{navigate('recording');setNotice('녹음 방식과 입력 장치·동의를 확인한 뒤 녹음 시작을 누르세요.');}});
   await register<TranscriptRow>('transcript-update',v=>{if(['starting','recording','stopping'].includes(modeRef.current)){try{setRows(diarization.applyLive(upsertRow(rowsRef.current,v)));}catch(e){setError(messageOf(e));}}});
   await register<{audio_file?:string}>('recording-saved',v=>{if(['recording','stopping'].includes(modeRef.current)&&typeof v.audio_file==='string'){audioPath.current=v.audio_file;audioSha256.current='';setAudioSource(null);dirty.current++;}});
   await register<ImportProgress>('import-progress',v=>{if(modeRef.current==='importing'){setProgress(Math.min(100,Math.max(0,v.progress_percentage||0)));setNotice(v.message);}});
   await register<ImportResult>('import-complete',v=>{if(modeRef.current!=='importing')return;void(async()=>{try{setRows(await loadImported(v.meeting_id));setTitle(v.title);setProgress(100);await persist();await exportFile('transcript');setNotice(`파일 전사 완료 · ${rowsRef.current.length}구간. 회의록 생성 버튼으로 요약하세요.`);}catch(e){setError(messageOf(e));}finally{if(!cancelled)setMode('idle');}})();});
   await register<{error:string}>('import-error',v=>{if(modeRef.current==='importing'){setError(v.error||'녹음파일 변환 실패');setMode('idle');}});
   await register<{warning:string}>('import-warning',v=>setNotice(v.warning));
   const appWindow=getCurrentWindow();
   const close=await appWindow.onCloseRequested(async e=>{e.preventDefault();try{await appWindow.hide();}catch(error){if(!cancelled)setNotice(`트레이로 숨기지 못했습니다: ${messageOf(error)}`);}});if(cancelled)close();else cleanups.push(close);
   try{await recordHistory.initialize();setNotice('기록을 불러왔습니다. 왼쪽 목록에서 저장한 기록을 다시 열 수 있습니다.');}
   catch(e){setNotice(`복구 파일을 열지 못했지만 새 녹음·파일 전사는 사용할 수 있습니다: ${messageOf(e)}`);}
   await refreshDevices().catch(e=>setNotice(`입력 장치를 읽지 못했습니다. 파일 전사는 사용할 수 있습니다: ${messageOf(e)}`));
   const active=await invoke<boolean>('is_recording').catch(e=>{setNotice(`녹음 상태 확인 실패: ${messageOf(e)}`);return false;});
   const importing=await invoke<boolean>('is_import_in_progress_command').catch(e=>{setNotice(`파일 전사 상태 확인 실패: ${messageOf(e)}`);return false;});if(cancelled)return;
   if(active){setMode('recording');try{const history=readRows(await invoke('get_transcript_history'));for(const row of rowsRef.current){if(row.sequence_id!==undefined&&!history.some(r=>r.sequence_id===row.sequence_id))history.push(row);}setRows(history);}catch(e){setError(`진행 중인 전사 기록 조회 실패: ${messageOf(e)}`);}}else setMode(importing?'importing':'idle');
   setReady(true);void refreshModels().catch(e=>{if(!cancelled)setNotice(`전사는 사용 가능합니다. 요약 모델: ${messageOf(e)}`);});
  };
  void initialise().catch(e=>{if(!cancelled)setError(messageOf(e));});
  let saved=0;const timer=window.setInterval(()=>{if(modeRef.current==='loading'||recordHistory.isTransitioning()||dirty.current===saved)return;const revision=dirty.current;void persist().then(()=>{saved=revision;}).catch(e=>{if(!cancelled)setError(`복구 저장 실패: ${messageOf(e)}`);});},10000);
  return()=>{cancelled=true;window.clearInterval(timer);cleanups.forEach(f=>f());};
  // Subscriptions live for this component; their handlers use refs for current data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{if(mode!=='recording'||!startedAt.current)return;const tick=()=>setElapsed(Math.max(0,Math.floor((Date.now()-Date.parse(startedAt.current||''))/1000)));tick();const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer);},[mode]);
 const start=async(inputName:string,successNotice:string,deviceType:AudioInput['device_type']='Input')=>{
  if(modeRef.current!=='idle'||!ready||!consent||!inputName)return;
  setMode('starting');setError('');setNotice('입력 장치와 한국어 모델 확인 중');
  try{await whisperConfig();await archive();await persist();await invoke('ko_start_recording',{micName:deviceType==='Input'?inputName:null,systemName:deviceType==='Output'?inputName:null,title:titleRef.current,glossary:glossaryRef.current});startedAt.current=new Date().toISOString();setElapsed(0);setMode('recording');setNotice(successNotice);await persist();}
  catch(e){setError(messageOf(e));setMode(await recordingMode('idle'));}
 };
 const validateVideo=async()=>{const validated=await invoke<string>('ko_validate_video',{url:videoUrlRef.current.trim()});const embed=youtubeEmbedUrl(validated);videoUrlRef.current=validated;setVideoUrlState(validated);setVideoEmbedUrl(embed);dirty.current++;return validated;};
 const prepareVideo=async()=>{if(modeRef.current!=='idle'||!videoUrlRef.current.trim())return;setError('');setNotice('YouTube 링크 확인 중');try{await validateVideo();setNotice('영상 준비 완료. 플레이어에서 재생할 수 있습니다. 녹음은 아직 시작되지 않았습니다.');}catch(e){setVideoEmbedUrl('');setError(messageOf(e));}};
 const startVideo=async()=>{
  const source=selectedSystemDevice(devices,systemDevice);
  if(modeRef.current!=='idle'||!ready||!consent||!source||!videoUrlRef.current.trim())return;
  setMode('starting');setError('');setNotice('영상 링크와 한국어 모델 확인 중');
  let recordingStarted=false;
  try{await whisperConfig();await validateVideo();await archive();if(!titleRef.current.trim())setTitle('YouTube 영상 기록');await persist();await invoke('ko_start_recording',{micName:source.device_type==='Input'?source.name:null,systemName:source.device_type==='Output'?source.name:null,title:titleRef.current,glossary:glossaryRef.current});startedAt.current=new Date().toISOString();setElapsed(0);recordingStarted=true;setMode('recording');setNotice('녹음 중입니다. 영상에서 재생을 누르세요. 선택한 스피커·헤드폰으로 재생되는 소리를 받아씁니다.');await persist();}
  catch(e){const rollback=recordingStarted?await invoke('ko_stop_recording').then(()=>'',x=>` 녹음 정리 실패: ${messageOf(x)}`):'';setError(messageOf(e)+rollback);setMode(await recordingMode('idle'));}
 };
 const stop=async()=>{
  if(modeRef.current!=='recording')return false;setMode('stopping');setError('');setStopFailure('');setAcknowledgeStopFailure(false);let videoNote='';
  try{await invoke('ko_stop_recording');await persist();if(rowsRef.current.length)await exportFile('transcript');setNotice('녹음 종료. 원문을 확인한 뒤 회의록·요약본을 생성하세요.'+videoNote);setMode('idle');return true;}
  catch(e){const failure=`녹음 중지 또는 저장을 완료하지 못했습니다. ${messageOf(e)}`;setStopFailure(failure);setError(failure);setMode(await recordingMode('recording'));try{await persist();}catch(snapshotError){setError(`${failure} 복구 저장도 실패했습니다: ${messageOf(snapshotError)}`);}return false;}
 };
 useEffect(()=>{trayStop.current=()=>{void stop();};});
 const importAudio=async()=>{
  if(modeRef.current!=='idle'||!ready||!consent)return;setMode('importing');setError('');setProgress(0);setNotice('녹음파일을 선택하세요.');
  try{const f=await invoke<AudioFile|null>('select_and_validate_audio_command');if(!f){setMode('idle');setNotice('파일 선택 취소');return;}const c=await whisperConfig();await archive();audioPath.current=f.path;await persist();setNotice(`${f.filename} 전사 시작`);await invoke('start_import_audio_command',{sourcePath:f.path,title:titleRef.current,language:'ko',model:c.model,provider:'whisper'});}
  catch(e){setError(messageOf(e));setMode('idle');}
 };
 const summarize=async()=>{
  const chosen=models.find(m=>modelKey(m)===model);
  if(modeRef.current!=='idle'||!rowsRef.current.length||!chosen)return;setMode('summarizing');setError('');cancelSummary.current=false;
  try{const result=await createStructuredMinutes({rows:rowsRef.current,title:titleRef.current,glossary:glossaryRef.current,modelKey:`${modelKey(chosen)}@${chosen.revision??''}`,generate:text=>generateText({model:chosen.id,revision:chosen.revision,text,stage:'structured',provider:chosen.provider}),progress:setNotice,cancelled:()=>cancelSummary.current,checkpoint:summaryDraft.current,save:async value=>{summaryDraft.current={key:value.key,notes:{...value.notes}};dirty.current++;await persist();}});setMinutes(result);await persist();await exportFile('minutes');setNotice('전체 구간 회의록 초안 작성 완료. 결정·수치의 근거 인용을 원문과 대조하세요.');}
  catch(e){setError(messageOf(e));}finally{if(chosen.provider==='local'){try{await generateText({model:chosen.id,revision:chosen.revision,text:'',stage:'release',provider:'local'});}catch(e){setNotice(`자료는 보존되어 있습니다. 로컬 모델 메모리 해제 실패: ${messageOf(e)}`);}}setMode('idle');}
 };
 const prepareAudio=async(select:boolean)=>{
  if(modeRef.current!=='idle'||!ready)return;setMode('reviewing');setError('');audioElement.current?.pause();
  try{let path=audioPath.current;if(select||!path){const chosen=await invoke<AudioFile|null>('select_and_validate_audio_command');if(!chosen)return;path=chosen.path;}
   setNotice('원음 길이와 파일 SHA-256을 확인합니다. 음성은 외부로 전송하지 않습니다.');
   const source=await invoke<ReviewAudio>('ko_open_review_audio',{path});
   if(audioSha256.current&&source.sha256!==audioSha256.current)throw new Error('기존 전사와 연결한 원음의 SHA-256이 다릅니다. 다른 파일로 교체하지 않았습니다.');
   if(select&&!audioSha256.current&&rowsRef.current.length&&!window.confirm('선택한 파일이 현재 전사문의 원본 음성인지 확인했습니까? 시간정보는 선택한 파일의 시작을 기준으로 재생됩니다.'))return;
   audioPath.current=source.path;audioSha256.current=source.sha256;setAudioSource(source);dirty.current++;await persist();setNotice('원음 준비 완료. 전사 구간의 듣기 버튼으로 원문을 대조하세요.');
  }catch(e){setError(messageOf(e));}finally{setMode('idle');}
 };
 const playRow=(row:TranscriptRow)=>{const player=audioElement.current;const range=audioSource?playbackRange(row,audioSource.duration_seconds):null;if(modeRef.current!=='idle'||!player||!range)return;if(player.readyState<1){setNotice('원음 재생정보를 읽는 중입니다. 잠시 후 구간 듣기를 다시 누르세요.');return;}playbackEnd.current=range.end;player.currentTime=range.start;void player.play().catch(e=>setError(`원음 재생 실패: ${messageOf(e)}`));};
 const recover=async()=>{
  if(modeRef.current!=='idle'||!audioSource||!consent)return;setMode('recovering');setError('');audioElement.current?.pause();cancelRecovery.current=false;
  try{const c=await whisperConfig();const recovered=await recoverAudio({audio:audioSource,model:c.model,glossary:glossaryRef.current,checkpoint:recoveryDraft.current,decode:(start,duration)=>invoke('ko_transcribe_review_window',{path:audioSource.path,start,duration,model:c.model,glossary:glossaryRef.current}),save:async value=>{recoveryDraft.current=value;dirty.current++;await persist();},progress:setNotice,cancelled:()=>cancelRecovery.current});
   if(rowsRef.current.length||minutesRef.current)await exportFile('bundle');setEpoch(value=>value+1);setRows(recovered);setMinutes('');summaryDraft.current=null;liveSummaryDraft.current=null;setLiveSummary('');setPage(0);setQuery('');setEditing(null);await persist();await exportFile('bundle');setNotice(`저장 음성 전체 처리 완료 · ${recovered.length}개 발언 구간. 이전 원문은 JSON으로 보관했습니다. 경계의 누락·오인식은 원음과 대조하세요.`);
  }catch(e){setError(messageOf(e));}finally{setMode('idle');}
 };
 const applyQueueRecovery=async(recovered:TranscriptRow[],complete:boolean)=>{if(modeRef.current!=='idle')throw new Error('진행 중인 작업을 마친 뒤 복구 결과를 여세요.');setMode('recovering');try{await archive();setVideoUrl('');setTitle(complete?'복구된 전사 구간':'복구된 전사 구간 · 일부 미처리');setRows(recovered);await persist();await exportFile('bundle');setNotice('복구 대기열의 전사를 별도 작업으로 열었습니다. 녹음 전체가 아닌 대기열 결과입니다.');}finally{setMode('idle');}};
 const save=(kind:'transcript'|'corrected'|'minutes'|'bundle')=>{if(saveInFlight.current)return;saveInFlight.current=true;setSaving(true);void exportFile(kind).then(()=>persist()).catch(e=>setError(messageOf(e))).finally(()=>{saveInFlight.current=false;setSaving(false);});};
 const confirmExit=async()=>{
  if(exiting)return;setExiting(true);setError('');
  try{if(modeRef.current==='recording'&&!await stop())return;
   if(modeRef.current!=='idle')throw new Error('진행 중인 처리가 끝난 뒤 종료해 주세요. 자료는 유지됩니다.');
   if(stopFailure&&!acknowledgeStopFailure)throw new Error('원음 저장 실패 가능성을 확인해야 종료할 수 있습니다. 계속 사용을 선택해 전사문을 먼저 내보낼 수 있습니다.');
   await persist();if(snapshotQueue.current)await snapshotQueue.current;if(rowsRef.current.length||minutesRef.current)await exportFile('bundle');
   await invoke('ko_exit_app');
  }catch(e){setError(`종료하지 않았습니다. ${messageOf(e)}`);}finally{setExiting(false);}
 };
 return {records:recordHistory.records,activeRecordId:recordHistory.activeRecordId,recordsLoading:recordHistory.recordsLoading,historyError:recordHistory.historyError,recordSwitchBlocked:recordHistory.recordSwitchBlocked,recordSwitchBlockedReason:recordHistory.recordSwitchBlockedReason,readerSessionKey:recordHistory.activeRecordId,refreshRecords:recordHistory.refreshRecords,newRecord:async()=>{await recordHistory.newRecord();navigate('recording');setNotice('새 기록을 준비했습니다. 입력과 동의를 확인한 뒤 시작하세요.');},openRecord:async(id:string)=>{await recordHistory.openRecord(id);navigate('dictation');setNotice('저장된 기록을 열었습니다. 원음은 다시 연결해 확인할 수 있습니다.');},applyQueueRecovery,setRecoveryBusy:(busy:boolean)=>setMode(busy?'recovering':'idle'),diarization,correction,mode,busy:mode!=='idle',ready,title,setTitle,videoUrl,setVideoUrl,videoEmbedUrl,glossary,setGlossary:(value:string)=>{glossaryRef.current=value;setGlossaryState(value);dirty.current++;},
  recordingKind,setRecordingKind,devices,microphone,setMicrophone,systemDevice,setSystemDevice,rows,setRows,minutes,setMinutes,models,model,setModel:(value:string)=>{setModel(value);try{window.localStorage.setItem('stream-record.summary-model',value);}catch{}},
  liveSummary,liveSummaryEnabled,setLiveSummaryEnabled,liveSummaryStatus:cumulative.status,liveSummaryRunning:cumulative.running,liveSummaryHistory:liveSummaryDraft.current?.history??[],
  error,setError,notice,setNotice,savedPath,saving,progress,consent,setConsent,follow,setFollow,query,setQuery,page,setPage,editing,setEditing,audioSource,audioElement,playbackEnd,modeRef,
  refreshDevices,refreshStereoMix,enableStereoMix,stereoMix,stereoMixBusy,refreshModels,start,prepareVideo,startVideo,stop,importAudio,summarize,prepareAudio,playRow,recover,persist,save,cancelSummary,cancelRecovery,view,navigate,exitOpen,setExitOpen,exiting,confirmExit,
  stopFailure,acknowledgeStopFailure,setAcknowledgeStopFailure,elapsed,hasRecordingStart:Boolean(startedAt.current),modelStatus,modelKey,modeLabel:labels[mode],messageOf,
 };
}
export type MeetingSession=ReturnType<typeof useMeetingSession>;

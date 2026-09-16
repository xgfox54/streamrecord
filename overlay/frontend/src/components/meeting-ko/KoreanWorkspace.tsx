'use client';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen,type UnlistenFn} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {createMinutes,loadAllTranscriptRows,microphoneInputs,readRows,rowTime,stereoMixName,transcriptText,upsertRow,type AudioInput,type TranscriptRow} from './core';
import styles from './workspace.module.css';
type Mode='loading'|'idle'|'starting'|'recording'|'stopping'|'importing'|'summarizing';
type Config={provider:string;model:string};
type ModelOption={id:string;provider:'local'|'subscription'};
type AudioFile={path:string;filename:string};
type ImportProgress={progress_percentage:number;message:string};
type ImportResult={meeting_id:string;title:string};
type Snapshot={version:number;title:string;rows:TranscriptRow[];minutes:string;startedAt:string|null;videoUrl?:string};
const labels:Record<Mode,string>={loading:'초기화 중',idle:'준비',starting:'녹음 시작 중',recording:'녹음 · 실시간 전사 중',stopping:'마지막 음성 처리 중',importing:'녹음파일 전사 중',summarizing:'회의록 작성 중'};
const messageOf=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function KoreanWorkspace(){
 const [mode,setModeState]=useState<Mode>('loading');const modeRef=useRef<Mode>('loading');
 const setMode=(v:Mode)=>{modeRef.current=v;setModeState(v);};
 const [ready,setReady]=useState(false);const [title,setTitleState]=useState('새 회의');const titleRef=useRef('새 회의');
 const [videoUrl,setVideoUrlState]=useState('');const videoUrlRef=useRef('');
 const [devices,setDevices]=useState<AudioInput[]>([]);const [microphone,setMicrophone]=useState('');
 const [rows,setRowsState]=useState<TranscriptRow[]>([]);const rowsRef=useRef<TranscriptRow[]>([]);
 const [minutes,setMinutesState]=useState('');const minutesRef=useRef('');const startedAt=useRef<string|null>(null);
 const [models,setModels]=useState<ModelOption[]>([]);const [model,setModel]=useState('');
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const [savedPath,setSavedPath]=useState('');
 const [progress,setProgress]=useState(0);const [consent,setConsent]=useState(false);const [follow,setFollow]=useState(true);
 const cancelSummary=useRef(false);const bottom=useRef<HTMLDivElement>(null);const dirty=useRef(0);
 const snapshotQueue=useRef<Promise<unknown>>(Promise.resolve());
 const setRows=(v:TranscriptRow[])=>{rowsRef.current=v;setRowsState(v);dirty.current++;};
 const setMinutes=(v:string)=>{minutesRef.current=v;setMinutesState(v);dirty.current++;};
 const setTitle=(v:string)=>{titleRef.current=v;setTitleState(v);dirty.current++;};
 const setVideoUrl=(v:string)=>{videoUrlRef.current=v;setVideoUrlState(v);dirty.current++;};
 const snapshot=():Snapshot=>({version:1,title:titleRef.current,rows:rowsRef.current,minutes:minutesRef.current,startedAt:startedAt.current,videoUrl:videoUrlRef.current});
 const persist=()=>{const content=JSON.stringify(snapshot());const next=snapshotQueue.current.catch(()=>undefined).then(()=>invoke('ko_save_snapshot',{content}));snapshotQueue.current=next;return next;};
 const exportFile=async(kind:'transcript'|'minutes'|'bundle')=>{
  const content=kind==='transcript'?transcriptText(rowsRef.current):kind==='minutes'?minutesRef.current:JSON.stringify(snapshot(),null,2);
  if(!content.trim())throw new Error('저장할 내용이 없습니다.');
  const path=await invoke<string>('ko_export',{title:titleRef.current,kind,content});setSavedPath(path);return path;
 };
 const archive=async()=>{if(rowsRef.current.length||minutesRef.current)await exportFile('bundle');setRows([]);setMinutes('');startedAt.current=null;};
 const refreshDevices=async()=>{const list=await invoke<AudioInput[]>('get_audio_devices');if(!Array.isArray(list))throw new Error('입력 장치 목록 형식 오류');const inputs=list.filter(d=>d.device_type==='Input');const microphones=microphoneInputs(inputs);setDevices(inputs);setMicrophone(v=>microphones.some(d=>d.name===v)?v:microphones[0]?.name||'');};
 const refreshModels=async()=>{const list=await invoke<ModelOption[]>('ko_models');if(!Array.isArray(list))throw new Error('요약 모델 목록 형식 오류');setModels(list);setModel(v=>list.some(m=>m.id===v)?v:list[0]?.id||'');};
 const whisperConfig=async():Promise<Config>=>{const c=await invoke<Config|null>('api_get_transcript_config');if(!c||c.provider!=='localWhisper'||!c.model||c.model.includes('.en'))throw new Error('“음성 모델 설정”에서 Local Whisper 다국어 모델을 내려받고 선택하세요. 영어 전용 .en 모델은 한국어를 지원하지 않습니다.');return c;};
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
   await register<TranscriptRow>('transcript-update',v=>{if(['starting','recording','stopping'].includes(modeRef.current)){try{setRows(upsertRow(rowsRef.current,v));}catch(e){setError(messageOf(e));}}});
   await register<ImportProgress>('import-progress',v=>{if(modeRef.current==='importing'){setProgress(Math.min(100,Math.max(0,v.progress_percentage||0)));setNotice(v.message);}});
   await register<ImportResult>('import-complete',v=>{if(modeRef.current!=='importing')return;void(async()=>{try{setRows(await loadImported(v.meeting_id));setTitle(v.title);setProgress(100);await persist();await exportFile('transcript');setNotice(`파일 전사 완료 · ${rowsRef.current.length}구간. 회의록 생성 버튼으로 요약하세요.`);}catch(e){setError(messageOf(e));}finally{if(!cancelled)setMode('idle');}})();});
   await register<{error:string}>('import-error',v=>{if(modeRef.current==='importing'){setError(v.error||'녹음파일 변환 실패');setMode('idle');}});
   await register<{warning:string}>('import-warning',v=>setNotice(v.warning));
   const close=await getCurrentWindow().onCloseRequested(e=>{if(['starting','recording','stopping','importing','summarizing'].includes(modeRef.current)){e.preventDefault();setError('녹음·변환·요약 작업을 마친 뒤 창을 닫아 주세요.');}});if(cancelled)close();else cleanups.push(close);
   try{const old=await invoke<Snapshot|null>('ko_load_snapshot');if(old){if(old.version!==1)throw new Error('복구 파일 버전이 다릅니다. 원본은 변경하지 않았습니다.');setRows(readRows(old.rows));setTitle(old.title||'복구된 회의');setMinutes(old.minutes||'');setVideoUrl(typeof old.videoUrl==='string'?old.videoUrl:'');startedAt.current=old.startedAt;setNotice('이전 작업을 복구했습니다. 새 작업 전에는 기존 결과를 JSON으로 보관합니다.');}}
   catch(e){setNotice(`복구 파일을 열지 못했지만 새 녹음·파일 전사는 사용할 수 있습니다: ${messageOf(e)}`);}
   await refreshDevices().catch(e=>setNotice(`입력 장치를 읽지 못했습니다. 파일 전사는 사용할 수 있습니다: ${messageOf(e)}`));
   const active=await invoke<boolean>('is_recording').catch(e=>{setNotice(`녹음 상태 확인 실패: ${messageOf(e)}`);return false;});
   const importing=await invoke<boolean>('is_import_in_progress_command').catch(e=>{setNotice(`파일 전사 상태 확인 실패: ${messageOf(e)}`);return false;});if(cancelled)return;
   if(active){setMode('recording');try{const history=readRows(await invoke('get_transcript_history'));for(const row of rowsRef.current){if(row.sequence_id!==undefined&&!history.some(r=>r.sequence_id===row.sequence_id))history.push(row);}setRows(history);}catch(e){setError(`진행 중인 전사 기록 조회 실패: ${messageOf(e)}`);}}else setMode(importing?'importing':'idle');
   setReady(true);void refreshModels().catch(e=>{if(!cancelled)setNotice(`전사는 사용 가능합니다. 요약 모델: ${messageOf(e)}`);});
  };
  void initialise().catch(e=>{if(!cancelled)setError(messageOf(e));});
  let saved=0;const timer=window.setInterval(()=>{if(modeRef.current==='loading'||dirty.current===saved)return;const revision=dirty.current;void persist().then(()=>{saved=revision;}).catch(e=>{if(!cancelled)setError(`복구 저장 실패: ${messageOf(e)}`);});},10000);
  return()=>{cancelled=true;window.clearInterval(timer);cleanups.forEach(f=>f());};
  // Subscriptions live for this component; their handlers use refs for current data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{if(follow)bottom.current?.scrollIntoView({block:'end'});},[rows,follow]);
 const start=async(inputName:string,successNotice:string)=>{
  if(modeRef.current!=='idle'||!ready||!consent||!inputName)return;
  setMode('starting');setError('');setNotice('입력 장치와 한국어 모델 확인 중');
  try{await whisperConfig();await archive();startedAt.current=new Date().toISOString();await persist();await invoke('ko_start_recording',{micName:inputName,title:titleRef.current});setMode('recording');setNotice(successNotice);await persist();}
  catch(e){setError(messageOf(e));setMode(await recordingMode('idle'));}
 };
 const startVideo=async()=>{
  const stereoMix=stereoMixName(devices);
  if(modeRef.current!=='idle'||!ready||!consent||!stereoMix||!videoUrlRef.current.trim())return;
  setMode('starting');setError('');setNotice('영상 링크와 한국어 모델 확인 중');
  let recordingStarted=false;
  try{await whisperConfig();const validated=await invoke<string>('ko_validate_video',{url:videoUrlRef.current.trim()});await archive();if(!titleRef.current.trim())setTitle('유튜브 영상 기록');startedAt.current=new Date().toISOString();await persist();await invoke('ko_start_recording',{micName:stereoMix,title:titleRef.current});recordingStarted=true;const opened=await invoke<string>('ko_open_video',{url:validated});setVideoUrl(opened);setMode('recording');setNotice('영상 창에서 재생을 누르세요. PC 스피커로 나오는 소리를 그대로 전사합니다. 음소거하면 전사되지 않습니다.');await persist();}
  catch(e){const rollback=recordingStarted?await invoke('ko_stop_recording').then(()=>'',x=>` 녹음 정리 실패: ${messageOf(x)}`):'';await invoke('ko_close_video').catch(()=>undefined);setError(messageOf(e)+rollback);setMode(await recordingMode('idle'));}
 };
 const stop=async()=>{
  if(modeRef.current!=='recording')return;setMode('stopping');setError('');let videoNote='';
  try{await invoke('ko_close_video').catch(e=>{videoNote=' 영상 창은 직접 닫아 주세요: '+messageOf(e);});await invoke('ko_stop_recording');await persist();if(rowsRef.current.length)await exportFile('transcript');setNotice('녹음 종료. 원문을 확인한 뒤 회의록·요약본을 생성하세요.'+videoNote);setMode('idle');}
  catch(e){setError(messageOf(e));setMode(await recordingMode('recording'));}
 };
 const importAudio=async()=>{
  if(modeRef.current!=='idle'||!ready||!consent)return;setMode('importing');setError('');setProgress(0);setNotice('녹음파일을 선택하세요.');
  try{const c=await whisperConfig();const f=await invoke<AudioFile|null>('select_and_validate_audio_command');if(!f){setMode('idle');setNotice('파일 선택 취소');return;}await archive();await persist();setNotice(`${f.filename} 전사 시작`);await invoke('start_import_audio_command',{sourcePath:f.path,title:titleRef.current,language:'ko',model:c.model,provider:'whisper'});}
  catch(e){setError(messageOf(e));setMode('idle');}
 };
 const summarize=async()=>{
  const chosen=models.find(m=>m.id===model);
  if(modeRef.current!=='idle'||!rowsRef.current.length||!chosen)return;setMode('summarizing');setError('');cancelSummary.current=false;
  try{const result=await createMinutes(transcriptText(rowsRef.current),(text,stage)=>invoke<string>('ko_generate',{model:chosen.id,text,stage,provider:chosen.provider}),setNotice,()=>cancelSummary.current);setMinutes(result);await persist();await exportFile('minutes');setNotice('회의록·요약본 초안 작성 완료. 원문과 대조하여 확인하세요.');}
  catch(e){setError(messageOf(e));}finally{setMode('idle');}
 };
 const save=(kind:'transcript'|'minutes'|'bundle')=>{void exportFile(kind).then(()=>persist()).catch(e=>setError(messageOf(e)));};
 const busy=mode!=='idle';const displayed=rows.slice(-300);const microphones=microphoneInputs(devices);const stereoMix=stereoMixName(devices);
 return <main className={styles.workspace}>
  <header className={styles.header}><div><p className={styles.kicker}>STREAM RECORD · KOREAN WORKSPACE</p><h1>실시간 회의록</h1><p>마이크·PC 재생 음성 받아쓰기 · 녹음파일 변환 · 구독(GPT·Claude) 또는 로컬 모델 요약</p></div><span className={mode==='recording'?styles.live:styles.badge}>{labels[mode]}</span></header>
  <section className={styles.controls} aria-label="녹음 설정">
   <label>회의 제목<input value={title} maxLength={100} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
   <label>마이크 입력 장치<select value={microphone} disabled={busy} onChange={e=>setMicrophone(e.target.value)}><option value="">마이크를 선택하세요</option>{microphones.map(d=><option key={d.name} value={d.name}>{d.name}</option>)}</select></label>
   <button disabled={busy} onClick={()=>void refreshDevices().catch(e=>setError(messageOf(e)))}>장치 새로고침</button><button disabled={busy} onClick={()=>{window.location.href='/upstream';}}>음성 모델 설정</button>
   <p className={styles.hint}>마이크 녹음은 위 장치만 사용합니다. {stereoMix?`PC 소리 입력: ${stereoMix}`:'PC 소리 녹음에 필요한 Stereo Mix를 찾지 못했습니다. Windows 녹음 장치에서 활성화하세요.'} 두 방식 모두 별도의 시스템 오디오 입력을 함께 켜지 않습니다.</p>
   <div className={styles.actions+' '+styles.modelRow}><label>유튜브 링크<input value={videoUrl} maxLength={500} disabled={busy} placeholder="https://www.youtube.com/watch?v=..." onChange={e=>setVideoUrl(e.target.value)}/></label><button className={styles.primary} disabled={!ready||busy||!stereoMix||!consent||!videoUrl.trim()} onClick={()=>void startVideo()}>영상 재생 + 전사</button></div>
   <p className={styles.hint}>유튜브 링크를 넣으면 앱 안 영상 창에서 재생하고 그 소리를 Stereo Mix로 받아 실시간 전사합니다. 영상을 내려받지 않으며 재생 길이만큼 시간이 걸립니다. 전사문은 개인 기록 용도로만 사용하세요.</p>
   <label className={styles.check}><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>회의 참여자에게 녹음을 알렸으며 녹음·처리 권한을 확인했습니다.</label>
   <div className={styles.actions}><button className={styles.primary} disabled={!ready||busy||!microphone||!consent} onClick={()=>void start(microphone,'마이크로 들어오는 외부 소리를 녹음하고 실시간 전사합니다.')}>외부 소리 녹음 (마이크)</button><button className={styles.primary} disabled={!ready||busy||!stereoMix||!consent} onClick={()=>void start(stereoMix,'PC에서 재생되는 소리를 Stereo Mix로 녹음하고 실시간 전사합니다.')}>PC 소리 녹음 (Stereo Mix)</button><button className={styles.stop} disabled={mode!=='recording'} onClick={()=>void stop()}>녹음 중지</button><button disabled={!ready||busy||!consent} onClick={()=>void importAudio()}>녹음파일 첨부</button></div>
  </section>
  {error&&<div role="alert" className={styles.error}>{error}<button onClick={()=>setError('')}>닫기</button></div>}
  <div role="status" className={styles.status}>{notice||'음성 모델을 준비한 후 마이크 녹음, PC 소리 녹음 또는 녹음파일 첨부를 선택하세요.'}</div>
  {mode==='importing'&&<progress className={styles.progress} value={progress} max={100} aria-label="파일 전사 진행률"/>}
  {savedPath&&<p className={styles.path}>최근 저장: {savedPath}</p>}
  <div className={styles.columns}>
   <section className={styles.panel} aria-label="실시간 전사"><div className={styles.panelHead}><h2>전사 원문 <small>{rows.length}구간</small></h2><label className={styles.check}><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>자동 스크롤</label></div>
    <div className={styles.transcript} role="log" aria-live="off" aria-label="실시간 전사 텍스트">
     {!rows.length&&<p className={styles.empty}>아직 전사문이 없습니다.<br/>마이크로 말하거나 PC에서 회의 음성을 재생해 주세요.</p>}
     {rows.length>300&&<p className={styles.hint}>화면에는 최근 300구간을 표시합니다. TXT·JSON에는 전체 원문이 저장됩니다.</p>}
     {displayed.map((r,i)=><article key={r.sequence_id??r.id??`row-${rows.length-displayed.length+i}`} className={styles.segment}><time>{rowTime(r)}</time><p>{r.is_partial&&<small>[미확정] </small>}{r.text}</p></article>)}<div ref={bottom}/>
    </div>
    <div className={styles.actions}><button disabled={!rows.length} onClick={()=>save('transcript')}>전체 원문 TXT 저장</button><button disabled={!rows.length&&!minutes} onClick={()=>save('bundle')}>원문·요약 JSON 저장</button></div>
   </section>
   <section className={styles.panel} aria-label="회의록과 요약본"><div className={styles.panelHead}><h2>회의록 · 요약본</h2><span className={styles.badge}>{models.find(m=>m.id===model)?.provider==='subscription'?'구독 · GPT·Claude':'Ollama · 로컬'}</span></div>
    <div className={styles.modelRow}><label>요약 모델<select value={model} disabled={busy} onChange={e=>setModel(e.target.value)}><option value="">요약 모델 선택</option>
     <optgroup label="구독 모델 (GPT · Claude 등)">{models.filter(m=>m.provider==='subscription').map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</optgroup>
     <optgroup label="로컬 모델">{models.filter(m=>m.provider==='local').map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</optgroup>
    </select></label><button disabled={busy} onClick={()=>void refreshModels().catch(e=>setError(messageOf(e)))}>모델 새로고침</button></div>
    <div className={styles.actions}><button className={styles.primary} disabled={busy||!rows.length||!model} onClick={()=>void summarize()}>회의록·요약본 생성</button>{mode==='summarizing'&&<button onClick={()=>{cancelSummary.current=true;setNotice('현재 구간 응답이 끝나면 취소합니다. 원문은 유지됩니다.');}}>현재 구간 후 취소</button>}</div>
    <textarea className={styles.minutes} value={minutes} disabled={busy} onChange={e=>setMinutes(e.target.value)} aria-label="편집 가능한 회의록과 요약본" placeholder={'회의록 생성 후 여기에 표시됩니다.\n\n핵심 요약 · 안건별 논의 · 확정 결정사항\n미결 사항 · 담당자별 후속조치\n\n발언에 없는 이름·기한을 추측하지 않도록 요청합니다.'}/>
    <div className={styles.actions}><button disabled={!minutes} onClick={()=>save('minutes')}>회의록 Markdown 저장</button></div><p className={styles.hint}>전사와 요약에는 오류가 있을 수 있습니다. 자동 화자 식별은 포함하지 않습니다. 요약은 녹음 종료 후 실행합니다. 구독 모델을 고르면 전사문이 해당 서비스로 전송됩니다. 로컬 모델은 PC 밖으로 나가지 않습니다.</p>
   </section>
  </div>
  <footer className={styles.hint}>10초 간격 최근 작업 복구 저장 · 내보내기: 문서 / Meetily-Korean / Exports · 모델 최초 다운로드에는 인터넷이 필요합니다.</footer>
 </main>;
}

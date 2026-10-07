'use client';
import {useState} from 'react';
import {Mic,MonitorPlay,Youtube,Upload,Square,Settings2} from 'lucide-react';
import {microphoneInputs} from '../meeting-ko/core';
import {deviceKey,systemAudioDevices,selectedSystemDevice} from './recording-source';
import {glossaryCharacterLimit} from '../meeting-ko/glossary';
import type {MeetingSession} from './useMeetingSession';
import {GlossaryPicker} from './GlossaryPicker';
import {StereoMixPanel} from './StereoMixPanel';
import {Spinner} from './TranscriptActivity';
import styles from '../meeting-ko/workspace.module.css';
import layout from './record-controls.module.css';
export type RecordInput='microphone'|'pc'|'youtube'|'file';
const sources:readonly {id:RecordInput;label:string;description:string;icon:typeof Mic}[]=[
 {id:'microphone',label:'마이크',description:'내 목소리·현장 회의',icon:Mic},
 {id:'pc',label:'PC 소리',description:'스피커·헤드폰에서 재생되는 소리',icon:MonitorPlay},
 {id:'youtube',label:'YouTube',description:'영상 보면서 녹음·받아쓰기',icon:Youtube},
 {id:'file',label:'음성 파일',description:'저장한 녹음 파일을 받아쓰기',icon:Upload},
];
export function CaptureActions({session:s,input}:{readonly session:MeetingSession;readonly input:RecordInput}){
 const microphone=microphoneInputs(s.devices).find(device=>device.name===s.microphone);
 const device=input==='microphone'?microphone:selectedSystemDevice(s.devices,s.systemDevice);
 const reason=!s.ready?'소리 장치를 확인하고 있습니다.':s.busy?'진행 중인 작업이 끝나면 다시 시작할 수 있습니다.':input!=='file'&&!device?'소리 장치를 선택하거나 장치 목록을 새로고침하세요.':input==='youtube'&&!s.videoEmbedUrl?'YouTube 링크를 입력하고 영상 불러오기를 눌러 주세요.':!s.consent?'녹음·처리 권한을 확인한 뒤 체크해 주세요.':'';
 const start=()=>{
  if(reason){s.setError(reason);if(typeof document!=='undefined')document.getElementById(!device&&input!=='file'?'record-device':input==='youtube'&&!s.videoEmbedUrl?'record-video-url':'record-consent')?.focus();return;}
  s.setError('');
  if(input==='file')void s.importAudio();
  else if(input==='youtube')void s.startVideo();
  else if(device)void s.start(device.name,input==='pc'?'PC 소리 녹음 중입니다. 선택한 스피커·헤드폰의 소리를 받아씁니다.':'마이크 녹음 중입니다. 아래 받아쓰기에서 내용을 확인하세요.',device.device_type);
 };
 return <div className={layout.captureArea}>
  <p id={input+'-record-start-help'} className={styles.hint}>{s.mode==='recording'?'녹음 중 · 끝내려면 중지 및 저장을 누르세요.':reason||(input==='file'?'파일을 선택하면 이 PC에서 받아쓰기를 시작합니다.':input==='youtube'?'녹음 시작 → 영상 재생 → 중지 및 저장':'녹음 시작을 누르면 아래에 받아쓰기가 표시됩니다.')}</p>
  <div className={layout.capture}>{s.hasRecordingStart&&<span className={layout.timer} aria-label="녹음 시간">{Math.floor(s.elapsed/60).toString().padStart(2,'0')}:{Math.floor(s.elapsed%60).toString().padStart(2,'0')}</span>}
   {s.mode==='recording'?<button className={styles.primary} onClick={()=>void s.stop()}><Square size={18} aria-hidden="true"/>중지 및 저장</button>:<button className={styles.primary} disabled={!s.ready||s.busy} aria-describedby={input+'-record-start-help'} onClick={start}>{s.mode==='starting'||s.mode==='stopping'?<Spinner/>:input==='file'?<Upload size={18} aria-hidden="true"/>:<Mic size={18} aria-hidden="true"/>}{s.mode==='starting'?'모델 준비 중…':s.mode==='stopping'?'마지막 문장 저장 중…':input==='file'?'음성 파일 선택':input==='pc'?'PC 소리 녹음 시작':input==='youtube'?'영상 소리 녹음 시작':'마이크 녹음 시작'}</button>}
  </div>
 </div>;
}
export function RecordToolbar({session:s,input,onInputChange}:{readonly session:MeetingSession;readonly input:RecordInput;readonly onInputChange:(value:RecordInput)=>void}){
 const [optionsOpen,setOptionsOpen]=useState(false);
 const microphones=microphoneInputs(s.devices);const systems=systemAudioDevices(s.devices);
 const selected=input==='microphone'?(microphones.some(device=>device.name===s.microphone)?s.microphone:''):(selectedSystemDevice(s.devices,s.systemDevice)?s.systemDevice:'');
 return <section className={layout.toolbar} aria-label="녹음 입력과 시작">
  <fieldset disabled={s.busy} className={layout.sources}><legend>1. 어떤 소리를 기록할까요?</legend>{sources.map(source=><label key={source.id} data-selected={input===source.id}><input type="radio" name="record-source" checked={input===source.id} onChange={()=>onInputChange(source.id)}/><source.icon size={20} aria-hidden="true"/><span><strong>{source.label}</strong><small>{source.description}</small></span></label>)}</fieldset>
  <div className={layout.essentials}>
   {input!=='file'&&<label className={layout.device}>녹음할 {input==='microphone'?'마이크':'스피커·헤드폰'}<select id="record-device" value={selected} disabled={s.busy} onChange={event=>input==='microphone'?s.setMicrophone(event.target.value):s.setSystemDevice(event.target.value)}><option value="">소리 장치를 선택하세요</option>{(input==='microphone'?microphones:systems).map(device=><option key={deviceKey(device)} value={input==='microphone'?device.name:deviceKey(device)}>{device.name}</option>)}</select></label>}
   <label className={styles.check+' '+layout.permission}><input id="record-consent" type="checkbox" checked={s.consent} disabled={s.busy} onChange={event=>s.setConsent(event.target.checked)}/><span>녹음·처리 권한을 확인했습니다.<small>회의는 참여자에게 알리고, 영상·파일은 이용 권한을 확인해 주세요.</small></span></label>
  </div>
  {(input==='pc'||input==='youtube')&&<p className={styles.hint}>선택한 장치에서 재생되는 다른 영상·알림 소리도 함께 녹음됩니다.</p>}
  {(input==='pc'||input==='youtube')&&<StereoMixPanel session={s}/>}
  <div className={layout.optionsRow}><button className={layout.optionsButton} aria-expanded={optionsOpen} aria-controls="record-options" onClick={()=>setOptionsOpen(value=>!value)}><Settings2 size={18} aria-hidden="true"/>추가 녹음 설정</button><button disabled={s.busy} onClick={()=>void s.refreshDevices().catch(error=>s.setError(s.messageOf(error)))}>소리 장치 새로고침</button></div>
  <div id="record-options" hidden={!optionsOpen} className={layout.optionsBody}><label>AI 보정에 참고할 용어<input value={s.glossary} maxLength={glossaryCharacterLimit} disabled={s.busy} onChange={event=>s.setGlossary(event.target.value)} placeholder="사람 이름 · 기관명 · 전문 용어"/></label><GlossaryPicker session={s}/><p className={styles.hint}>{s.modelStatus}</p><details className={styles.disclosure}><summary>소리 장치가 보이지 않을 때</summary><p>Windows 설정 → 시스템 → 소리에서 장치를 연결하고 목록을 새로고침하세요. 마이크는 개인정보 설정의 마이크 접근 권한도 확인하세요. PC 소리는 실제 스피커·헤드폰 장치로 녹음하며 스테레오 믹스가 없어도 사용할 수 있습니다. 스테레오 믹스가 꺼져 있으면 PC 소리·YouTube 화면의 ‘스테레오 믹스 켜기’로 켤 수 있습니다.</p></details></div>
  {input==='youtube'?<p className={styles.hint}>2. 아래 영상을 불러온 뒤 영상 오른쪽 아래에서 녹음을 시작하세요.</p>:<CaptureActions session={s} input={input}/>}
 </section>;
}

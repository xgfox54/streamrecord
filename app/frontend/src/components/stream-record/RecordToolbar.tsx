'use client';
import {useState} from 'react';
import {Mic,MonitorPlay,Youtube,Upload,Square,Settings2} from 'lucide-react';
import {microphoneInputs,stereoMixName} from '../meeting-ko/core';
import type {MeetingSession} from './useMeetingSession';
import {GlossaryPicker} from './GlossaryPicker';
import styles from '../meeting-ko/workspace.module.css';
import layout from './record-controls.module.css';
export type RecordInput='microphone'|'pc'|'youtube'|'file';
const sources:readonly {id:RecordInput;label:string;icon:typeof Mic}[]=[{id:'microphone',label:'마이크',icon:Mic},{id:'pc',label:'PC 소리',icon:MonitorPlay},{id:'youtube',label:'YouTube',icon:Youtube},{id:'file',label:'음성 파일',icon:Upload}];
export function RecordToolbar({session:s,input,onInputChange}:{readonly session:MeetingSession;readonly input:RecordInput;readonly onInputChange:(value:RecordInput)=>void}){
 const [optionsOpen,setOptionsOpen]=useState(false);
 const microphones=microphoneInputs(s.devices);const stereo=stereoMixName(s.devices);
 const selected=input==='microphone'?(microphones.some(device=>device.name===s.microphone)?s.microphone:''):stereo;
 const reason=!s.ready?'입력 장치를 확인하고 있습니다.':s.busy?'현재 작업을 마치면 다시 시작할 수 있습니다.':input!=='file'&&!selected?(input==='microphone'?'녹음 옵션에서 사용 가능한 마이크를 선택하세요.':'PC 소리 입력(Stereo Mix)을 찾을 수 없습니다. 녹음 옵션의 장치 도움말을 확인하세요.'):input==='youtube'&&!s.videoEmbedUrl?'영상 링크를 불러온 뒤 녹음을 시작하세요.':!s.consent?'녹음·처리 권한을 확인해 주세요.':'';
 const start=()=>{if(reason)return;if(input==='file')void s.importAudio();else if(input==='youtube')void s.startVideo();else if(selected)void s.start(selected,input==='pc'?'PC 소리 녹음 중입니다. 다른 영상과 알림 소리를 꺼 주세요.':'마이크 녹음 중입니다. 아래 대화에서 받아쓰기를 확인하세요.');};
 return <section className={layout.toolbar} aria-label="녹음 입력과 시작">
  <div className={layout.mainRow}><fieldset disabled={s.busy} className={layout.sources}><legend>기록할 소리</legend>{sources.map(source=><label key={source.id} data-selected={input===source.id}><input type="radio" name="record-source" checked={input===source.id} onChange={()=>onInputChange(source.id)}/><source.icon size={18} aria-hidden="true"/>{source.label}</label>)}</fieldset>
   <div className={layout.capture}>{s.hasRecordingStart&&<span className={layout.timer}>{Math.floor(s.elapsed/60).toString().padStart(2,'0')}:{Math.floor(s.elapsed%60).toString().padStart(2,'0')}</span>}{s.mode==='recording'?<button className={styles.primary} onClick={()=>void s.stop()}><Square size={18} aria-hidden="true"/>중지 및 저장</button>:<button className={styles.primary} disabled={Boolean(reason)} aria-describedby="record-start-help" onClick={start}>{input==='file'?<Upload size={18} aria-hidden="true"/>:<Mic size={18} aria-hidden="true"/>}{s.mode==='starting'?'모델 준비 중…':s.mode==='stopping'?'마지막 문장 저장 중…':input==='file'?'파일 선택':'녹음 시작'}</button>}</div>
  </div>
  <div className={layout.optionsRow}><label className={styles.check}><input type="checkbox" checked={s.consent} disabled={s.busy} onChange={event=>s.setConsent(event.target.checked)}/>참여자에게 녹음을 알렸으며 녹음·처리 권한을 확인했습니다.</label><button className={layout.optionsButton} aria-expanded={optionsOpen} aria-controls="record-options" onClick={()=>setOptionsOpen(value=>!value)}><Settings2 size={18} aria-hidden="true"/>녹음 옵션</button></div><div id="record-options" hidden={!optionsOpen} className={layout.optionsBody}>
   {input==='microphone'&&<label>마이크 입력<select value={selected} disabled={s.busy} onChange={event=>s.setMicrophone(event.target.value)}><option value="">마이크를 선택하세요</option>{microphones.map(device=><option key={device.name} value={device.name}>{device.name}</option>)}</select></label>}
   {(input==='pc'||input==='youtube')&&<p>입력: {stereo||'Stereo Mix 없음'}. 컴퓨터에서 재생되는 다른 영상과 알림 소리도 함께 녹음됩니다.</p>}
   <label>인식에 참고할 용어<input value={s.glossary} maxLength={500} disabled={s.busy} onChange={event=>s.setGlossary(event.target.value)} placeholder="사람 이름 · 기관명 · 전문 용어"/></label><GlossaryPicker session={s}/><p className={styles.hint}>{s.modelStatus}</p>
   <details className={styles.disclosure}><summary>입력 장치 도움말</summary><p>Windows 설정 → 시스템 → 소리에서 입력 장치와 마이크 권한을 확인하세요. PC 소리는 더 많은 소리 설정 → 녹음에서 스테레오 믹스를 사용으로 설정하세요. 지원하지 않는 PC는 음성 파일을 이용하세요.</p></details><button disabled={s.busy} onClick={()=>void s.refreshDevices().catch(error=>s.setError(s.messageOf(error)))}>장치 새로고침</button>
  </div>
  <p id="record-start-help" className={styles.hint}>{reason||(input==='file'?'기존 음성 파일을 선택하면 이 PC에서 전사합니다.':input==='youtube'?'녹음 시작 → 영상 재생 → 중지 및 저장 순서로 진행하세요.':'입력: '+selected+' · 한국어 모델 포함 · 이 PC에서 전사합니다.')}</p>
 </section>;
}

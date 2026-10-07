'use client';
import {Mic,MonitorPlay,Square,Upload,Settings2} from 'lucide-react';
import {RefreshIcon} from '../jeju/jeju-icons';
import {stereoMixName,microphoneInputs} from '../meeting-ko/core';
import {glossaryCharacterLimit} from '../meeting-ko/glossary';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';
import guide from './guidance.module.css';
import layout from './dictation.module.css';
import {GlossaryPicker} from './GlossaryPicker';

export function RecordingPreparation({session:s}:{readonly session:MeetingSession}) {
  const kind=s.recordingKind;
  const stereo=stereoMixName(s.devices);
  const inputs=microphoneInputs(s.devices);
  const mic=inputs.some(input=>input.name===s.microphone)?s.microphone:inputs[0]?.name??'';
  const selected=kind==='microphone'?mic:stereo;
  const reason=!s.ready?'입력 장치를 확인하고 있습니다.':s.busy?'현재 작업을 마치면 다시 시작할 수 있습니다.':!selected?(kind==='microphone'?'마이크를 연결한 뒤 장치를 새로고침하세요.':'PC 소리 입력이 없습니다. 아래 도움말을 확인하세요.'):!s.consent?'녹음 동의 항목을 확인해 주세요.':'';
  return <section className={`${styles.panel} ${layout.preparation}`} aria-label="회의 녹음 준비">
    <div className={layout.toolbar}>
      <div className={layout.recordState}><h2>어떤 소리를 기록할까요?</h2><span className={styles.badge}>{kind==='pc'?'PC 소리':'마이크'}</span></div>
      <details className={layout.options}><summary><Settings2 size={18} aria-hidden="true"/>녹음 옵션</summary><div className={styles.viewStack}>
    <fieldset disabled={s.busy} className={styles.sourceChoices}><legend>1. 녹음할 소리 선택</legend>{([
      {id:'microphone',title:'마이크',detail:'회의실 대화 · 내 목소리',icon:Mic},
      {id:'pc',title:'PC 소리',detail:'영상 · 온라인 회의',icon:MonitorPlay},
    ] as const).map(item=><label key={item.id} className={kind===item.id?styles.sourceSelected:styles.sourceChoice}>
      <input type="radio" name="recording-kind" value={item.id} checked={kind===item.id} onChange={()=>s.setRecordingKind(item.id)}/><item.icon size={23} aria-hidden="true"/><span><strong>{item.title}</strong><small>{item.detail}</small></span>
    </label>)}</fieldset>
    <label>입력 장치<select value={selected} disabled={s.busy||kind!=='microphone'} onChange={event=>s.setMicrophone(event.target.value)} aria-describedby="input-help"><option value="">사용 가능한 입력 없음</option>{(kind==='microphone'?inputs:s.devices.filter(input=>input.name===stereo)).map(input=><option key={input.name} value={input.name}>{input.name}</option>)}</select></label>
    <p id="input-help" className={styles.hint}>{kind==='microphone'?'선택한 마이크의 소리를 녹음합니다.':'Stereo Mix는 컴퓨터에서 재생되는 모든 소리를 녹음합니다. 다른 영상과 알림 소리를 꺼 주세요.'}</p>
    
    <details className={styles.disclosure}><summary>회의 제목·전문 용어 설정</summary><label>회의 제목<input value={s.title} maxLength={100} disabled={s.busy} onChange={event=>s.setTitle(event.target.value)}/></label><label>AI 보정에 참고할 용어<input value={s.glossary} maxLength={glossaryCharacterLimit} disabled={s.busy} placeholder="예: 제주가치돌봄, 메가프로젝트" onChange={event=>s.setGlossary(event.target.value)}/></label><p className={styles.hint}>사람 이름·기관명·전문 용어는 AI 보정에만 참고합니다. 받아쓰기 원문에는 사용하지 않습니다. 결과는 원음과 대조해 주세요.</p><GlossaryPicker session={s}/><p className={styles.hint}>{s.modelStatus}</p></details>
    <details className={styles.disclosure} open={!selected&&s.ready}><summary>소리가 없거나 장치를 찾지 못하나요?</summary><p className={styles.hint}>{kind==='pc'?'Windows 설정 → 시스템 → 소리 → 더 많은 소리 설정 → 녹음에서 스테레오 믹스를 사용으로 바꿔 주세요. 지원하지 않는 PC에서는 마이크나 녹음파일을 사용하세요.':'Windows 소리 설정에서 마이크 권한과 입력 음량을 확인해 주세요.'}</p><button disabled={s.busy} onClick={()=>void s.refreshDevices().catch(error=>s.setError(s.messageOf(error)))}><RefreshIcon/>장치 새로고침</button></details>
    <div className={guide.importChoice}><p>이미 녹음한 파일이 있나요?</p><button disabled={!s.ready||s.busy||!s.consent} onClick={()=>void s.importAudio()}><Upload size={18} aria-hidden="true"/>녹음파일 첨부</button><small>녹음·처리 권한을 확인한 뒤 파일을 선택하세요.</small></div>
      </div></details>
    <div className={styles.actions}>{s.mode==='recording'?<button className={styles.primary} onClick={()=>void s.stop()}><Square size={20} aria-hidden="true"/>녹음을 중지하고 저장</button>:<button className={styles.primary} disabled={Boolean(reason)} aria-describedby="start-help" onClick={()=>{if(selected)void s.start(selected,kind==='pc'?'PC 소리 녹음 중입니다. 다른 영상과 알림 소리는 꺼 주세요.':'마이크 녹음 중입니다. 아래 받아쓰기에서 인식된 문장을 확인하세요.');}}><Mic size={20} aria-hidden="true"/>{s.mode==='starting'?'음성 모델 준비 중…':s.mode==='stopping'?'마지막 문장 저장 중…':'녹음 시작'}</button>}</div>
    </div>
    <label className={styles.check}><input type="checkbox" checked={s.consent} disabled={s.busy} onChange={event=>s.setConsent(event.target.checked)}/>2. 참여자에게 녹음을 알렸으며 녹음·처리 권한을 확인했습니다.</label>
    <p id="start-help" className={styles.hint}>{reason||`입력: ${selected} · 한국어 모델 포함 · 이 PC에서 받아씁니다.`}</p>
  </section>;
}

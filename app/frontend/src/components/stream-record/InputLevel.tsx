'use client';
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import styles from './studio.module.css';
import type {AudioInput} from '../meeting-ko/core';

const quietPeak = 0.005;
const percent = (peak:number) => Math.round(Math.min(1,Math.max(0,peak))*100);
function Meter({peak}:{peak:number|null}){
  return peak===null?null:<label className={styles.levelReading}>입력 음량 <meter min={0} max={100} value={percent(peak)}/> {percent(peak)}%</label>;
}

export function InputCheck({source}:{source:AudioInput}){
  const [busy,setBusy]=useState(false);
  const [peak,setPeak]=useState<number|null>(null);
  const [message,setMessage]=useState('');
  async function check(){
    setBusy(true);
    setPeak(null);
    setMessage('선택한 장치의 음량을 측정합니다.');
    try{
      const value=await invoke<number|null>('ko_check_input_level',{source});
      setPeak(value);
      setMessage(value===null?'음량을 읽지 못했습니다. 장치 연결을 확인하세요.':value<quietPeak?'소리가 감지되지 않습니다. 음소거와 장치 선택을 확인하세요.':'소리가 감지됐습니다.');
    }catch(error){setMessage('입력 장치를 확인하세요. '+String(error));}
    finally{setBusy(false);}
  }
  return <div><button disabled={busy} onClick={()=>void check()}>입력 음량 확인</button> <Meter peak={peak}/><span role="status">{message}</span></div>;
}

export function RecordingLevel({device}:{device:string}){
  const [peak,setPeak]=useState<number|null>(null);
  const [status,setStatus]=useState('');
  useEffect(()=>{
    let stopped=false;
    let timer=0;
    let lastSignal=Date.now();
    async function sample(){
      try{
        const value=await invoke<number|null>('ko_recording_peak');
        if(stopped)return;
        setPeak(value);
        if(value!==null&&value>=quietPeak)lastSignal=Date.now();
        setStatus(Date.now()-lastSignal<5000?'':value===null?'장치에서 음량을 읽지 못했습니다.':'5초 동안 소리가 감지되지 않았습니다.');
      }catch{
        if(stopped)return;
        setPeak(null);setStatus('입력 음량을 읽지 못했습니다.');
      }
      timer=window.setTimeout(()=>void sample(),250);
    }
    void sample();
    return ()=>{stopped=true;window.clearTimeout(timer);};
  },[]);
  return <div><Meter peak={peak}/><span role="status">{status}</span>{status&&<details><summary>입력 장치 확인</summary><p>{device}의 음소거와 Windows 소리 설정을 확인하세요. 장치를 바꾸려면 녹음을 저장한 뒤 새 녹음을 시작하세요.</p></details>}</div>;
}

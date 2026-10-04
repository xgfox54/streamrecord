'use client';
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import layout from './record-workspace.module.css';
export function AppVersion(){
 const [version,setVersion]=useState('');const [unavailable,setUnavailable]=useState(false);
 useEffect(()=>{let active=true;void invoke<{version:string}>('ko_app_info').then(info=>{if(active)setVersion(info.version);}).catch(()=>{if(active)setUnavailable(true);});return()=>{active=false;};},[]);
 return <span className={layout.version} aria-label="실행 중인 앱 버전" title="실행 중인 앱 버전">{version?'v'+version:unavailable?'미리보기 · 버전 확인 불가':'버전 확인 중'}</span>;
}

'use client';
import {useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

const DEFAULT_PROXY = 'http://127.0.0.1:10100/v1';

function ProxySettings({session:s}:{session:MeetingSession}){
 const [base,setBase]=useState(DEFAULT_PROXY);
 const [apiKey,setApiKey]=useState('');
 const [hasApiKey,setHasApiKey]=useState(false);
 const [saving,setSaving]=useState(false);
 useEffect(()=>{void invoke<{base:string;hasApiKey:boolean}>('ko_get_proxy_endpoint')
  .then(v=>{setBase(v.base);setHasApiKey(v.hasApiKey);})
  .catch(()=>{});},[]);
 const save=async(refresh:boolean)=>{
  setSaving(true);
  try{
   const saved=await invoke<{base:string;hasApiKey:boolean}>('ko_set_proxy_endpoint',{base,apiKey:apiKey||null});
   setBase(saved.base);setHasApiKey(saved.hasApiKey);setApiKey('');
   if(refresh){await s.refreshModels();s.setNotice('연결 주소를 저장하고 모델 목록을 다시 받았습니다. 목록 조회는 실제 요약 성공을 의미하지 않습니다.');}
   else{s.setNotice('연결 주소를 저장했습니다.');}
  }catch(error){s.setError(s.messageOf(error));}
  finally{setSaving(false);}
 };
 return <div>
  <div className={styles.formGrid}>
   <label>연결 주소
    <input value={base} onChange={e=>setBase(e.target.value)} placeholder={DEFAULT_PROXY} spellCheck={false}/>
   </label>
   <label>인증 키 (선택)
    <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={hasApiKey?'저장됨 · 변경할 때만 입력':'필요 없으면 비워 두세요'} spellCheck={false}/>
   </label>
  </div>
  <div className={styles.actions}>
   <button disabled={saving||s.busy} onClick={()=>void save(true)}>저장하고 연결 확인</button>
   <button disabled={saving||s.busy} onClick={()=>{setBase(DEFAULT_PROXY);}}>기본 주소로 되돌리기</button>
  </div>
 </div>;
}

export function AiConnectionsView({session:s}:{session:MeetingSession}){
 const local=s.models.filter(model=>model.provider==='local');const proxy=s.models.filter(model=>model.provider==='subscription');
 return <div className={styles.viewStack}><section className={styles.panel}><div className={styles.panelHead}><h2>현재 지원하는 연결</h2><button disabled={s.busy} onClick={()=>void s.refreshModels().then(()=>s.setNotice('모델 목록 조회를 마쳤습니다. 목록 조회는 인증 또는 실제 추론 성공을 의미하지 않습니다.')).catch(error=>s.setError(s.messageOf(error)))}>실제 모델 목록 새로고침</button></div><p>연결 정보와 모델 목록은 실제 서버 응답을 사용합니다. 서버 응답, 계정 인증, 추론 성공은 각각 다른 상태입니다.</p><div className={styles.connectionGrid}>
  <article className={styles.connectionCard}><span className={styles.badge}>구현된 어댑터</span><h3>Ollama</h3><p>이 PC에서 실행하는 요약 모델</p><code>http://127.0.0.1:11434</code><dl className={styles.facts}><div><dt>모델 목록</dt><dd>{local.length?`${local.length}개 응답 수신`:'모델 응답 없음 · 서버 실행/모델 설치 확인'}</dd></div><div><dt>실제 추론</dt><dd>회의록 생성 결과로 확인</dd></div></dl>{local.length>0&&<ul>{local.map(model=><li key={model.id}>{model.id}</li>)}</ul>}<p className={styles.hint}>새 요약 모델을 자동으로 다운로드하지 않습니다.</p></article>
  <article className={styles.connectionCard}><span className={styles.badge}>선택 다운로드</span><h3>내장 요약 모델</h3><p>처음 설치하면 요약 모델이 없습니다. 목록에서 원하는 로컬 모델을 골라 내려받으세요.</p><dl className={styles.facts}><div><dt>초기 상태</dt><dd>설치된 요약 모델 없음</dd></div><div><dt>선택 방법</dt><dd>설정 · 요약 모델에서 모델별 내려받기</dd></div></dl><div className={styles.actions}><a href="/settings">요약 모델 내려받기 열기</a></div><p className={styles.hint}>내려받기는 사용자가 선택할 때만 시작합니다. 요약 모델이 없어도 녹음과 한국어 전사는 그대로 동작합니다.</p></article>
  <article className={styles.connectionCard}><span className={styles.badge}>구현된 어댑터 · 선택 사용</span><h3>OpenAI 호환 엔드포인트</h3><p>OpenCodex처럼 이미 실행 중인 중계 서버에 연결합니다</p><dl className={styles.facts}><div><dt>모델 목록</dt><dd>{proxy.length?`${proxy.length}개 응답 수신`:'모델 응답 없음 · 서버 실행/주소 확인'}</dd></div><div><dt>계정 인증</dt><dd>연결한 서버가 처리합니다</dd></div><div><dt>실제 추론</dt><dd>회의록 생성 결과로 확인</dd></div></dl>{proxy.length>0&&<ul>{proxy.map(model=><li key={model.id}>{model.id}</li>)}</ul>}<ProxySettings session={s}/><p className={styles.hint}>이 연결은 선택 사항입니다. 서버가 없어도 앱의 녹음·전사와 로컬 요약 모델은 그대로 동작합니다. 연결한 서버가 외부로 중계할 수 있으므로 회의 내용이 어디로 전송되는지 확인하세요.</p></article>
 </div><a className={styles.textLink} href="#minutes" onClick={()=>s.navigate('minutes')}>회의록에서 모델 선택하기 →</a></section>
 <section className={styles.panel}><h2>구독 계정 직접 로그인은 제공하지 않습니다</h2><p>ChatGPT·Claude·Antigravity는 개인 구독을 다른 프로그램에 넘겨주는 공식 연결을 제공하지 않습니다. 대신 아래 두 가지로 같은 목적을 달성할 수 있습니다.</p><div className={styles.plannedList}>{[{name:'공식 API 키 사용',detail:'각 서비스에서 발급한 API 키를 위 연결 주소와 함께 입력하면 계정으로 요약할 수 있습니다. API 요금은 개인 구독료와 별개로 청구됩니다.'},{name:'이미 실행 중인 중계 서버 사용',detail:'OpenCodex처럼 여러 모델을 한 주소로 모아 주는 서버가 있다면 그 주소를 입력하세요. 그 서버에 연결해 둔 모델이 위 목록에 그대로 나타납니다.'}].map(item=><article key={item.name}><div><h3>{item.name}</h3><p>{item.detail}</p></div><span className={styles.badge}>사용 가능</span></article>)}</div><p className={styles.hint}>한국어 전사용 Whisper 모델은 설치본에 포함되어 있어 따로 내려받지 않습니다. 음성 모델 상태는 설정에서 확인하세요.</p></section></div>;
}

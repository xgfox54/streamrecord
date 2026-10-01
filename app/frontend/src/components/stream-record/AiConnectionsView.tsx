'use client';
import {useState} from 'react';
import type {MeetingSession} from './useMeetingSession';
import {ChatGptConnection} from './connections/ChatGptConnection';
import {ConnectionProfiles} from './connections/ConnectionProfiles';
import {modelDestination} from './connections/modelPresentation';
import styles from '../meeting-ko/workspace.module.css';

export function AiConnectionsView({session:s}:{readonly session:MeetingSession}){
 const [refreshing,setRefreshing]=useState(false);
 const local=s.models.filter(model=>model.provider==='local');
 const builtin=s.models.filter(model=>model.provider==='builtin');
 const refresh=async()=>{setRefreshing(true);try{await s.refreshModels();s.setNotice('모델 목록을 새로 받았습니다. 실제 추론은 요약 또는 시험 요청으로 확인하세요.');}catch(reason){s.setError(s.messageOf(reason));}finally{setRefreshing(false);}};
 return <div className={styles.viewStack}>
  <section className={styles.panel}>
   <div className={styles.panelHead}><h2>요약에 사용할 AI 연결</h2><button disabled={refreshing} onClick={()=>void refresh()}>{refreshing?'모델 조회 중':'모델 목록 새로고침'}</button></div>
   <p>이 PC의 모델, ChatGPT 계정, 서버·API 중에서 선택하세요. AI 연결은 선택 사항이며 녹음과 한국어 받아쓰기는 연결 없이도 동작합니다.</p>
   <a className={styles.textLink} href="#minutes" onClick={()=>s.navigate('minutes')}>연결한 모델로 회의록 만들기 →</a>
  </section>
  <section className={styles.panel} aria-label="로컬 모델과 계정 연결"><h2>로컬 모델과 ChatGPT 계정</h2><div className={styles.connectionGrid}>
   <article className={styles.connectionCard}><span className={styles.badge}>선택 다운로드</span><h3>내장 요약 모델</h3><p>원하는 모델을 선택해 이 PC에 내려받습니다. 최초 설치에서는 요약 모델을 자동으로 받지 않습니다.</p>
    <dl className={styles.facts}><div><dt>사용 가능 모델</dt><dd>{builtin.length?`${builtin.length}개 · 실제 모델 목록 기준`:'조회된 내장 모델 없음'}</dd></div><div><dt>전송 위치</dt><dd>이 PC의 내장 요약 엔진</dd></div></dl>
    {builtin.length>0&&<ul>{builtin.map(model=><li key={s.modelKey(model)}>{model.id}</li>)}</ul>}
    <div className={styles.actions}><a href="/settings">요약 모델 다운로드·상태 확인</a></div><p className={styles.hint}>다운로드가 완료되고 모델이 준비되면 회의록·실시간 요약·AI 보정에서 선택할 수 있습니다.</p>
   </article>
   <article className={styles.connectionCard}><span className={styles.badge}>로컬 서버</span><h3>Ollama</h3><p>이 PC에서 실행 중인 Ollama의 모델을 사용합니다.</p>
    <dl className={styles.facts}><div><dt>모델 목록</dt><dd>{local.length?`${local.length}개 응답 수신`:'모델 응답 없음 · 서버 실행과 모델 설치 확인'}</dd></div><div><dt>전송 위치</dt><dd>{local[0]?modelDestination(local[0]):'모델 목록을 받은 뒤 연결 주소를 표시합니다.'}</dd></div><div><dt>실제 추론</dt><dd>요약 실행 결과로 확인</dd></div></dl>
    {local.length>0&&<ul>{local.map(model=><li key={s.modelKey(model)}>{model.id}</li>)}</ul>}<p className={styles.hint}>새 모델은 사용자가 Ollama에서 선택해 설치합니다.</p>
   </article>
   <ChatGptConnection session={s}/>
  </div></section>
  <ConnectionProfiles session={s}/>
 </div>;
}

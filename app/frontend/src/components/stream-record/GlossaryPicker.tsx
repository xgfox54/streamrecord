'use client';
import {useId,useState} from 'react';
import pack from '../../../../../assets/glossary/jeju-council-candidates.json';
import {glossaryPacks,glossaryPackSource} from './glossary-packs';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

export function appendGlossaryTerms(manual:string,terms:readonly string[],budget=500){
 let text=manual;
 const existing=new Set(manual.split(/[,;\n]/).map(item=>item.trim()).filter(Boolean));
 const omitted:string[]=[];
 for(const term of new Set(terms.map(item=>item.trim()).filter(Boolean))){
  if(existing.has(term))continue;
  const next=text?`${text}, ${term}`:term;
  if(next.length>budget){omitted.push(term);continue;}
  text=next;existing.add(term);
 }
 return {text,omitted};
}

export function GlossaryPicker({session}:{readonly session:MeetingSession}){
 return <RecordGlossaryPicker key={session.activeRecordId} session={session}/>;
}

function RecordGlossaryPicker({session:s}:{readonly session:MeetingSession}){
 const [selectedSets,setSelectedSets]=useState<string[]>([]);
 const [selectedTerms,setSelectedTerms]=useState<string[]>([]);
 const [message,setMessage]=useState('');
 const previewId=useId();
 const chosenSets=glossaryPacks.filter(item=>selectedSets.includes(item.id));
 const selected=[...new Set([...chosenSets.flatMap(item=>[...item.terms]),...selectedTerms])];
 const preview=appendGlossaryTerms(s.glossary,selected);
 const append=()=>{
  if(s.busy||!selected.length)return;
  s.setGlossary(preview.text);
  setMessage(preview.omitted.length?`500자 한도로 ${preview.omitted.length}개를 추가하지 못했습니다: ${preview.omitted.join(', ')}`:'선택한 용어를 기존 입력 뒤에 추가했습니다. 이미 입력한 용어는 다시 추가하지 않습니다.');
  setSelectedSets([]);
  setSelectedTerms(preview.omitted);
 };
 return <details className={styles.disclosure}>
  <summary>회의 주제별 용어 세트</summary>
  <p className={styles.hint}>회의 주제를 여러 개 선택하고 용어를 확인한 뒤 추가하세요. 기존 입력은 그대로 유지하며, 체크만으로 적용되지 않습니다.</p>
  <fieldset disabled={s.busy}><legend>참고할 회의 주제</legend><div className={styles.formGrid}>
   {glossaryPacks.map(item=><label className={styles.check} key={item.id} title={item.scope}>
    <input type="checkbox" value={item.id} checked={selectedSets.includes(item.id)} onChange={event=>{setSelectedSets(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id));setMessage('');}}/>
    {item.label} ({item.terms.length}개)
   </label>)}
  </div></fieldset>
  <details className={styles.disclosure}>
   <summary>세트별 용어 미리보기</summary>
   {glossaryPacks.map(item=><div key={item.id}><strong>{item.label} · {item.scope}</strong><p className={styles.hint}>{item.terms.join(', ')}</p></div>)}
  </details>
  <details className={styles.disclosure}>
   <summary>개별 용어 추가 선택 (기존 후보·미검수)</summary>
   <fieldset disabled={s.busy}><legend>개별 용어 선택</legend><div className={styles.formGrid}>
    {[...new Set([...pack.terms.map(item=>item.term),...selectedTerms])].map(term=><label className={styles.check} key={term}>
     <input type="checkbox" value={term} checked={selectedTerms.includes(term)} onChange={event=>{setSelectedTerms(current=>event.target.checked?[...current,term]:current.filter(value=>value!==term));setMessage('');}}/>{term}
    </label>)}
   </div></fieldset>
  </details>
  <p id={previewId} className={styles.hint}>{selected.length?`선택한 ${selected.length}개 용어 (중복 제외): ${selected.join(', ')}`:'선택한 용어가 없습니다.'}</p>
  {selected.length>0&&<p className={styles.hint}>추가 후 {preview.text.length}/500자{preview.omitted.length>0?` · 한도 초과로 제외될 용어: ${preview.omitted.join(', ')}`:''}</p>}
  <div className={styles.actions}>
   <button type="button" data-action="append-glossary" aria-describedby={previewId} disabled={s.busy||!selected.length} onClick={append}>선택한 {selected.length}개 용어 추가</button>
   <button type="button" disabled={s.busy||!selected.length} onClick={()=>{setSelectedSets([]);setSelectedTerms([]);setMessage('');}}>선택 해제</button>
  </div>
  {message&&<p role="status" className={styles.hint}>{message}</p>}
  <p className={styles.hint}>출처: <a href={glossaryPackSource.url} target="_blank" rel="noreferrer">{glossaryPackSource.title} (새 창)</a>. 이 회의의 안건을 주제별로 직접 분류한 초안이며, 전체 회의록 자동 분석 결과가 아닙니다. 전문 검수와 음성 인식 효과 평가는 미완료입니다.</p>
 </details>;
}

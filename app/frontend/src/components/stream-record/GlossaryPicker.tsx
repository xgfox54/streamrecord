'use client';
import {useState} from 'react';
import pack from '../../../../../assets/glossary/jeju-council-candidates.json';
import type {MeetingSession} from './useMeetingSession';
import styles from '../meeting-ko/workspace.module.css';

export function appendGlossaryTerms(manual:string,terms:readonly string[],budget=500){
 let text=manual;
 const existing=new Set(manual.split(/[,;\n]/).map(item=>item.trim()).filter(Boolean));
 const omitted:string[]=[];
 for(const term of terms){
  if(existing.has(term))continue;
  const next=text?`${text}, ${term}`:term;
  if(next.length>budget){omitted.push(term);continue;}
  text=next;existing.add(term);
 }
 return {text,omitted};
}

export function GlossaryPicker({session:s}:{readonly session:MeetingSession}){
 const [selected,setSelected]=useState<string[]>([]);
 const [message,setMessage]=useState('');
 const append=()=>{
  const result=appendGlossaryTerms(s.glossary,selected);
  s.setGlossary(result.text);
  setMessage(result.omitted.length?`500자 한도로 ${result.omitted.length}개를 추가하지 못했습니다: ${result.omitted.join(', ')}`:'선택한 용어를 기존 입력 뒤에 추가했습니다. 중복 용어는 한 번만 유지합니다.');
  setSelected(result.omitted);
 };
 return <details className={styles.disclosure}>
  <summary>제주도의회 용어 후보 (미검수)</summary>
  <p className={styles.hint}>공식 회의록에서 수집한 후보입니다. 사람의 용어 검수와 음성 인식 효과 평가는 아직 완료되지 않았습니다. 필요한 용어만 골라 추가하세요.</p>
  <fieldset disabled={s.busy}><legend>참고할 용어 선택</legend><div className={styles.formGrid}>{pack.terms.map(item=><label className={styles.check} key={item.id}><input type="checkbox" checked={selected.includes(item.term)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.term]:current.filter(term=>term!==item.term))}/>{item.term}</label>)}</div></fieldset>
  <div className={styles.actions}><button disabled={s.busy||!selected.length} onClick={append}>선택한 {selected.length}개 용어 추가</button></div>
  {message&&<p role="status" className={styles.hint}>{message}</p>}
  <p className={styles.hint}>출처: <a href={pack.terms[0]?.sourceUrl} target="_blank" rel="noreferrer">{pack.sourceTitle} (새 창)</a> · 기존에 입력한 용어는 지우지 않습니다.</p>
 </details>;
}

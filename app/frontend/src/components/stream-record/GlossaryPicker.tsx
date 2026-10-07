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

/** Takes terms from each selected set in turn, so every set's leading, most often misheard terms fit in 500 characters. */
export function interleaveTerms(lists:readonly (readonly string[])[]):string[]{
 const out:string[]=[];const longest=Math.max(0,...lists.map(list=>list.length));
 for(let i=0;i<longest;i++)for(const list of lists)if(i<list.length)out.push(list[i]);
 return out;
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
 const selected=[...new Set([...interleaveTerms(chosenSets.map(item=>item.terms)),...selectedTerms])];
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
  {s.autoGlossary&&<label className={styles.check}><input type="checkbox" checked={s.autoGlossary.enabled} onChange={event=>s.autoGlossary.setEnabled(event.target.checked)}/>회의 내용에 맞는 용어 세트 자동 선택</label>}
  <p className={styles.hint}>자동 선택을 켜 두면 녹음을 시작할 때 회의 제목을, 약 1분 뒤에는 받아쓴 내용을 보고 맞는 세트를 1~2개 골라 넣습니다. 직접 입력한 용어는 그대로 앞에 두고, 녹음 한 번에 한 번만 바꿉니다. 저장된 기록을 열 때는 바꾸지 않습니다.</p>
  <p className={styles.hint}>한 기록에는 500자(약 60~70단어)까지 넣을 수 있습니다. 앞 300자는 받아쓰기 인식에 바로 쓰이고, 500자 전체는 AI 보정에 참고됩니다. 세트 하나가 약 300자이므로 회의 성격에 맞는 세트를 1~2개 고르세요. 여러 세트를 고르면 각 세트에서 자주 틀리는 앞쪽 용어부터 번갈아 넣습니다.</p>
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
  <p className={styles.hint}>11개 주제 500개 용어입니다. <a href={glossaryPackSource.url} target="_blank" rel="noreferrer">{glossaryPackSource.title} (새 창)</a> 안건, 약 5시간 실제 회의 녹음에서 AI 보정으로 바로잡힌 오인식 단어(질의, 서귀포, 읍면동 등), 지방의회 회의 공통 용어로 구성했습니다. 인물 이름은 직책이 바뀌면 직접 고쳐 입력하세요. 전문 검수와 받아쓰기 효과 측정은 아직 하지 않았습니다.</p>
 </details>;
}

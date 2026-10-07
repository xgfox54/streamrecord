'use client';
import {useEffect,useRef,useState} from 'react';
import {glossaryLimitLabel} from '../meeting-ko/glossary';
import type {TranscriptRow} from '../meeting-ko/core';
import {correctedText} from '../meeting-ko/transcript-correction';
import {appendGlossaryTerms,interleaveTerms} from './GlossaryPicker';
import {glossaryPacks} from './glossary-packs';
import {chooseGlossaryPacks,choosePacksFromTitle} from './glossary-auto';
import {useStoredFlag} from './useStoredFlag';

type Input={readonly rows:TranscriptRow[];readonly mode:string;readonly epoch:number;readonly title:string;readonly videoTitle:string;readonly glossary:string;readonly setGlossary:(value:string)=>void;readonly notice:(text:string)=>void};
// Characters of confirmed speech (spaces removed), roughly 30 seconds, 2 minutes and 5 minutes of talk.
// The first clear match supplies AI correction with reference terms; the last is a final topic review.
export const autoGlossaryThresholds=[300,1000,2500] as const;
const capturing=new Set(['recording','stopping','importing']);
const spokenText=(rows:readonly TranscriptRow[])=>rows.filter(row=>!row.is_partial).map(row=>[row.text,correctedText(row),row.reviewed_text].filter(Boolean).join(' ')).join('\n');
const sameSets=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every(id=>b.includes(id));
type State={epoch:number;titleKey:string|null;titleIds:string[];titleWords:string[];contentIds:string[];base:string|null;step:number;done:boolean};
const fresh=(epoch:number):State=>({epoch,titleKey:null,titleIds:[],titleWords:[],contentIds:[],base:null,step:0,done:false});
// Automatic words belong to one meeting. The last automatic list and the words it was built on are kept,
// including across restarts, so the next recording starts again from the user's own words.
const carryKey='stream-record.auto-glossary.last';
type Carry={applied:string;base:string};
const readCarry=():Carry|null=>{try{const v=JSON.parse(window.localStorage.getItem(carryKey)??'null');return v&&typeof v.applied==='string'&&typeof v.base==='string'?v:null;}catch{return null;}};
const writeCarry=(value:Carry)=>{try{window.localStorage.setItem(carryKey,JSON.stringify(value));}catch{/* Storage unavailable: reset only within this run. */}};

/**
 * Adds the word sets that match the meeting, at most twice per recording: from the meeting or video title, or the first clear
 * minute of speech, then once more after about five minutes if the topic turned out differently.
 * The list is rebuilt from the words that were there before, so automatic additions never pile up.
 * Saved records that are only opened are never changed, because a word list change makes
 * AI correction and the live summary redo their work.
 */
export function useAutoGlossary(input:Input){
 const [enabled,setEnabled]=useStoredFlag('auto-glossary',true);
 const [result,setResult]=useState<{epoch:number;labels:string[];message:string}|null>(null);
 const state=useRef<State>(fresh(input.epoch));
 const carry=useRef<Carry|null>(null);
 if(state.current.epoch!==input.epoch)state.current=fresh(input.epoch);
 useEffect(()=>{
  if(!enabled||!capturing.has(input.mode))return;
  const current=state.current;
  let glossary=input.glossary;
  if(current.base===null){
   carry.current??=readCarry();
   // Untouched automatic words from the previous meeting: start this one from the words they were added to.
   if(carry.current&&carry.current.applied===glossary&&carry.current.base!==glossary){glossary=carry.current.base;input.setGlossary(glossary);}
   current.base=glossary;
  }
  const rebuild=(basis:string)=>{
   const packs=[...new Set([...current.titleIds,...current.contentIds])].slice(0,2).flatMap(id=>glossaryPacks.filter(pack=>pack.id===id));
   if(!packs.length)return;
   // Set words that appear in the title itself, such as the committee name, go first.
   const next=appendGlossaryTerms(current.base??glossary,[...current.titleWords,...interleaveTerms(packs.map(pack=>pack.terms))]).text;
   const names=packs.map(pack=>`‘${pack.label}’`).join(', ');
   const message=next===glossary?`${basis} ${names} 용어 세트가 맞지만 이미 들어 있거나 ${glossaryLimitLabel}자 한도가 차서 더 넣지 않았습니다.`:`${basis} ${names} 용어 세트를 AI 보정 참고용으로 자동으로 넣었습니다. 받아쓰기 원문에는 사용하지 않습니다.`;
   if(next!==glossary){input.setGlossary(next);glossary=next;carry.current={applied:next,base:current.base??''};writeCarry(carry.current);}
   setResult({epoch:current.epoch,labels:packs.map(pack=>pack.label),message});input.notice(message);
  };
  // The video title can arrive a moment after recording starts; it still counts until the speech decides.
  const titleKey=`${input.title}\n${input.videoTitle}`;
  if(input.mode==='recording'&&current.titleKey!==titleKey&&!current.contentIds.length){
   current.titleKey=titleKey;const picks=choosePacksFromTitle(`${input.title} ${input.videoTitle}`);const ids=picks.map(pack=>pack.id);
   if(ids.length&&!sameSets(ids,current.titleIds)){current.titleIds=ids;current.titleWords=picks.flatMap(pack=>[...pack.hits]);rebuild(input.videoTitle&&choosePacksFromTitle(input.videoTitle).length?'영상 제목을 보고':'회의 제목을 보고');}
  }
  if(current.done)return;
  const text=spokenText(input.rows);const length=Array.from(text.replace(/\s+/g,'')).length;
  if(length<autoGlossaryThresholds[current.step])return;
  while(current.step<autoGlossaryThresholds.length&&length>=autoGlossaryThresholds[current.step])current.step++;
  const final=current.step>=autoGlossaryThresholds.length;if(final)current.done=true;
  const picks=chooseGlossaryPacks(text).map(pack=>pack.id);
  if(!current.contentIds.length){
   if(picks.length){current.contentIds=picks;rebuild('회의 내용을 보고');}
   else if(final&&!current.titleIds.length)setResult({epoch:current.epoch,labels:[],message:'회의 내용과 뚜렷하게 맞는 용어 세트가 없어 자동으로 넣지 않았습니다.'});
   return;
  }
  if(final&&picks.length&&!sameSets(picks,current.contentIds)){current.contentIds=picks;rebuild('회의 내용을 더 듣고');}
 // Runs as rows arrive; the ref limits it to the decisions above for each recording.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,input.mode,input.rows,input.epoch,input.title,input.videoTitle]);
 const current=result&&result.epoch===input.epoch?result:null;
 return {enabled,setEnabled,message:current?.message??'',labels:current?.labels??[]};
}

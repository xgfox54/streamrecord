'use client';
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {readRows,rowTime,type TranscriptRow} from '../meeting-ko/core';
import {correctedText} from '../meeting-ko/transcript-correction';
import {playbackRange} from '../meeting-ko/review-core';
import type {RecordSummary} from './useRecordHistory';

export type Hit={index:number;text:string;excerpt:string;time:string;playable:boolean};
const empty:ReadonlyMap<string,Hit[]>=new Map();

function findHits(rows:readonly TranscriptRow[],query:string):Hit[]{
  return rows.flatMap((row,index)=>{
    if(row.is_partial)return [];
    const text=[row.reviewed_text,correctedText(row),row.text].find(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(query));
    if(typeof text!=='string')return [];
    const start=Math.max(0,text.toLocaleLowerCase().indexOf(query)-30);
    const end=Math.min(text.length,start+Math.max(query.length+30,100));
    return [{index,text:row.text,excerpt:(start?'…':'')+text.slice(start,end)+(end<text.length?'…':''),time:rowTime(row),playable:Boolean(playbackRange(row,Number.MAX_VALUE,rows[index+1]))}];
  });
}

export function useBodySearch(records:readonly RecordSummary[],query:string,activeId:string,currentRows:readonly TranscriptRow[]){
  const [result,setResult]=useState<{records:readonly RecordSummary[];query:string;hits:Map<string,Hit[]>;errors:number;rows:readonly TranscriptRow[];activeId:string}|null>(null);
  useEffect(()=>{
    if(!query)return;
    let cancelled=false;
    const timer=window.setTimeout(async()=>{
      const hits=new Map<string,Hit[]>();
      let errors=0;
      for(const record of records){
        if(cancelled)return;
        if(!record.rowCount&&record.id!==activeId)continue;
        try{
          const rows=record.id===activeId?currentRows:readRows((await invoke<{rows:unknown}>('ko_load_record',{id:record.id})).rows);
          const matches=findHits(rows,query);
          if(matches.length)hits.set(record.id,matches);
        }catch{errors++;}
      }
      if(!cancelled)setResult({records,query,hits,errors,rows:currentRows,activeId});
    },300);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[records,query,activeId,currentRows]);
  const current=query&&result?.query===query&&result.records===records&&result.rows===currentRows&&result.activeId===activeId?result:null;
  return {hits:current?.hits??empty,busy:Boolean(query&&!current),errors:current?.errors??0};
}

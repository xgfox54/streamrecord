import {z} from 'zod';
import type {TranscriptRow} from './core';
import {diarizationSchema} from './speakers';

export const liveDiarizationSchema=diarizationSchema.omit({audioSha256:true}).extend({
 checkpointIndex:z.number().int().nonnegative(),
 windowStartSeconds:z.number().finite().nonnegative(),
 windowEndSeconds:z.number().finite().positive(),
}).refine(v=>v.windowEndSeconds>v.windowStartSeconds);
export type LiveWindow=z.infer<typeof liveDiarizationSchema>;

type GlobalSegment={start:number;end:number;speaker:number};
export type LiveSpeakerState={checkpointIndex:number;windowStartSeconds:number;windowEndSeconds:number;modelId:string;segments:GlobalSegment[];nextSpeaker:number};

export function applyLiveSpeakerState(rows:readonly TranscriptRow[],state:LiveSpeakerState,coveredStart=state.windowStartSeconds):TranscriptRow[]{
 return rows.map((row,index)=>{
  const start=row.audio_start_time??row.chunk_start_time;
  const end=row.audio_end_time??rows[index+1]?.audio_start_time??rows[index+1]?.chunk_start_time;
  if(row.is_partial||typeof start!=='number'||typeof end!=='number'||end<=start||start<coveredStart||end>state.windowEndSeconds+.1)return row;
  const speakers=[...new Set(state.segments.filter(s=>Math.min(s.end,end)>Math.max(s.start,start)).map(s=>s.speaker))].sort((a,b)=>a-b);
  if(!speakers.length)return row;
  const prior=row.speaker_assignment as {provisional?:boolean;sourceText?:string;speakers?:number[]}|undefined;
  if(prior&&!prior.provisional)return row;
  if(prior?.provisional&&prior.sourceText===row.text&&JSON.stringify(prior.speakers)===JSON.stringify(speakers))return row;
  return {...row,speaker_assignment:{sourceText:row.text,audioSha256:'0'.repeat(64),modelId:state.modelId,speakers,provisional:true}};
 });
}

/** A two-checkpoint window overlaps its predecessor. Match local IDs by actual
 * speech overlap, then label new voices provisionally. No transcript text is edited. */
export function mergeLiveSpeakers(rows:readonly TranscriptRow[],input:unknown,previous:LiveSpeakerState|null):
 {rows:TranscriptRow[];state:LiveSpeakerState}{
 const window=liveDiarizationSchema.parse(input);
 if(previous&&window.checkpointIndex<=previous.checkpointIndex)return {rows:[...rows],state:previous};
 if(window.segments.some(s=>s.start<window.windowStartSeconds-.1||s.end>window.windowEndSeconds+.1))throw new Error('Live speaker times exceed the checkpoint window');
 const overlapEnd=previous?Math.min(previous.windowEndSeconds,window.windowEndSeconds):window.windowStartSeconds;
 const weights=new Map<string,number>();
 if(previous)for(const current of window.segments)for(const old of previous.segments){
  const overlap=Math.max(0,Math.min(current.end,old.end,overlapEnd)-Math.max(current.start,old.start,window.windowStartSeconds));
  if(overlap>0){const key=`${current.speaker}:${old.speaker}`;weights.set(key,(weights.get(key)??0)+overlap);}
 }
 const mapping=new Map<number,number>();const claimed=new Set<number>();
 for(const [key] of [...weights].sort((a,b)=>b[1]-a[1])){
  const [local,global]=key.split(':').map(Number);
  if(!mapping.has(local)&&!claimed.has(global)){mapping.set(local,global);claimed.add(global);}
 }
 let nextSpeaker=previous?.nextSpeaker??1;
 for(const local of [...new Set(window.segments.map(s=>s.speaker))].sort((a,b)=>a-b)){
  if(!mapping.has(local)&&nextSpeaker<=8)mapping.set(local,nextSpeaker++);
 }
 const segments=window.segments.flatMap(s=>{
  const speaker=mapping.get(s.speaker);
  return speaker?[{start:s.start,end:s.end,speaker}]:[];
 });
 const coveredStart=previous&&overlapEnd>window.windowStartSeconds?overlapEnd:window.windowStartSeconds;
 const state={checkpointIndex:window.checkpointIndex,windowStartSeconds:window.windowStartSeconds,windowEndSeconds:window.windowEndSeconds,modelId:window.modelId,segments,nextSpeaker};
 return {rows:applyLiveSpeakerState(rows,state,coveredStart),state};
}

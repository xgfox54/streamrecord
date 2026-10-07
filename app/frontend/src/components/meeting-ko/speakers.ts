import {z} from 'zod';
import type {TranscriptRow} from './core';
const segmentSchema=z.object({start:z.number().finite().nonnegative(),end:z.number().finite().positive(),speaker:z.number().int().min(1).max(8)}).refine(segment=>segment.end>segment.start);
export const diarizationSchema=z.object({modelId:z.string(),modelRevision:z.string(),engineRevision:z.string(),audioSha256:z.string().regex(/^[a-f0-9]{64}$/),segments:z.array(segmentSchema)});
export type DiarizationResult=z.infer<typeof diarizationSchema>;
const assignmentSchema=z.object({sourceText:z.string(),audioSha256:z.string(),modelId:z.string(),speakers:z.array(z.number().int().min(1).max(8)).min(1),provisional:z.boolean().optional()});
export function speakerNumbers(row:TranscriptRow):number[]{const parsed=assignmentSchema.safeParse(row.speaker_assignment);return !row.is_partial&&parsed.success&&parsed.data.sourceText===row.text?parsed.data.speakers:[];}
export const participantName=(id:number)=>`참여자${id}`;
/** Qualifiers shown after the participant names, e.g. "(실시간 임시) · 추정". */
export function speakerNote(row:TranscriptRow):string{const ids=speakerNumbers(row);if(!ids.length)return '';const parsed=assignmentSchema.safeParse(row.speaker_assignment);return `${ids.length>1?'(구간 내 복수 참여자) ':''}${parsed.success&&parsed.data.provisional?'(실시간 임시) ':''}· 추정`;}
export function speakerLabel(row:TranscriptRow):string{const ids=speakerNumbers(row);return ids.length?`${ids.map(participantName).join(' · ')} ${speakerNote(row)}`:'';}
export function assignSpeakers(rows:readonly TranscriptRow[],input:unknown,duration:number):TranscriptRow[]{
 const result=diarizationSchema.parse(input);
 if(!Number.isFinite(duration)||duration<=0||result.segments.some(segment=>segment.end>duration+.1))throw new Error('참여자 구분 시간정보가 원음 길이와 다릅니다.');
 return rows.map((row,index)=>{
  const {speaker_assignment:previous,...original}=row;
  const start=row.audio_start_time??row.chunk_start_time;
  const next=rows[index+1]?.audio_start_time??rows[index+1]?.chunk_start_time;
  const explicitEnd=typeof row.audio_end_time==='number'?row.audio_end_time:undefined;
  const end=explicitEnd??next;
  // Without a measured end (or following boundary), assigning the rest of the file would invent a speaker.
  if(row.is_partial||typeof start!=='number'||typeof end!=='number'||start<0||end<=start||end>duration+.1)return original;
  const speakers=[...new Set(result.segments.filter(segment=>Math.min(segment.end,end)>Math.max(segment.start,start)).map(segment=>segment.speaker))].sort((a,b)=>a-b);
  return speakers.length?{...original,speaker_assignment:{sourceText:row.text,audioSha256:result.audioSha256,modelId:result.modelId,speakers}}:original;
 });
}

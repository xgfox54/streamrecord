import {z} from 'zod';
import {rowTime,splitText,type TranscriptRow} from './core';

export type CorrectionModel={readonly id:string;readonly provider:string;readonly revision?:string};
export type CorrectionSource={readonly index:number;readonly row:TranscriptRow};
type Part={readonly id:string;readonly text:string;readonly index:number};
const answerSchema=z.object({corrections:z.array(z.object({id:z.string(),text:z.string().trim().min(1)}).strict()).min(1)}).strict();
export class CorrectionError extends Error {override name='CorrectionError';}
type IssueReason=NonNullable<TranscriptRow['ai_correction_issue']>['reason'];
export const correctionIssueMessages:Record<IssueReason,string>={numbers:'AI가 숫자를 바꾼 보정본은 적용하지 않았습니다. 원음을 확인하세요.',length:'AI 응답이 원문을 과도하게 줄이거나 늘렸습니다. 다시 시도하거나 원음을 확인하세요.'};
export function correctionIssue(row:TranscriptRow,modelKey?:string,glossary?:string){
 const issue=row.ai_correction_issue;
 return !row.is_partial&&issue?.source_text===row.text&&(modelKey===undefined||issue.model_key===modelKey)&&(glossary===undefined||issue.glossary===glossary)?issue:null;
}
function rejectedReason(source:string,text:string):IssueReason|null{
 const numbers=(value:string)=>JSON.stringify(value.match(/[0-9]+(?:[.,][0-9]+)*/g)||[]);
 if(numbers(text)!==numbers(source))return 'numbers';
 return text.length<source.trim().length*.5||text.length>source.length*2.5+40?'length':null;
}
export function correctedText(row:TranscriptRow):string|null{
 const correction=row.ai_correction;
 return !row.is_partial&&correction?.source_text===row.text?correction.text:null;
}
export function pendingCorrections(rows:readonly TranscriptRow[],modelKey:string,glossary:string):CorrectionSource[]{
 const batch:CorrectionSource[]=[];let size=0;
 for(const [index,row] of rows.entries()){
  if(row.is_partial||!row.text.trim())continue;
  if(correctionIssue(row,modelKey,glossary))continue;
  if(correctedText(row)!==null&&row.ai_correction?.model_key===modelKey&&row.ai_correction.glossary===glossary)continue;
  if(batch.length&&(batch.length>=4||size+row.text.length>1800))break;
  batch.push({index,row});size+=row.text.length;
 }
 return batch;
}
function readCorrectionParts(raw:string,parts:readonly Part[]):Map<string,string>{
 const body=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const parsed=answerSchema.safeParse(JSON.parse(body));
 if(!parsed.success)throw new CorrectionError('AI 보정 응답 형식이 올바르지 않습니다. 원문은 보존했습니다.');
 const found=new Map<string,string>();const known=new Map(parts.map(part=>[part.id,part]));
 for(const item of parsed.data.corrections){
  const source=known.get(item.id);
  if(!source||found.has(item.id))throw new CorrectionError('AI 보정 구간 ID가 누락·중복되거나 원문과 다릅니다.');
  found.set(item.id,item.text);
 }
 if(found.size!==parts.length)throw new CorrectionError('AI 응답에 일부 발언이 빠졌습니다. 원문은 보존했습니다.');
 return found;
}
export function parseCorrections(raw:string,parts:readonly Part[]):Map<string,string>{
 const found=readCorrectionParts(raw,parts);
 for(const part of parts){const reason=rejectedReason(part.text,found.get(part.id)??'');if(reason)throw new CorrectionError(correctionIssueMessages[reason]);}
 return found;
}
export async function correctTranscript(input:{readonly batch:readonly CorrectionSource[];readonly rows:readonly TranscriptRow[];readonly glossary:string;readonly modelKey:string;readonly generate:(text:string)=>Promise<string>}){
 const parts:Part[]=input.batch.flatMap(({index,row})=>splitText(row.text,900).map((text,part)=>({id:`S${String(index+1).padStart(6,'0')}${part?`p${part+1}`:''}`,text,index})));
 const corrected=new Map<string,string>();
 const rejected=new Map<number,IssueReason>();
 const context=input.rows.slice(Math.max(0,(input.batch[0]?.index??0)-2),input.batch[0]?.index??0).filter(row=>!row.is_partial).map(row=>({text:row.text.slice(-300)}));
 for(let start=0;start<parts.length;){
  const group:Part[]=[];let length=0;
  while(start<parts.length&&group.length<4){const part=parts[start];if(group.length&&length+part.text.length>1800)break;group.push(part);length+=part.text.length;start++;}
  const response=await input.generate(JSON.stringify({glossary:input.glossary.slice(0,500),context,segments:group.map(({id,text})=>({id,text}))}));
  const found=readCorrectionParts(response,group);
  for(const part of group){const text=found.get(part.id)??'';const reason=rejectedReason(part.text,text);if(reason)rejected.set(part.index,reason);else corrected.set(part.id,text);}
 }
 return input.batch.map(({index,row})=>{
  const metadata={version:1 as const,source_text:row.text,model_key:input.modelKey,glossary:input.glossary};const reason=rejected.get(index);
  return reason?{index,source:row,correction:undefined,issue:{...metadata,reason}}:{index,source:row,issue:undefined,correction:{...metadata,text:parts.filter(part=>part.index===index).map(part=>corrected.get(part.id)).join(' ')}};
 });
}
export function correctedTranscriptText(rows:readonly TranscriptRow[]):string{
 return ['AI 보정본 · 원음 대조가 필요합니다. 보정 전 구간은 원문으로 표시합니다.','',...rows.filter(row=>row.text.trim()).map(row=>`[${rowTime(row)}] ${row.is_partial?'[입력 중] ':typeof row.reviewed_text==='string'?'[직접 수정] ':correctedText(row)===null?'[보정 전 원문] ':''}${typeof row.reviewed_text==='string'?row.reviewed_text:correctedText(row)??row.text}`)].join('\n');
}

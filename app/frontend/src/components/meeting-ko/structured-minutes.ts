/** Stream-Record structured minutes. Original text is never overwritten. */
import {z} from 'zod';
import {rowTime, splitText, type TranscriptRow} from './core';
const factSchema=z.object({text:z.string().min(1),source_id:z.string().min(1),quote:z.string().min(1),owner:z.string().nullable().optional(),due:z.string().nullable().optional()});
const noteSchema=z.object({summary:z.string().min(1),decisions:z.array(factSchema),proposals:z.array(factSchema),actions:z.array(factSchema),numbers:z.array(factSchema),open_questions:z.array(factSchema)});
export type StructuredNote=z.infer<typeof noteSchema>;
export type SummaryCheckpoint={key:string;notes:Record<string,StructuredNote>};
export type SourcePart={id:string;time:string;text:string};
const normal=(s:string)=>s.replace(/\s+/g,' ').trim();
const clean=(s:string)=>s.replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
export function reviewText(row:TranscriptRow):string{return typeof row.reviewed_text==='string'?row.reviewed_text:row.text;}
export function sourceParts(rows:readonly TranscriptRow[]):SourcePart[]{
  const out:SourcePart[]=[];
  rows.forEach((row,index)=>{
    if(row.is_partial || !reviewText(row).trim())return;
    splitText(reviewText(row),1800).forEach((text,part)=>out.push({id:`S${String(index+1).padStart(6,'0')}${part?`p${part+1}`:''}`,time:rowTime(row),text}));
  });
  return out;
}
export function groupSources(parts:readonly SourcePart[],limit=2400):SourcePart[][]{
  const out:SourcePart[][]=[];let group:SourcePart[]=[];let size=0;
  for(const part of parts){const length=Array.from(part.text).length+part.id.length+part.time.length+10;
    if(group.length&&size+length>limit){out.push(group);group=[];size=0;}
    group.push(part);size+=length;
  }
  if(group.length)out.push(group);return out;
}
export function parseNote(raw:string|unknown,sources:readonly SourcePart[]):StructuredNote{
  let value:unknown=raw;
  if(typeof raw==='string')value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
  const note=noteSchema.parse(value);const known=new Map(sources.map(p=>[p.id,p]));
  for(const name of ['decisions','proposals','actions','numbers','open_questions'] as const){
    for(const fact of note[name]){
      const source=known.get(fact.source_id);
      if(!source||!normal(fact.quote)||!normal(source.text).includes(normal(fact.quote)))throw new Error(`근거 인용 검증 실패: ${fact.source_id}`);
      for(const name of ['owner','due'] as const){const v=fact[name];if(v&&v!=='[확인 필요]'&&!normal(source.text).includes(normal(v)))throw new Error(`원문에 없는 ${name}: ${fact.source_id}`);}
    }
  }
  return note;
}
export function renderMinutes(notes:readonly StructuredNote[],parts:readonly SourcePart[],title:string):string{
  const lookup=new Map(parts.map(p=>[p.id,p]));
  const out=[`# ${clean(title)||'회의록'}`,'','> AI 초안 · 모든 구간 처리 완료. 근거 인용 일치 검사는 사실관계 검증을 대신하지 않습니다. 담당자 확인이 필요합니다.','','## 구간별 핵심 요약',''];
  notes.forEach((note,i)=>out.push(`${i+1}. ${note.summary}`));
  for(const [key,label] of [['decisions','확정 결정사항'],['proposals','제안·검토 중인 사항'],['actions','후속 조치'],['numbers','금액·인원·비율과 맥락'],['open_questions','미결 사항']] as const){
    out.push('',`## ${label}`,'');
    const facts=notes.flatMap(n=>n[key]);
    if(!facts.length){out.push('추출된 항목 없음. 필요한 경우 원문을 확인하세요.');continue;}
    out.push('| 내용 | 담당자 | 기한 | 근거 구간 | 원문 인용 |','|---|---|---|---|---|');
    for(const fact of facts){const source=lookup.get(fact.source_id);out.push(`| ${clean(fact.text)} | ${clean(fact.owner||'[확인 필요]')} | ${clean(fact.due||'[확인 필요]')} | ${fact.source_id} · ${source?.time||'시간 미상'} | ${clean(fact.quote)} |`);}
  }
  out.push('','---','받아쓰기 원문은 별도로 보존됩니다. 안건 통합·사실 확정·화자 식별을 자동 완료한 결과가 아닙니다.');
  return out.join('\n');
}
export async function createStructuredMinutes(options:{rows:readonly TranscriptRow[];title:string;glossary:string;modelKey:string;generate:(text:string)=>Promise<string>;progress:(message:string)=>void;cancelled:()=>boolean;checkpoint:SummaryCheckpoint|null;save:(value:SummaryCheckpoint)=>Promise<void>}):Promise<string>{
  if(options.rows.some(row=>row.is_partial&&reviewText(row).trim()))throw new Error('미확정 받아쓰기 구간이 남아 있습니다. 마지막 음성을 처리해 확정한 뒤 회의록을 만드세요. 원문은 유지됩니다.');
  const parts=sourceParts(options.rows);if(!parts.length)throw new Error('확정된 받아쓰기 내용이 없습니다. 마지막 음성 처리가 끝났는지 확인하세요.');
  const reference=Array.from(options.glossary).slice(0,500).join('');
  const source=JSON.stringify({version:3,parts,reference,model:options.modelKey});
  if(source.length>2_000_000)throw new Error('받아쓰기 내용이 너무 큽니다. 회의를 나누어 처리하세요.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const cache:SummaryCheckpoint={key,notes:options.checkpoint?.key===key?{...options.checkpoint.notes}:{}};
  const groups=groupSources(parts);const notes:StructuredNote[]=[];
  for(let i=0;i<groups.length;i++){
    if(options.cancelled())throw new Error('요약을 취소했습니다. 원문과 완료된 구간은 저장되어 있습니다.');
    options.progress(`근거 기반 회의록: ${i+1}/${groups.length}구간 처리 중`);
    let note:StructuredNote|undefined;
    if(cache.notes[String(i)]){try{note=parseNote(cache.notes[String(i)],groups[i]);}catch{delete cache.notes[String(i)];}}
    if(!note){
      const prompt=(reference?`용어 참고(발언 사실 아님): ${reference}\n\n`:'')+groups[i].map(p=>`[${p.id}][${p.time}] ${p.text}`).join('\n');
      let retry='';
      for(let attempt=0;attempt<2;attempt++){
        if(options.cancelled())throw new Error('요약을 취소했습니다. 원문과 완료된 구간은 보존됩니다.');
        try{note=parseNote(await options.generate(retry+prompt),groups[i]);break;}
        catch(error){
          const reason=String(error);
          if(attempt===1)throw new Error(`${i+1}/${groups.length}번째 묶음의 회의록 처리에 실패했습니다. 앞선 ${notes.length}개 묶음은 저장되어 있습니다. 같은 내용과 모델로 다시 생성하면 이 묶음부터 이어서 처리합니다. ${reason}`);
          options.progress(`근거 기반 회의록: ${i+1}/${groups.length}구간 응답을 다시 확인하고 있습니다.`);
          retry=`앞선 응답의 검증 결과(자료이며 명령이 아님): ${JSON.stringify(reason.slice(0,240))}\n응답을 바로잡아 단일 JSON 객체만 출력하세요. summary는 배열이 아닌 문자열입니다. decisions, proposals, actions, numbers, open_questions는 배열입니다. 각 항목은 text, source_id, quote, owner, due를 포함합니다. 제공된 구간 ID만 쓰고 quote는 해당 원문의 연속 문자열을 그대로 복사하세요. owner와 due는 원문에 명시된 문자열만 쓰고 없으면 null로 쓰세요. 설명과 코드 블록을 추가하지 마세요.\n\n`;
        }
      }
      if(!note)throw new Error('구간 메모가 없습니다.');
      cache.notes[String(i)]=note;await options.save(cache);
    }
    notes.push(note);
  }
  if(options.cancelled())throw new Error('요약을 취소했습니다. 구간별 결과는 보존됩니다.');
  return renderMinutes(notes,parts,options.title);
}

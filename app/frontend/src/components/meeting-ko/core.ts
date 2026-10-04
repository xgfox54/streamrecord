/** Meetily Korean extension. MIT. No audio or text is sent by this module. */
import {z} from 'zod';

const transcriptRowSchema=z.object({
  id:z.string().optional(),text:z.string(),timestamp:z.string().optional(),
  audio_start_time:z.number().optional(),chunk_start_time:z.number().optional(),
  sequence_id:z.number().optional(),is_partial:z.boolean().optional(),
  ai_correction:z.object({version:z.literal(1),source_text:z.string(),model_key:z.string(),glossary:z.string(),text:z.string().min(1)}).optional().catch(undefined),
  ai_correction_issue:z.object({version:z.literal(1),source_text:z.string(),model_key:z.string(),glossary:z.string(),reason:z.enum(['numbers','length'])}).optional().catch(undefined),
}).passthrough();
const transcriptEnvelopeSchema=z.object({
  transcripts:z.array(transcriptRowSchema).optional(),
  data:z.array(transcriptRowSchema).optional(),
  total_count:z.number().int().nonnegative().optional(),
  has_more:z.boolean().optional(),
}).passthrough();
export type TranscriptRow=z.infer<typeof transcriptRowSchema>;
export interface AudioInput { readonly name: string; readonly device_type: 'Input' | 'Output' }
export const isStereoMix = (device: AudioInput): boolean => device.device_type === 'Input' && /stereo\s*mix|스테레오\s*믹스/i.test(device.name);
export function stereoMixName(devices: readonly AudioInput[]): string {
  return devices.find(isStereoMix)?.name || '';
}
export function microphoneInputs(devices: readonly AudioInput[]): AudioInput[] {
  return devices.filter(device => device.device_type === 'Input' && !isStereoMix(device));
}
export function timestamp(seconds: number): string {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(v => String(v).padStart(2, '0')).join(':');
}
export function rowTime(row: TranscriptRow): string {
  const seconds = row.audio_start_time ?? row.chunk_start_time;
  return typeof seconds === 'number' ? timestamp(seconds) : row.timestamp || '시간 미상';
}
export function transcriptText(rows: TranscriptRow[]): string {
  return rows.filter(r => r.text.trim()).map(r => `[${rowTime(r)}] ${r.is_partial ? '[미확정] ' : ''}${r.text}`).join('\n');
}
export function readRows(value: unknown): TranscriptRow[] {
  const parsed=Array.isArray(value)
    ? z.array(transcriptRowSchema).safeParse(value)
    : transcriptEnvelopeSchema.safeParse(value);
  if(!parsed.success)throw new Error('받아쓰기 항목에 text 필드가 없거나 형식이 올바르지 않습니다.');
  if(Array.isArray(parsed.data))return parsed.data;
  const rows=parsed.data.transcripts??parsed.data.data;
  if(!rows)throw new Error('받아쓰기 응답 형식이 예상과 다릅니다. 원본 데이터는 변경하지 않았습니다.');
  return rows;
}
export type FetchTranscriptPage=(meetingId:string,limit:number,offset:number)=>Promise<unknown>;
export async function loadAllTranscriptRows(meetingId:string,fetchPage:FetchTranscriptPage):Promise<TranscriptRow[]>{
  const result:TranscriptRow[]=[];const limit=300;let previous='';
  for(let offset=0;offset<600_000;offset+=limit){
    const value=await fetchPage(meetingId,limit,offset);const batch=readRows(value);
    const signature=JSON.stringify(batch);
    if(batch.length&&signature===previous)throw new Error('받아쓰기 페이지가 반복되었습니다. 원본 회의 데이터는 보존되어 있습니다.');
    previous=signature;result.push(...batch);
    const envelope=transcriptEnvelopeSchema.safeParse(value);
    const doneByMetadata=envelope.success&&!Array.isArray(envelope.data)&&(
      envelope.data.has_more===false||
      (envelope.data.total_count!==undefined&&result.length>=envelope.data.total_count));
    if(doneByMetadata||batch.length<limit)return result;
  }
  throw new Error('받아쓰기 항목 한도 초과. 원본 회의 데이터를 확인하세요.');
}
/** Lossless chunking by Unicode code point, preferring a line boundary. */
export function splitText(text: string, limit = 1500): string[] {
  if (!Number.isInteger(limit) || limit < 32) throw new Error('청크 크기는 32 이상 정수여야 합니다.');
  const chars = Array.from(text); const out: string[] = [];
  for (let start = 0; start < chars.length;) {
    let end = Math.min(start + limit, chars.length);
    if (end < chars.length) {
      for (let k = end - 1; k >= start + Math.floor(limit / 2); k--) {
        if (chars[k] === '\n') { end = k + 1; break; }
      }
    }
    out.push(chars.slice(start, end).join('')); start = end;
  }
  return out;
}
export type Generate = (text: string, stage: 'notes' | 'final') => Promise<string>;
/** Replace updates for one segment; do not deduplicate different repeated utterances. */
export function upsertRow(rows: TranscriptRow[], row: TranscriptRow): TranscriptRow[] {
  if (!row || typeof row.text !== 'string') throw new Error('잘못된 받아쓰기 이벤트입니다.');
  const same = (old: TranscriptRow) => row.sequence_id !== undefined
    ? old.sequence_id === row.sequence_id
    : row.id !== undefined && old.id === row.id;
  const index = rows.findIndex(same);
  if (index >= 0 && rows[index].is_partial === false && row.is_partial === true) return rows;
  const next = rows.slice();
  if (index < 0) next.push(row); else next[index] = { ...rows[index], ...row };
  return next.sort((a, b) => (a.sequence_id ?? a.audio_start_time ?? a.chunk_start_time ?? 0)
    - (b.sequence_id ?? b.audio_start_time ?? b.chunk_start_time ?? 0));
}

export async function createMinutes(text: string, generate: Generate,
  progress: (message: string) => void, cancelled: () => boolean = () => false): Promise<string> {
  if (!text.trim()) throw new Error('요약할 받아쓰기 내용이 없습니다.');
  if (text.length > 2_000_000) throw new Error('받아쓰기 내용이 너무 큽니다. 회의를 나누어 처리해 주세요.');
  let current = text;
  const check = () => { if (cancelled()) throw new Error('요약을 취소했습니다. 받아쓰기 원문은 유지됩니다.'); };
  for (let round = 0; round < 8; round++) {
    check();
    const chunks = splitText(current);
    if (chunks.length <= 1) {
      progress('최종 회의록과 요약본 작성 중');
      const result = await generate(current, 'final'); check();
      if (!result.trim()) throw new Error('요약 모델이 빈 응답을 반환했습니다.');
      return result;
    }
    const notes: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      check(); progress(`${round + 1}단계: ${i + 1}/${chunks.length} 구간 정리 중`);
      const note = await generate(chunks[i], 'notes'); check();
      if (!note.trim()) throw new Error(`${i + 1}번 구간의 요약 응답이 비어 있습니다.`);
      notes.push(`[구간 ${i + 1}]\n${note}`);
    }
    const next = notes.join('\n\n');
    if (next.length >= current.length) throw new Error('요약 모델이 내용을 줄이지 못했습니다. 다른 로컬 모델을 선택해 주세요. 원문은 보존됩니다.');
    current = next;
  }
  throw new Error('장문 요약 단계 한도를 초과했습니다. 원문을 나누어 처리해 주세요.');
}

import {invoke} from '@tauri-apps/api/core';
import type {CorrectionModel} from './transcript-correction';
type GenerationRequest={readonly model:string;revision?:string;readonly provider:CorrectionModel['provider'];readonly text:string;readonly stage:'notes'|'structured'|'final'|'release'|'correction'};
let tail:Promise<unknown>=Promise.resolve();
let pending=0;
export class GenerationCancelled extends Error {override name='GenerationCancelled';}
/** All callers share the native engine's single-request capacity. */
export function generateText(request:GenerationRequest,signal?:AbortSignal,onState?:(state:'waiting'|'generating')=>void):Promise<string>{
 if(pending>0)onState?.('waiting');pending++;
 const next=tail.then(()=>{if(signal?.aborted)throw new GenerationCancelled('AI 처리를 중단했습니다.');onState?.('generating');return invoke<string>('ko_generate',request);}).finally(()=>{pending--;});
 tail=next.then(()=>undefined,()=>undefined);
 return next;
}

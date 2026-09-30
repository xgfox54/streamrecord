import {invoke} from '@tauri-apps/api/core';
import type {CorrectionModel} from './transcript-correction';
type GenerationRequest={readonly model:string;readonly provider:CorrectionModel['provider'];readonly text:string;readonly stage:'notes'|'structured'|'final'|'release'|'correction'};
let tail:Promise<unknown>=Promise.resolve();
export class GenerationCancelled extends Error {override name='GenerationCancelled';}
/** All callers share the native engine's single-request capacity. */
export function generateText(request:GenerationRequest,signal?:AbortSignal):Promise<string>{
 const next=tail.then(()=>{if(signal?.aborted)throw new GenerationCancelled('AI 처리를 중단했습니다.');return invoke<string>('ko_generate',request);});
 tail=next.then(()=>undefined,()=>undefined);
 return next;
}

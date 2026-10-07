import {z} from 'zod';

export const importProgressSchema=z.object({
 progress_percentage:z.number().finite(),
 message:z.string(),
 stage:z.string().optional(),
 timing:z.object({
  elapsed_seconds:z.number().finite().nonnegative(),
  estimated_total_seconds:z.number().finite().nonnegative().nullable(),
  remaining_seconds:z.number().finite().nonnegative().nullable(),
 }).nullable().optional(),
});
export type FileImportProgress=z.infer<typeof importProgressSchema>;

export function importDuration(seconds:number):string{
 const rounded=Math.max(1,Math.ceil(seconds));
 const hours=Math.floor(rounded/3600);const minutes=Math.floor(rounded%3600/60);const rest=rounded%60;
 return [hours?`${hours}시간`:'',minutes?`${minutes}분`:'',rest?`${rest}초`:''].filter(Boolean).join(' ');
}

export function remainingImportTime(progress:FileImportProgress|null,elapsedSeconds:number):number|null{
 if(progress?.stage!=='transcribing'||progress.timing?.estimated_total_seconds==null)return null;
 const remaining=progress.timing.estimated_total_seconds-elapsedSeconds;
 return remaining>0?remaining:null;
}

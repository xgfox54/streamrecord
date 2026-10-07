export type RecordInputKind='microphone'|'pc'|'youtube'|'file';
export const inputLabels:Readonly<Record<RecordInputKind,string>>={microphone:'마이크',pc:'PC 소리',youtube:'YouTube',file:'음성 파일'};
export function isDefaultRecordTitle(title:string){return !title.trim()||['새 기록','새 회의','제목 없는 기록'].includes(title.trim());}
export function suggestedRecordTitle(title:string,input:RecordInputKind,at:Date,videoTitle=''){
 if(!isDefaultRecordTitle(title))return title;
 if(input==='youtube'&&videoTitle.trim())return videoTitle.trim().slice(0,100);
 return `${inputLabels[input]} 기록 · ${at.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})} ${at.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
}
export function recordDisplayTitle(title:string,updatedAt:string,input?:RecordInputKind){
 if(!isDefaultRecordTitle(title))return title;
 const date=new Date(updatedAt);if(Number.isNaN(date.valueOf()))return title||'제목 없는 기록';
 return `${input?inputLabels[input]+' ':''}기록 · ${date.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})} ${date.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
}
export function durationLabel(seconds:number|undefined){
 if(seconds===undefined||!Number.isFinite(seconds)||seconds<0)return '';
 const whole=Math.floor(seconds),minutes=Math.floor(whole/60);return minutes?`${minutes}분 ${whole%60}초`:`${whole}초`;
}

import {createRequire} from 'node:module';
const require=createRequire(new URL('../../app/frontend/package.json',import.meta.url));
const {z}=require('zod');
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const referenceSchema=z.object({id:z.string().min(1),audioSha256:sha,durationSeconds:z.number().positive(),reference:z.string().trim().min(1).max(10000),referenceKind:z.enum(['human-reviewed','published-reference']),sourceUrl:z.string().url(),importantTerms:z.array(z.string().min(1)),split:z.literal('evaluation')});
export const runSchema=z.object({id:z.string().min(1),audioSha256:sha,engine:z.string().min(1),model:z.string().min(1),text:z.string().max(20000),elapsedSeconds:z.number().nonnegative(),firstPartialMs:z.number().nonnegative().nullable(),committedMs:z.number().nonnegative().nullable(),peakRamMiB:z.number().nonnegative().nullable(),peakVramMiB:z.number().nonnegative().nullable()});
const normalized=text=>text.normalize('NFC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export function editCounts(reference,hypothesis){
 const a=Array.from(reference),b=Array.from(hypothesis);
 let prior=Array.from({length:b.length+1},(_,i)=>({distance:i,substitutions:0,deletions:0,insertions:i}));
 for(let i=1;i<=a.length;i++){
  const current=[{distance:i,substitutions:0,deletions:i,insertions:0}];
  for(let j=1;j<=b.length;j++){
   if(a[i-1]===b[j-1]){current.push(prior[j-1]);continue;}
   const sub={...prior[j-1],distance:prior[j-1].distance+1,substitutions:prior[j-1].substitutions+1};
   const del={...prior[j],distance:prior[j].distance+1,deletions:prior[j].deletions+1};
   const ins={...current[j-1],distance:current[j-1].distance+1,insertions:current[j-1].insertions+1};
   current.push([sub,del,ins].sort((x,y)=>x.distance-y.distance)[0]);
  }
  prior=current;
 }
 return {...prior[b.length],referenceCharacters:a.length};
}
export function evaluate(referenceInput,runInput){
 const reference=referenceSchema.parse(referenceInput),run=runSchema.parse(runInput);
 if(reference.id!==run.id||reference.audioSha256!==run.audioSha256)throw new TypeError('Run and reference must identify the same audio');
 const raw=editCounts(reference.reference.normalize('NFC'),run.text.normalize('NFC'));
 const compact=normalized(reference.reference);
 if(compact.length===0)throw new TypeError('Reference has no normalized characters');
 const normal=editCounts(compact,normalized(run.text));
 const numberPattern=/\d+(?:[.,]\d+)*/gu;
 const expected=reference.reference.match(numberPattern)??[];
 const available=[...(run.text.match(numberPattern)??[])];
 let matched=0;
 for(const token of expected){const index=available.indexOf(token);if(index>=0){matched++;available.splice(index,1);}}
 const terms=reference.importantTerms.filter(term=>reference.reference.includes(term));
 return {id:reference.id,engine:run.engine,model:run.model,audioSha256:run.audioSha256,referenceKind:reference.referenceKind,
  rawCer:raw.distance/raw.referenceCharacters,normalizedCer:normal.distance/normal.referenceCharacters,normalization:'NFC lowercase remove punctuation whitespace; retain numerals',edits:normal,
  numericTokens:{expected:expected.length,matched,unexpected:available.length},
  importantTerms:{expected:terms.length,matched:terms.filter(term=>run.text.includes(term)).length},
  rtf:run.elapsedSeconds/reference.durationSeconds,firstPartialMs:run.firstPartialMs,committedMs:run.committedMs,peakRamMiB:run.peakRamMiB,peakVramMiB:run.peakVramMiB};
}

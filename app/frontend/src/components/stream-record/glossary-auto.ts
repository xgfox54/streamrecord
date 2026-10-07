import {glossaryPacks} from './glossary-packs';

export type PackScore={readonly id:string;readonly label:string;readonly score:number;readonly hits:readonly string[]};

// "감사합니다" is a courtesy, not an audit; removing it keeps every polite meeting from looking like an audit.
const courtesy=/감사(?:합니다|드립니다|드리|하다|하고|했|하겠|해요|해)/g;
const compact=(text:string)=>text.replace(courtesy,' ').replace(/\s+/g,'');

/** Scores each word set by the distinct set words that appear in the text. Longer words and repeats weigh more. */
export function scoreGlossaryPacks(text:string):PackScore[]{
 const body=compact(text);
 return glossaryPacks.map(pack=>{
  const hits:string[]=[];let score=0;
  for(const term of pack.terms){
   const word=term.replace(/\s+/g,'');if(Array.from(word).length<2)continue;
   let count=0;for(let at=body.indexOf(word);at>=0&&count<5;at=body.indexOf(word,at+word.length))count++;
   if(count){hits.push(term);score+=Math.min(Array.from(word).length,6)*(1+Math.log2(count));}
  }
  return {id:pack.id,label:pack.label,score,hits};
 }).sort((a,b)=>b.score-a.score);
}

/**
 * Picks at most two sets that clearly match the text. A set needs `minHits` distinct words,
 * and a second set must score at least half of the best one.
 */
export function chooseGlossaryPacks(text:string,{minHits=3,minScore=0,max=2,ratio=0.5}:{minHits?:number;minScore?:number;max?:number;ratio?:number}={}):PackScore[]{
 const ranked=scoreGlossaryPacks(text).filter(pack=>pack.hits.length>=minHits&&pack.score>=minScore);
 const top=ranked[0];if(!top)return [];
 return ranked.slice(0,max).filter(pack=>pack.score>=top.score*ratio);
}

// Every council broadcast names the institution, so it says nothing about the topic of the meeting.
const institutions=['제주특별자치도의회','제주특별자치도'];
/**
 * Picks sets from a meeting or video title, such as "제454회 임시회 제2차 행정자치위원회 행정사무감사".
 * A title is short, so one strong word is enough, but it must be at least four characters long:
 * "위원장" in "시·도당위원장협의회" alone does not make a party meeting a council session.
 */
export function choosePacksFromTitle(title:string):PackScore[]{
 return chooseGlossaryPacks(institutions.reduce((text,name)=>text.split(name).join(' '),title),{minHits:1,minScore:4});
}

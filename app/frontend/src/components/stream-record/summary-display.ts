export type SummarySentence={readonly text:string;readonly needsReview:boolean};
export type SummaryBlock={readonly time:string|null;readonly sentences:readonly SummarySentence[]};
const reviewMarker=/\[\s*확인\s*필요\s*\]/g;
function sentences(text:string):SummarySentence[]{
 const result:SummarySentence[]=[];
 let pendingReview=false;
 for(const chunk of text.split(/(?<=[.!?。！？])\s+|\n+/)){
  const marked=/\[\s*확인\s*필요\s*\]/.test(chunk);
  const complete=chunk.replace(/([은는이가])\s*\[\s*확인\s*필요\s*\]\s*([.!?。！？]|$)/g,(_,particle:string,punctuation:string)=>`${particle} 확인되지 않았습니다${punctuation||'.'}`);
  const clean=complete.replace(reviewMarker,'').replace(/[ \t]+([.!?。！？])/g,'$1').trim();
  if(marked&&!clean.replace(/[.!?。！？]/g,'').trim()){
   const previous=result.at(-1);
   if(previous)result[result.length-1]={...previous,needsReview:true};
   else pendingReview=true;
   continue;
  }
  if(clean){result.push({text:clean,needsReview:marked||pendingReview});pendingReview=false;}
 }
 return result;
}
export function summaryBlocks(text:string,fallbackTime:string|null=null):readonly SummaryBlock[]{
 const stamps=[...text.matchAll(/\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\s*[~–—-]\s*(?:\d{1,2}:)?\d{1,2}:\d{2})?)\]/g)];
 if(!stamps.length)return [{time:fallbackTime,sentences:sentences(text)}];
 const blocks:SummaryBlock[]=[];
 const first=stamps[0];
 if(first&&first.index>0){const preface=text.slice(0,first.index).trim();if(preface)blocks.push({time:null,sentences:sentences(preface)});}
 stamps.forEach((stamp,index)=>{const start=stamp.index+stamp[0].length;const end=stamps[index+1]?.index??text.length;blocks.push({time:stamp[1]??null,sentences:sentences(text.slice(start,end))});});
 return blocks;
}

// Includes separators; applies only to AI correction reference words, never to Whisper.
export const glossaryCharacterLimit=3000;
export const glossaryLimitLabel='3,000';

export function appendGlossaryTerms(manual:string,terms:readonly string[],budget=glossaryCharacterLimit){
 let text=manual;
 const existing=new Set(manual.split(/[,;\n]/).map(item=>item.trim()).filter(Boolean));
 const omitted:string[]=[];
 for(const term of new Set(terms.map(item=>item.trim()).filter(Boolean))){
  if(existing.has(term))continue;
  const next=text?`${text}, ${term}`:term;
  if(next.length>budget){omitted.push(term);continue;}
  text=next;existing.add(term);
 }
 return {text,omitted};
}

// Preserve legacy saved input; limit only the request, without cutting a term in half.
export function correctionGlossary(text:string):string{
 if(text.length<=glossaryCharacterLimit)return text;
 const prefix=text.slice(0,glossaryCharacterLimit+1);
 const end=Math.max(prefix.lastIndexOf(','),prefix.lastIndexOf(';'),prefix.lastIndexOf('\n'));
 return end<0?'':text.slice(0,end).trimEnd();
}

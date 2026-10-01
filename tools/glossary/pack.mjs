import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/frontend/package.json',import.meta.url));
const {parse} = require('parse5');
export function visibleText(html){
 const walk=node=>['script','style','template','noscript'].includes(node.nodeName)?'':node.nodeName==='#text'?node.value:(node.childNodes??[]).map(walk).join(' ');
 return walk(parse(html)).replace(/\s+/gu,' ').trim().normalize('NFC');
}
export function collectTerms(source,candidates){
 const url=new URL(source.url);
 if(url.protocol!=='https:'||url.hostname!=='record.council.jeju.kr')throw new TypeError('Official Jeju Council HTTPS source required');
 const text=visibleText(source.html);
 const sourceSha256=createHash('sha256').update(source.html).digest('hex');
 return [...new Set(candidates.map(term=>term.trim().normalize('NFC')))].filter(term=>term.length>=2&&text.includes(term)).map(term=>({
  id:`jeju-${createHash('sha256').update(term).digest('hex').slice(0,12)}`,term,category:'council-term',reviewStatus:'candidate',
  sourceUrl:source.url,sourceSha256,retrievedAt:source.retrievedAt,firstTextOffset:text.indexOf(term),occurrences:text.split(term).length-1,
 }));
}
export function mergeHints(manual,selected,budget=500){
 if(!Number.isInteger(budget)||budget<0)throw new RangeError('Invalid character budget');
 const words=manual.split(/[,;\n]/u).map(t=>t.trim().normalize('NFC')).filter(Boolean);
 const result=[...new Set(words)],included=[],omitted=[];
 if(Array.from(result.join(', ')).length>budget)throw new RangeError('Manual glossary exceeds character budget');
 for(const value of selected){
  const term=value.trim().normalize('NFC');
  if(!term||result.includes(term))continue;
  if(Array.from([...result,term].join(', ')).length>budget){omitted.push(term);continue;}
  result.push(term);included.push(term);
 }
 return {text:result.join(', '),included,omitted};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {collectTerms,mergeHints,visibleText} from './pack.mjs';
test('collector ignores scripts and rejects unattested candidate terms',()=>{
 const html='<html><body>제주특별자치도의회 <span>교육위원회</span><script>가상위원회</script></body></html>';
 const terms=collectTerms({html,url:'https://record.council.jeju.kr/source/example',retrievedAt:'2026-10-01'},['교육위원회','가상위원회']);
 assert.deepEqual(terms.map(t=>t.term),['교육위원회']);
 assert.equal(terms[0].reviewStatus,'candidate');
 assert.match(terms[0].sourceSha256,/^[a-f0-9]{64}$/);
});
test('hint merge preserves manual terms priority, deduplicates, and omits whole terms at budget',()=>{
 assert.deepEqual(mergeHints('제주, 교육위원회',['교육위원회','환경도시위원회','예산'],15),{text:'제주, 교육위원회, 예산',included:['예산'],omitted:['환경도시위원회']});
});
test('hint merge refuses overbudget manual text without silently truncating it',()=>{
 assert.throws(()=>mergeHints('수동 용어 유지',[],2),RangeError);
});
test('entity decoding does not retain HTML instructions',()=>{
 assert.equal(visibleText('<p>4&middot;3특별위원회</p><style>숨김</style>'),'4·3특별위원회');
});
test('built pack contains only independently verifiable candidates and no default activation',async()=>{
 const p=JSON.parse(await readFile(new URL('../../assets/glossary/jeju-council-candidates.json',import.meta.url),'utf8'));
 assert.equal(p.defaultEnabled,false);
 assert.ok(p.terms.length>=10);
 assert.ok(p.terms.every(t=>t.reviewStatus==='candidate'&&t.sourceUrl.startsWith('https://record.council.jeju.kr/')&&t.occurrences>0));
 assert.equal(new Set(p.terms.map(t=>t.term)).size,p.terms.length);
});

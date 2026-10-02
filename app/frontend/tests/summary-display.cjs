'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const Renderer=require('react-test-renderer');
const {act}=Renderer;
const root=path.resolve(__dirname,'..');
const modules=new Map();
function load(filename){
 filename=path.resolve(filename);
 if(filename.endsWith('.json'))return JSON.parse(fs.readFileSync(filename,'utf8'));
 if(!path.extname(filename))filename+=fs.existsSync(filename+'.ts')?'.ts':'.tsx';
 if(modules.has(filename))return modules.get(filename).exports;
 const module={exports:{}};modules.set(filename,module);
 const result=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const localRequire=id=>id.endsWith('.css')?{}:id.startsWith('.')?load(path.join(path.dirname(filename),id)):require(id);
 vm.runInNewContext(result.outputText,{module,exports:module.exports,require:localRequire,console},{filename});
 return module.exports;
}
const {summaryBlocks}=load(path.join(root,'src/components/stream-record/summary-display.ts'));
const plain=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(summaryBlocks('[00:01:02] 예산을 검토했습니다.[00:03:04] 담당 부서는 [확인 필요].')),[{time:'00:01:02',sentences:[{text:'예산을 검토했습니다.',needsReview:false}]},{time:'00:03:04',sentences:[{text:'담당 부서는 확인되지 않았습니다.',needsReview:true}]}]);
assert.deepEqual(plain(summaryBlocks('정책의 의미는 [확인 필요].\n기한은 [확인 필요]')),[{time:null,sentences:[{text:'정책의 의미는 확인되지 않았습니다.',needsReview:true},{text:'기한은 확인되지 않았습니다.',needsReview:true}]}]);
assert.deepEqual(plain(summaryBlocks('지원액은 3.5억 원 [확인 필요]입니다. 일정은 확정됐습니다.','00:05:00')),[{time:'00:05:00',sentences:[{text:'지원액은 3.5억 원 입니다.',needsReview:true},{text:'일정은 확정됐습니다.',needsReview:false}]}]);
assert.deepEqual(plain(summaryBlocks('[확인 필요] 발언자의 직책을 확인하세요. 다음 안건을 진행했습니다.')),[{time:null,sentences:[{text:'발언자의 직책을 확인하세요.',needsReview:true},{text:'다음 안건을 진행했습니다.',needsReview:false}]}]);
assert.deepEqual(plain(summaryBlocks('[00:01:02] 담당 부서는 교육청입니다. [확인 필요]')),[{time:'00:01:02',sentences:[{text:'담당 부서는 교육청입니다.',needsReview:true}]}]);
assert.deepEqual(plain(summaryBlocks('[확인 필요]\n교육청 담당입니다. 다음 회의는 확정됐습니다.')),[{time:null,sentences:[{text:'교육청 담당입니다.',needsReview:true},{text:'다음 회의는 확정됐습니다.',needsReview:false}]}]);
assert.deepEqual(plain(summaryBlocks('첫 번째 결정입니다. 담당 부서는 교육청입니다. [확인 필요]\n다음 회의는 확정됐습니다.')),[{time:null,sentences:[{text:'첫 번째 결정입니다.',needsReview:false},{text:'담당 부서는 교육청입니다.',needsReview:true},{text:'다음 회의는 확정됐습니다.',needsReview:false}]}]);
for(const separator of ['~','–','—','-'])assert.deepEqual(plain(summaryBlocks('[00:00:05'+separator+'00:08:00] 시간 범위 요약입니다.')),[{time:'00:00:05'+separator+'00:08:00',sentences:[{text:'시간 범위 요약입니다.',needsReview:false}]}]);
console.log('PASS 11 summary timeline cases');

fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/summary-display.json'),JSON.stringify({passed:11,failed:0,scope:'Summary text formatting only; no inference.',tests:11},null,2));

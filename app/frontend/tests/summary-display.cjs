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
for(const separator of ['~','–','—','-'])assert.deepEqual(plain(summaryBlocks('[00:02:24'+separator+'] 끝 시각 없는 요약입니다.')),[{time:'00:02:24'+separator,sentences:[{text:'끝 시각 없는 요약입니다.',needsReview:false}]}]);
const example=[
 ['00:02:24~','위성곤 제주도지사로 소개된 도지사는 도민과 함께 묻고 정하는 도정, 민생·AX·기후에너지·AI행정·인재육성·공공갈등 관리를 제시했다. 타운홀 의견은 부서 검토 후 반영 여부와 결과를 알리겠다고 했으며, 세부 사업·담당자·기한은 미정.'],
 ['00:08:12~','‘모두의 제주’ 소개 영상에 이어'],
 ['00:12:02~','바다 변화, 관광객 감소, 물가·생계 부담, 재기 기회 부족, 청년 유출 우려를 도민 목소리로 제시.'],
 ['00:14:42~','양순철 제주특별자치도 정책계획관이 민선 9기 핵심 가치와 7대 전략을 설명했다. 슬로건은 ‘도민과 함께 미래를 만나는 제주’. 민생(취약계층·소상공인 지원 등), 기본사회(7대 기본서비스), AX(규제 실험·그린AI 데이터센터·인재·창업), 기후에너지(재생에너지·수익 환원), AI행정, 고등교육·인재 정주 지원, 공공갈등 관리 방안을 제시했다.'],
];
const singleLine=example.map(([time,body])=>'['+time+'] '+body).join(' ');
assert.deepEqual(plain(summaryBlocks(singleLine)).map(block=>[block.time,block.sentences.map(sentence=>sentence.text).join(' ')]),example);
assert.deepEqual(plain(summaryBlocks('[00:02:24~] 담당자는 [확인 필요]. [08:12] 다음 안건입니다. [12:02~14:42] 마무리했습니다.')).map(block=>({time:block.time,review:block.sentences[0].needsReview})),[{time:'00:02:24~',review:true},{time:'08:12',review:false},{time:'12:02~14:42',review:false}]);
assert.deepEqual(plain(summaryBlocks('소개입니다. [ 00:02:24 ~ ]\n본문입니다. [ 08:12 ] 다음 내용입니다.')).map(block=>block.time),[null,'00:02:24 ~','08:12']);
assert.deepEqual(plain(summaryBlocks('문서 [붙임~]에 안내했습니다.')), [{time:null,sentences:[{text:'문서 [붙임~]에 안내했습니다.',needsReview:false}]}]);
console.log('PASS 19 summary timeline cases');

fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/summary-display.json'),JSON.stringify({passed:19,failed:0,scope:'Summary text formatting only; open ranges, supplied single-line example, review markers and existing formats; no inference.',tests:19},null,2));

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
 const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const localRequire=id=>id.endsWith('.css')?{}:id.startsWith('.')?load(path.join(path.dirname(filename),id)):require(id);
 vm.runInNewContext(compiled.outputText,{module,exports:module.exports,require:localRequire,console},{filename});
 return module.exports;
}
const {GlossaryPicker,appendGlossaryTerms,interleaveTerms}=load(path.join(root,'src/components/stream-record/GlossaryPicker.tsx'));
const {glossaryPacks}=load(path.join(root,'src/components/stream-record/glossary-packs.ts'));
const copy=value=>JSON.parse(JSON.stringify(value));
const results=[];
function test(name,fn){try{fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(error){results.push({name,status:'failed',error:String(error.stack)});console.error(error.stack);}}
function harness(glossary='수동 입력',busy=false){
 const calls=[];
 let session={activeRecordId:'record-a',glossary,busy,setGlossary:value=>calls.push(value)};
 let renderer;
 act(()=>{renderer=Renderer.create(React.createElement(GlossaryPicker,{session}));});
 return {calls,renderer,select:id=>act(()=>renderer.root.findByProps({value:id}).props.onChange({target:{checked:true}})),update:values=>act(()=>{session={...session,...values};renderer.update(React.createElement(GlossaryPicker,{session}));}),apply:()=>act(()=>{const button=renderer.root.findAllByType('button').find(node=>node.props['data-action']==='append-glossary');assert.ok(button);if(!button.props.disabled)button.props.onClick();}),close:()=>act(()=>renderer.unmount())};
}
test('Given manual separators when terms repeat then manual text survives and additions are unique',()=>{
 const manual=' 탄소중립; 예비비\n기관명 ';
 const result=appendGlossaryTerms(manual,['탄소중립',' 예비비 ','기관명','기금운용결산','기금운용결산','']);
 assert.equal(result.text,manual+', 기금운용결산');assert.deepEqual(copy(result.omitted),[]);
});
test('Given an exact limit when a longer term is omitted then later fitting terms still append',()=>{
 const result=appendGlossaryTerms('가'.repeat(495),['너무긴용어','예비비','추가']);
 assert.equal(result.text,'가'.repeat(495)+', 예비비');assert.equal(result.text.length,500);assert.deepEqual(copy(result.omitted),['너무긴용어','추가']);
});
test('Given manual input already beyond the limit when adding terms then it is never truncated',()=>{
 const manual='가'.repeat(501);const result=appendGlossaryTerms(manual,['예비비']);
 assert.equal(result.text,manual);assert.deepEqual(copy(result.omitted),['예비비']);
});
test('Given a new picker when untouched then no terms are selected or applied',()=>{
 const h=harness();try{assert.equal(h.renderer.root.findAllByType('input').some(node=>node.props.checked),false);assert.deepEqual(h.calls,[]);}finally{h.close();}
});
test('Given budget and education packs when applying then shared terms appear once after manual input',()=>{
 const h=harness('지방교육재정교부금');try{h.select('budget');h.select('education');assert.deepEqual(h.calls,[]);h.apply();assert.equal(h.calls.length,1);assert.ok(h.calls[0].startsWith('지방교육재정교부금, '));assert.equal(h.calls[0].split('지방교육재정교부금').length,2);assert.ok(h.calls[0].includes('예비비'));assert.ok(h.calls[0].includes('마을키움터'));}finally{h.close();}
});
test('Given selected packs when switching records then draft selection and status reset',()=>{
 const h=harness();try{h.select('budget');h.update({activeRecordId:'record-b',glossary:'다른 기록'});assert.equal(h.renderer.root.findAllByType('input').some(node=>node.props.checked),false);assert.equal(h.renderer.root.findAllByProps({role:'status'}).length,0);assert.deepEqual(h.calls,[]);}finally{h.close();}
});
test('Given a full glossary when applying a pack then omissions are reported and manual text stays intact',()=>{
 const manual='가'.repeat(500);const h=harness(manual);try{h.select('welfare');h.apply();assert.equal(h.calls[0],manual);const status=h.renderer.root.findByProps({role:'status'});assert.ok(JSON.stringify(status.children).includes('가족친화'));}finally{h.close();}
});
test('Given an active recording when a selection exists then applying is disabled',()=>{
 const h=harness();try{h.select('budget');h.update({busy:true});h.apply();assert.deepEqual(h.calls,[]);assert.equal(h.renderer.root.findAllByType('fieldset').every(node=>node.props.disabled),true);}finally{h.close();}
});
test('Given pending selection when manual input changes then application uses the latest input',()=>{
 const h=harness('이전 입력');try{h.select('budget');h.update({glossary:'수정한 입력; 예비비'});h.apply();assert.ok(h.calls[0].startsWith('수정한 입력; 예비비, '));assert.equal(h.calls[0].split('예비비').length,2);assert.equal(h.calls[0].includes('이전 입력'),false);}finally{h.close();}
});
test('Given a selected pack when unchecked then it contributes no terms',()=>{
 const h=harness();try{h.select('budget');h.select('education');act(()=>h.renderer.root.findByProps({value:'budget'}).props.onChange({target:{checked:false}}));h.apply();assert.equal(h.calls[0].includes('예비비'),false);assert.ok(h.calls[0].includes('마을키움터'));}finally{h.close();}
});
test('Given the meeting word sets then there are 500 distinct terms in 11 topics, each fitting the recognition hint',()=>{
 const all=glossaryPacks.flatMap(item=>[...item.terms]);assert.equal(glossaryPacks.length,11);assert.equal(all.length,500);assert.equal(new Set(all).size,500);
 for(const item of glossaryPacks){assert.ok(item.terms.length>=39,item.id);assert.ok(item.terms.join(', ').length<=310,item.id);assert.ok(item.terms.every(term=>term===term.trim()&&term.length>0&&!/[,;\n]/.test(term)),item.id);}
 for(const term of ['행정사무감사','사무감사','감사','행감','위성곤','위원장','의원님','시장님','부시장님','국장님','질의','서귀포시','읍면동','워케이션','체납률','준공','용역','애로사항'])assert.ok(all.includes(term),term);
});
test('Given two word sets beyond 500 characters when combined then each set keeps its leading terms',()=>{
 assert.deepEqual(copy(interleaveTerms([['a1','a2','a3'],['b1']])),['a1','b1','a2','a3']);
 const budget=glossaryPacks.find(item=>item.id==='budget'),audit=glossaryPacks.find(item=>item.id==='audit');
 const result=appendGlossaryTerms('',interleaveTerms([budget.terms,audit.terms]));assert.ok(result.text.length<=500);assert.ok(result.omitted.length>0);
 for(const term of [...budget.terms.slice(0,15),...audit.terms.slice(0,15)])assert.ok(result.text.split(', ').includes(term),term);
});
const {chooseGlossaryPacks,choosePacksFromTitle,scoreGlossaryPacks}=load(path.join(root,'src/components/stream-record/glossary-auto.ts'));
test('Given council audit speech when scoring then the audit set is chosen',()=>{
 const text='위원장님, 행정사무감사 질의를 시작하겠습니다. 전년도 행정사무감사 지적사항 처리결과와 시정요구 조치결과를 자료로 제출해 주십시오. 의원님 말씀하신 애로사항은 감사위원회와 협의하겠습니다.';
 const picks=chooseGlossaryPacks(text);assert.ok(picks.length>=1&&picks.length<=2);assert.equal(picks[0].id,'audit');
});
test('Given polite thanks only when scoring then courtesy is not counted as an audit',()=>{
 assert.equal(scoreGlossaryPacks('감사합니다. 정말 감사드립니다. 감사했습니다. 감사하고요.').find(item=>item.id==='audit').hits.length,0);
});
test('Given unrelated talk when scoring then no set is chosen',()=>{
 assert.deepEqual(copy(chooseGlossaryPacks('오늘 시장에서 국수와 꿀떡을 먹었는데 국물이 시원하고 빙수 과일이 달아서 맛있었어요. 다음에도 또 오고 싶네요.')),[]);
});
test('Given a meeting title when one clear word matches then the title can choose sets',()=>{
 const picks=chooseGlossaryPacks('행정자치위원회 행정사무감사',{minHits:1});assert.ok(picks.some(item=>item.id==='audit'));assert.ok(picks.some(item=>item.id==='administration'));
 assert.deepEqual(copy(chooseGlossaryPacks('새 기록',{minHits:1})),[]);assert.deepEqual(copy(chooseGlossaryPacks('YouTube 영상 기록',{minHits:1})),[]);
});
test('Given real YouTube titles when choosing from a title then only clear meeting names count',()=>{
 const council=choosePacksFromTitle('제454회 제주특별자치도의회 임시회 제2차 행정자치위원회 행정사무감사').map(item=>item.id);
 assert.ok(council.includes('audit'));assert.ok(council.includes('administration'));assert.equal(council.includes('jeju'),false,'the institution name alone is not a topic');
 assert.deepEqual(copy(choosePacksFromTitle('제주특별자치도의회 제455회 임시회 제3차 보건복지안전위원회').map(item=>item.id)),['welfare']);
 for(const title of ['2026 03 16 생중계   더불어민주당 - 시·도당위원장협의회 회의 - 국회 본관 당대표회의실','하지말라는 먹방 대구까지 가서 하는 이채연','이 대통령, 제3차 메가프로젝트 민관합동 점검회의…정주 여건 지원안 논의 - [끝까지LIVE] MBC 중계방송 2026년 09월 29일'])assert.deepEqual(copy(choosePacksFromTitle(title)),[],title);
});
const report={passed:results.filter(item=>item.status==='passed').length,failed:results.filter(item=>item.status==='failed').length,scope:'Offline pure helper and real React component behavior; no speech inference or native capture.',tests:results};
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/glossary-packs.json'),JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;

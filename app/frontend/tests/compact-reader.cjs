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
 if(!path.extname(filename))filename+=fs.existsSync(filename+'.ts')?'.ts':'.tsx';
 if(modules.has(filename))return modules.get(filename).exports;
 const module={exports:{}};modules.set(filename,module);
 const result=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const localRequire=id=>id.endsWith('.css')?{}:id.startsWith('.')?load(path.join(path.dirname(filename),id)):require(id);
 vm.runInNewContext(result.outputText,{module,exports:module.exports,require:localRequire,console},{filename});
 return module.exports;
}
const {DictationConversation}=load(path.join(root,'src/components/stream-record/DictationConversation.tsx'));
const {LiveSummaryPanel}=load(path.join(root,'src/components/stream-record/LiveSummaryPanel.tsx'));
function fixture(video=false){
 let renderer;
 const scroll={scrollTop:0,scrollHeight:1000,clientHeight:300};
 const session={readerSessionKey:0,rows:[{sequence_id:1,text:'최초 원문',is_partial:false}],follow:true,models:[],model:'',saving:false,busy:false,audioSource:null,mode:'idle',
  correction:{enabled:true,status:'AI 연결 필요',total:0,completed:0,blocked:0,error:'',setEnabled:value=>{session.correction={...session.correction,enabled:value};render();},retry:()=>{}},diarization:{status:'원음 연결 필요',running:false,enabled:true,setEnabled:value=>{session.diarization={...session.diarization,enabled:value};render();},run:()=>{},cancel:()=>{}},
  setFollow:value=>{session.follow=value;render();},navigate:()=>{},save:()=>{},prepareAudio:()=>{},modelKey:model=>model.id,setModel:()=>{},liveSummary:'',liveSummaryEnabled:false,setLiveSummaryEnabled:()=>{},liveSummaryStatus:'대기',liveSummaryRunning:false,liveSummaryHistory:[]};
 const render=()=>renderer.update(React.createElement(DictationConversation,{session:{...session},compact:true,video}));
 act(()=>{renderer=Renderer.create(React.createElement(DictationConversation,{session:{...session},compact:true,video}),{createNodeMock:element=>element.props.role==='log'?scroll:{}});});
 return {session,scroll,get renderer(){return renderer;},update:change=>act(()=>{Object.assign(session,change);render();}),run:fn=>act(fn),close:()=>act(()=>renderer.unmount())};
}
const text=node=>typeof node==='string'?node:node.children.map(text).join('');
const button=(h,label)=>h.renderer.root.findAllByType('button').find(node=>text(node).includes(label));
const tests=[];
function test(name,fn){try{fn();tests.push({name,status:'passed'});console.log('PASS '+name);}catch(error){tests.push({name,status:'failed',error:String(error.stack)});console.error('FAIL '+name+'\n'+error.stack);}}
test('When a reader scrolls up, only new confirmed rows count as unread without moving the scroll',()=>{
 const h=fixture();try{
  h.scroll.scrollTop=80;h.run(()=>h.renderer.root.findByProps({role:'log'}).props.onScroll({currentTarget:h.scroll}));
  h.update({rows:[...h.session.rows,{sequence_id:2,text:'입력 중',is_partial:true}]});assert.equal(button(h,'새 문장'),undefined);assert.equal(h.scroll.scrollTop,80);
  h.update({rows:[h.session.rows[0],{sequence_id:2,text:'확정 발언',is_partial:false}]});assert.ok(button(h,'새 문장 1개'));assert.equal(h.scroll.scrollTop,80);
  h.update({rows:h.session.rows.map(row=>({...row}))});assert.ok(button(h,'새 문장 1개'));
 }finally{h.close();}
});
test('When latest is selected, unread is cleared and follow resumes',()=>{
 const h=fixture();try{h.update({follow:false});h.update({rows:[...h.session.rows,{sequence_id:2,text:'새 확정 문장'}]});h.run(()=>button(h,'새 문장 1개').props.onClick());assert.equal(h.session.follow,true);assert.equal(button(h,'새 문장'),undefined);assert.equal(h.scroll.scrollTop,1000);}finally{h.close();}
});
test('When a new session replaces identical row IDs, unread and stale search reset',()=>{
 const h=fixture();try{h.run(()=>h.renderer.root.findByProps({type:'search'}).props.onChange({target:{value:'없음'}}));h.update({rows:[...h.session.rows,{sequence_id:2,text:'새 확정 문장'}]});assert.ok(button(h,'새 문장 1개'));h.update({readerSessionKey:1,rows:[{sequence_id:1,text:'다른 기록'}]});assert.equal(button(h,'새 문장'),undefined);assert.equal(h.renderer.root.findByProps({type:'search'}).props.value,'');assert.ok(text(h.renderer.root.findByProps({role:'log'})).includes('다른 기록'));}finally{h.close();}
});
test('When raw or comparison is selected, preserved original and AI result remain distinct',()=>{
 const h=fixture();try{h.update({rows:[{sequence_id:1,text:'최초 원문',ai_correction:{version:1,source_text:'최초 원문',text:'AI 보정 문장',model_key:'fixture',glossary:''}}]});assert.ok(text(h.renderer.root.findByProps({role:'log'})).includes('최초 원문'));h.run(()=>button(h,'AI 보정본').props.onClick());assert.ok(text(h.renderer.root.findByProps({role:'log'})).includes('AI 보정 문장'));h.run(()=>h.renderer.root.findAllByType('label').find(node=>text(node).includes('원문 함께 보기')).findByType('input').props.onChange({target:{checked:true}}));assert.ok(text(h.renderer.root.findByProps({role:'log'})).includes('최초 원문'));h.run(()=>button(h,'실시간 원문').props.onClick());assert.ok(!text(h.renderer.root.findByProps({role:'log'})).includes('AI 보정 문장'));assert.equal(h.session.rows[0].text,'최초 원문');}finally{h.close();}
});
const checkbox=(h,label)=>h.renderer.root.findAllByType('label').find(node=>text(node)===label)?.findByType('input');
for(const video of [false,true])test(`${video?'Video':'Microphone and PC sound'} transcript options sit on the view switcher line and default on`,()=>{
 const h=fixture(video);try{
  assert.equal(h.renderer.root.findAllByType('button').some(node=>text(node).includes('전사 설정')),false);assert.equal(h.renderer.root.findAllByType('details').length,0);
  const line=h.renderer.root.findByProps({role:'group','aria-label':'대화 표시 방식'}).parent;
  assert.equal(line.findAllByProps({role:'group','aria-label':'전사 설정'}).length,1);assert.ok(line.findAllByType('label').some(node=>text(node).startsWith('대화 내용 검색')));
  assert.equal(checkbox(h,'AI 보정').props.checked,true);assert.equal(checkbox(h,'화자 구분').props.checked,true);assert.equal(checkbox(h,'원문 함께 보기'),undefined);
  h.run(()=>button(h,'AI 보정본').props.onClick());assert.ok(checkbox(h,'원문 함께 보기'));
 }finally{h.close();}
});
test('Without a correction model a notice links to AI connections, and speaker guidance follows the toggle',()=>{
 const h=fixture();try{
  const all=()=>text(h.renderer.root);
  assert.ok(all().includes('AI 후보정 모델이 지정되지 않아'));assert.ok(h.renderer.root.findAllByType('a').some(node=>node.props.href==='#ai'&&text(node).includes('보정 모델 선택')));
  assert.ok(all().includes('AI 보정과 화자 구분은 기본으로 켜져 있어 받아쓰기가 느려질 수 있습니다'));
  h.run(()=>checkbox(h,'화자 구분').props.onChange({target:{checked:false}}));assert.equal(checkbox(h,'화자 구분').props.checked,false);assert.ok(all().includes('실시간 화자 구분이 꺼져 있습니다'));
  h.run(()=>checkbox(h,'AI 보정').props.onChange({target:{checked:false}}));assert.equal(all().includes('AI 후보정 모델이 지정되지 않아'),false);assert.equal(all().includes('받아쓰기가 느려질 수 있습니다'),false);
 }finally{h.close();}
});
test('When compact summary has no connected model, generation cannot be enabled',()=>{
 const h=fixture();let summary;try{act(()=>{summary=Renderer.create(React.createElement(LiveSummaryPanel,{session:h.session,compact:true}));});assert.equal(summary.root.findByProps({type:'checkbox'}).props.disabled,true);assert.ok(summary.root.findAllByType('a').some(node=>node.props.href==='#ai'));}finally{if(summary)act(()=>summary.unmount());h.close();}
});
test('While recording, a transcribing indicator follows the last sentence and is absent when idle',()=>{
 const h=fixture(true);try{
  const indicator=()=>h.renderer.root.findAllByProps({'data-testid':'transcribing-indicator'});
  assert.equal(indicator().length,0);
  h.update({mode:'recording'});assert.equal(indicator().length,1);assert.ok(text(indicator()[0]).includes('실시간 전사 중'));
  const log=h.renderer.root.findByProps({role:'log'});const kids=log.children.filter(child=>typeof child!=='string');assert.equal(kids.at(-1).findAllByProps({'data-testid':'transcribing-indicator'}).length,1);assert.equal(kids.at(-2).findAllByType('article').length,1);
  h.update({mode:'stopping'});assert.ok(text(indicator()[0]).includes('마지막 문장'));
  h.update({mode:'idle'});assert.equal(indicator().length,0);
 }finally{h.close();}
});
test('With no sentence yet, starting shows a loading panel and recording shows a listening panel',()=>{
 const h=fixture(true);try{
  h.update({rows:[],mode:'starting'});assert.equal(h.renderer.root.findAllByProps({'data-testid':'start-loading'}).length,1);assert.ok(text(h.renderer.root.findByProps({role:'log'})).includes('녹음을 준비하고 있습니다'));
  h.update({mode:'recording'});assert.equal(h.renderer.root.findAllByProps({'data-testid':'start-loading'}).length,0);assert.equal(h.renderer.root.findAllByProps({'data-testid':'transcribing-waiting'}).length,1);
  h.update({mode:'idle'});assert.ok(text(h.renderer.root.findByProps({role:'log'})).includes('녹음을 시작하면'));
 }finally{h.close();}
});
test('Video conversation search is always visible',()=>{
 const h=fixture(true);try{
  assert.equal(h.renderer.root.findAllByType('label').filter(node=>text(node).startsWith('대화 내용 검색')).length,1);assert.equal(h.renderer.root.findAllByType('label').some(node=>text(node).startsWith('대화 검색')),false);
 }finally{h.close();}
});
test('Dictation search is named conversation content search and stays visible',()=>{
 const h=fixture(false);try{assert.equal(h.renderer.root.findAllByType('label').filter(node=>text(node).startsWith('대화 내용 검색')).length,1);}finally{h.close();}
});
const report={passed:tests.filter(test=>test.status==='passed').length,failed:tests.filter(test=>test.status==='failed').length,scope:'Offline React component behavior; no native capture or browser layout.',tests};
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/compact-reader.json'),JSON.stringify(report,null,2));
if(report.failed)process.exitCode=1;

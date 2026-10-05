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
 const scroll={scrollTop:0,scrollHeight:1000,clientHeight:300};const scrolled=[];
 const session={readerSessionKey:0,rows:[{sequence_id:1,text:'최초 원문',is_partial:false}],follow:true,models:[],model:'',saving:false,busy:false,audioSource:null,mode:'idle',
  correction:{enabled:true,status:'AI 연결 필요',total:0,completed:0,blocked:0,blockedRows:[],error:'',setEnabled:value=>{session.correction={...session.correction,enabled:value};render();},retry:()=>{}},diarization:{status:'원음 연결 필요',running:false,enabled:true,setEnabled:value=>{session.diarization={...session.diarization,enabled:value};render();},run:()=>{},cancel:()=>{}},
  setFollow:value=>{session.follow=value;render();},saveReview:async(index,sequence,value)=>{session.reviews.push({index,sequence,value});session.rows=session.rows.map((row,i)=>i===index?{...row,reviewed_text:value}:row);render();},reviews:[],setNotice:()=>{},messageOf:error=>String(error),mode:'idle',navigate:()=>{},save:()=>{},prepareAudio:()=>{},modelKey:model=>model.id,setModel:()=>{},liveSummary:'',liveSummaryEnabled:false,setLiveSummaryEnabled:()=>{},liveSummaryStatus:'대기',liveSummaryRunning:false,liveSummaryHistory:[]};
 const render=()=>renderer.update(React.createElement(DictationConversation,{session:{...session},compact:true,video}));
 act(()=>{renderer=Renderer.create(React.createElement(DictationConversation,{session:{...session},compact:true,video}),{createNodeMock:element=>element.props.role==='log'?scroll:{id:element.props.id,scrollIntoView(){scrolled.push(element.props.id);},focus(){}}});});
 return {session,scroll,scrolled,get renderer(){return renderer;},update:change=>act(()=>{Object.assign(session,change);render();}),run:fn=>act(fn),close:()=>act(()=>renderer.unmount())};
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
for(const video of [false,true])test(`${video?'Video':'Microphone and PC sound'} shows all 1001 sentences in one reader and keeps original indices through search and reveal`,()=>{
 const h=fixture(video);try{
  const rows=Array.from({length:1001},(_,index)=>({sequence_id:index+1,text:`발언 ${index+1} 확인`,is_partial:false}));
  h.update({rows,correction:{...h.session.correction,blocked:1,blockedRows:[999]}});h.update({follow:false});
  assert.equal(h.renderer.root.findAllByProps({role:'log'}).length,1);assert.equal(h.renderer.root.findAllByType('article').length,1001);
  assert.ok(text(h.renderer.root.findByProps({id:'dictation-row-0'})).includes('발언 1 확인'));assert.ok(text(h.renderer.root.findByProps({id:'dictation-row-1000'})).includes('발언 1001 확인'));
  assert.equal(button(h,'앞선 대화'),undefined);assert.equal(button(h,'다음 대화'),undefined);
  h.run(()=>h.renderer.root.findByProps({type:'search'}).props.onChange({target:{value:'발언 501 확인'}}));
  assert.equal(h.renderer.root.findAllByType('article').length,1);assert.equal(h.renderer.root.findAllByType('article')[0].props.id,'dictation-row-500');
  h.run(()=>button(h,'편집').props.onClick());assert.equal(h.renderer.root.findByType('textarea').props.value,'발언 501 확인');h.run(()=>button(h,'취소').props.onClick());
  const link=h.renderer.root.findAllByType('a').find(node=>node.props.href==='#dictation-row-999');h.run(()=>link.props.onClick({preventDefault:()=>{}}));
  assert.equal(h.renderer.root.findAllByType('article').length,1001);assert.equal(h.renderer.root.findByProps({id:'dictation-row-999'}).props['data-target'],true);assert.equal(h.scrolled.at(-1),'dictation-row-999');
  h.scroll.scrollTop=80;h.update({rows:[...rows,{sequence_id:1002,text:'새 발언 확인',is_partial:false}]});assert.equal(h.scroll.scrollTop,80);assert.equal(h.renderer.root.findAllByType('article').length,1002);assert.ok(button(h,'새 문장 1개'));
  h.run(()=>button(h,'새 문장 1개').props.onClick());assert.equal(h.session.follow,true);assert.equal(h.scroll.scrollTop,1000);
 }finally{h.close();}
});
test('Original comparison shows the saved model name without internal IDs and keeps legitimate model tags',()=>{
 const connection='dfc10000-0000-4000-8000-000000000001',revision='b73a6e4a-4a07-42d7-a3a7-a3d69f2f535b';
 const cases=[
  [`connection:${connection}:gpt-6-luna@${revision}`,'gpt-6-luna'],
  ['local:qwen3:8b','qwen3:8b'],
  ['builtin:gemma3:4b','gemma3:4b'],
  ['subscription:gpt-6-luna','gpt-6-luna'],
  ['chatgpt:gpt-6-luna','gpt-6-luna'],
  [`connection:${connection}:anthropic/claude@2026-01@${revision}`,'anthropic/claude@2026-01'],
  ['gpt-6-luna','gpt-6-luna'],
  [`connection:${connection}:`,'모델 정보 없음'],
 ];
 for(const [key,name] of cases){
  const h=fixture();try{
   h.update({rows:[{sequence_id:1,text:'최초 원문',ai_correction:{version:1,source_text:'최초 원문',text:'AI 보정 문장',model_key:key,glossary:''}}],models:[{id:'other-model',provider:'chatgpt'}],model:'other-model'});
   h.run(()=>button(h,'AI 보정본').props.onClick());h.run(()=>checkbox(h,'원문 함께 보기').props.onChange({target:{checked:true}}));
   assert.equal(text(h.renderer.root.findByType('small')),'최초 원문 · 보정 모델: '+name);
   assert.equal(h.session.rows[0].ai_correction.model_key,key);assert.equal(h.session.rows[0].text,'최초 원문');
  }finally{h.close();}
 }
});
for(const video of [false,true])test(`${video?'Video':'Microphone and PC sound'} transcript options sit on the view switcher line and default on`,()=>{
 const h=fixture(video);try{
  assert.equal(h.renderer.root.findAllByType('button').some(node=>text(node).includes('받아쓰기 설정')),false);assert.equal(h.renderer.root.findAllByType('details').length,0);
  const line=h.renderer.root.findByProps({role:'group','aria-label':'대화 표시 방식'}).parent;
  assert.equal(line.findAllByProps({role:'group','aria-label':'받아쓰기 설정'}).length,1);assert.ok(line.findAllByType('label').some(node=>text(node).startsWith('대화 내용 검색')));
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
  h.update({mode:'recording'});assert.equal(indicator().length,1);assert.ok(text(indicator()[0]).includes('실시간 받아쓰기 중'));
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
test('Kept-original correction notice names the sentence and jumps to it in the AI view',()=>{
 const h=fixture();try{
  h.update({rows:[{sequence_id:1,text:'첫 문장',is_partial:false},{sequence_id:2,text:'예산 10만원입니다.',is_partial:false,ai_correction_issue:{version:1,source_text:'예산 10만원입니다.',model_key:'fixture',glossary:'',reason:'numbers'}}],correction:{...h.session.correction,blocked:1,blockedRows:[1]}});
  const links=h.renderer.root.findAllByType('a').filter(node=>String(node.props.href).startsWith('#dictation-row-'));
  assert.deepEqual(links.map(text),['1구간','2']);assert.ok(links.every(node=>node.props.href==='#dictation-row-1'));assert.equal(links[1].props['aria-label'],'받아쓰기-2로 이동');
  const meta=h.renderer.root.findAllByType('article').map(node=>text(node));assert.ok(meta[0].includes('받아쓰기-1'));assert.ok(!meta.some(value=>/S0000/.test(value)));
  h.run(()=>links[0].props.onClick({preventDefault:()=>{}}));
  assert.equal(button(h,'AI 보정본').props['aria-pressed'],true);const target=h.renderer.root.findByProps({id:'dictation-row-1'});assert.equal(target.props['data-target'],true);assert.equal(h.session.follow,false);assert.deepEqual(h.scrolled,['dictation-row-1']);
 }finally{h.close();}
});
test('Many kept-original sentences show short linked numbers and keep exact navigation targets',()=>{
 const h=fixture();try{
  const numbered=[11,18,22,39,49,71,72,87,116,118,121,125,130,140,150];
  const blockedRows=numbered.map(number=>number-1);
  h.update({rows:Array.from({length:150},(_,index)=>({sequence_id:index+1,text:`검토할 문장 ${index+1}`,is_partial:false})),correction:{...h.session.correction,blocked:15,blockedRows}});
  const links=h.renderer.root.findAllByType('a').filter(node=>String(node.props.href).startsWith('#dictation-row-'));
  assert.deepEqual(links.map(text),['15구간',...numbered.slice(0,10).map(String)]);
  assert.deepEqual(links.slice(1).map(node=>node.props.href),blockedRows.slice(0,10).map(index=>`#dictation-row-${index}`));
  const notice=links[0].parent;assert.equal(notice.findAllByType('br').length,2);assert.ok(text(notice).includes('외 5구간'));
  h.run(()=>links[4].props.onClick({preventDefault:()=>{}}));assert.equal(button(h,'AI 보정본').props['aria-pressed'],true);assert.equal(h.renderer.root.findByProps({id:'dictation-row-38'}).props['data-target'],true);assert.deepEqual(h.scrolled,['dictation-row-38']);
 }finally{h.close();}
});
test('Each sentence has an edit button that saves a user correction and keeps the original visible',()=>{
 const h=fixture();try{
  const edit=button(h,'편집');assert.equal(edit.props['aria-label'],'받아쓰기-1 편집');
  h.run(()=>edit.props.onClick());const area=h.renderer.root.findByType('textarea');assert.equal(area.props.value,'최초 원문');assert.equal(button(h,'편집'),undefined);
  h.run(()=>area.props.onChange({target:{value:'사용자가 고친 문장'}}));
  h.run(()=>button(h,'저장').props.onClick());assert.deepEqual(h.session.reviews,[{index:0,sequence:1,value:'사용자가 고친 문장'}]);
 }finally{h.close();}
});
test('An edited sentence shows the edit, marks it, and keeps the preserved original underneath',()=>{
 const h=fixture();try{
  h.update({rows:[{sequence_id:1,text:'최초 원문',reviewed_text:'고친 문장',is_partial:false}]});
  const article=text(h.renderer.root.findAllByType('article')[0]);assert.ok(article.includes('직접 수정됨'));assert.ok(article.includes('고친 문장'));assert.ok(article.includes('최초 원문 (보존됨)'));
  h.run(()=>button(h,'편집').props.onClick());assert.equal(h.renderer.root.findByType('textarea').props.value,'고친 문장');assert.ok(button(h,'원래 받아쓰기로 되돌리기'));h.run(()=>button(h,'취소').props.onClick());assert.equal(h.renderer.root.findAllByType('textarea').length,0);
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

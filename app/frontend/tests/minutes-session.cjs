'use strict';
const assert=require('node:assert/strict');
const snapshot={version:1,title:'긴 회의',rows:[{sequence_id:1,text:'검토를 계속합니다.',is_partial:false,audio_start_time:3600}],minutes:'',startedAt:null};
const storage=()=>new Map([['stream-record.option.ai-correction','false'],['stream-record.option.live-summary','false']]);
module.exports=async({test,using,deferred})=>{
 await test('Minutes opens as a readable document and toggling the editor preserves saved Markdown and transcripts',()=>using({snapshot:{...snapshot,minutes:'# 회의 제목\n\n## 주요 논의 사항\n\n- 검토를 계속합니다.\n\n| 내용 | 담당자 | 기한 | 근거 구간 | 원문 인용 |\n|---|---|---|---|---|\n| 검토 중 | [확인 필요] | [확인 필요] | S000001 · 01:00:00 | 검토를 계속합니다. |'},storage:storage()},async h=>{
  await h.run(()=>h.session.navigate('minutes'));const original=h.session.minutes;
  const document=h.renderer.root.findByProps({'data-testid':'minutes-document'});
  assert.equal(document.findAllByType('table').length,0);assert.ok(document.findAllByType('li').length>=2);
  const quotes=document.findAllByType('details');assert.equal(quotes.length,1);assert.ok(!quotes[0].props.open);
  const button=name=>h.renderer.root.findAllByType('button').find(node=>node.children.includes(name));
  await h.run(()=>button('직접 수정').props.onClick());const field=h.renderer.root.findAllByType('textarea').find(node=>node.props.value===original);assert.ok(field);
  await h.run(()=>button('회의록 보기').props.onClick());assert.equal(h.session.minutes,original);assert.equal(h.count('ko_generate'),0);
  await h.run(()=>button('직접 수정').props.onClick());const remounted=h.renderer.root.findAllByType('textarea').find(node=>node.props.value===original);await h.run(()=>remounted.props.onChange({target:{value:original+'\n\n- 사용자가 추가한 내용'}}));
  assert.match(h.session.minutes,/사용자가 추가/);assert.equal(h.session.rows[0].text,snapshot.rows[0].text);
 }));
 await test('Minutes failure is visible inside the generation panel and preserves completed checkpoints',()=>using({snapshot,storage:storage(),overrides:{ko_models:async()=>[{id:'qa-model',provider:'chatgpt'}],ko_generate:async()=>{throw new Error('요약 연결 실패: HTTP 429');}}},async h=>{
  await h.run(()=>{h.session.setModel('chatgpt:qa-model');h.session.navigate('minutes');});
  await h.run(()=>h.session.summarize());
  const alert=h.renderer.root.findAll(node=>node.props['data-testid']==='minutes-feedback')[0];
  assert.ok(alert,'Minutes panel must show its own failed-generation explanation');
  assert.ok(alert.findAll(node=>node.children.some(child=>typeof child==='string'&&child.includes('429'))).length);
  assert.equal(h.session.mode,'idle');assert.equal(h.session.rows[0].text,snapshot.rows[0].text);assert.equal(h.session.minutes,'');
 }));
 await test('Minutes creation rejected before starting explains the missing model',()=>using({snapshot,storage:storage(),overrides:{ko_models:async()=>[]}},async h=>{
  await h.run(()=>h.session.summarize());assert.match(h.session.minutesError,/모델/);assert.equal(h.count('ko_generate'),0);
 }));
 await test('Minutes waits visibly behind an existing AI request and then completes without parallel native requests',()=>using({snapshot,storage:storage(),overrides:{ko_models:async()=>[{id:'qa-model',provider:'chatgpt'}]}},async h=>{
  const gate=deferred();h.overrides.set('ko_generate',async args=>args.stage==='notes'?gate.promise:JSON.stringify({summary:'검토 중',decisions:[],proposals:[],actions:[],numbers:[],open_questions:[]}));
  const queue=h.load('src/components/meeting-ko/generate-text.ts');let background,minutes;
  await h.run(()=>{h.session.setModel('chatgpt:qa-model');background=queue.generateText({model:'qa-model',provider:'chatgpt',stage:'notes',text:'먼저 요청'});});
  await h.run(()=>{minutes=h.session.summarize();});assert.equal(h.count('ko_generate'),1);assert.match(h.session.minutesProgress,/기다/);
  await h.run(async()=>{gate.resolve('메모');await background;await minutes;});assert.equal(h.count('ko_generate'),2);assert.match(h.session.minutes,/검토 중/);assert.equal(h.session.mode,'idle');assert.equal(h.session.minutesError,'');
 }));
};

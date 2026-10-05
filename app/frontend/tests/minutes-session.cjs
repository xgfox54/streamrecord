'use strict';
const assert=require('node:assert/strict');
const snapshot={version:1,title:'긴 회의',rows:[{sequence_id:1,text:'검토를 계속합니다.',is_partial:false,audio_start_time:3600}],minutes:'',startedAt:null};
const storage=()=>new Map([['stream-record.option.ai-correction','false'],['stream-record.option.live-summary','false']]);
module.exports=async({test,using,deferred})=>{
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

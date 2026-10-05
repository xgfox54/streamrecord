'use strict';
const assert=require('node:assert/strict');
module.exports=async function correctionTests({test,using,deferred}){
 const snapshot=rows=>({version:1,title:'correction',rows,minutes:'',startedAt:null});
 const row=(text,sequence_id=1)=>({sequence_id,text,is_partial:false});
 const answer=args=>JSON.stringify({corrections:JSON.parse(args.text).segments.map(part=>({id:part.id,text:part.text.replaceAll('회의을','회의를')}))});
 await test('AI correction is on by default and preserves Whisper originals and manual review',()=>using({snapshot:snapshot([{...row('오늘 회의을 시작합니다.'),reviewed_text:'사람이 검토한 문장'}]),overrides:{ko_generate:async args=>answer(args)}},async h=>{
  assert.equal(h.session.correction.enabled,true);await h.run(()=>{});assert.equal(h.count('ko_generate'),1);
  assert.equal(h.session.rows[0].text,'오늘 회의을 시작합니다.');assert.equal(h.session.rows[0].reviewed_text,'사람이 검토한 문장');
  assert.equal(h.session.rows[0].ai_correction.text,'오늘 회의를 시작합니다.');
  assert.equal(h.snapshots.at(-1).rows[0].ai_correction.text,'오늘 회의를 시작합니다.');
  await h.run(()=>h.session.save('transcript'));assert.ok(h.calls.filter(c=>c.command==='ko_export').at(-1).args.content.includes('회의을'));
  await h.run(()=>h.session.save('corrected'));const exported=h.calls.filter(c=>c.command==='ko_export').at(-1);assert.ok(exported.args.content.includes('[직접 수정] 사람이 검토한 문장'),'a human edit outranks the AI correction in the corrected export');assert.equal(h.session.rows[0].ai_correction.text,'오늘 회의를 시작합니다.');assert.ok(exported.args.title.endsWith('-AI보정본'));
 }));
 await test('Only final Whisper rows are corrected and finalization resumes the queue',()=>using({overrides:{ko_generate:async args=>answer(args)}},async h=>{
  await h.start();
  await h.run(()=>h.emit('transcript-update',{...row('회의을 시작합니다.'),is_partial:true}));assert.equal(h.count('ko_generate'),0);
  await h.run(()=>h.emit('transcript-update',row('회의을 시작합니다.')));await h.advance(3000);
  assert.equal(h.count('ko_generate'),1);assert.equal(h.session.rows[0].ai_correction.text,'회의를 시작합니다.');
 }));
 await test('Changing the model discards late correction responses',()=>{const gate=deferred();let request;return using({snapshot:snapshot([row('회의을 시작합니다.')]),overrides:{ko_generate:args=>{request=args;return gate.promise;}}},async h=>{
  await h.run(()=>{});assert.equal(h.session.correction.running,true);
  await h.run(()=>h.session.setModel(''));await h.run(()=>gate.resolve(answer(request)));
  assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.session.correction.running,false);
 });});
 await test('With no correction model chosen, correction stays on but shows where to choose one',()=>using({snapshot:snapshot([row('회의을 시작합니다.')])},async h=>{
  await h.run(()=>h.session.setModel(''));await h.run(()=>h.session.navigate('dictation'));
  assert.equal(h.session.correction.enabled,true);assert.equal(h.session.correction.status,'AI 연결 필요');
  const textOf=node=>typeof node==='string'?node:node.children.map(textOf).join('');
  const notice=h.renderer.root.findAllByProps({role:'status'}).find(node=>textOf(node).includes('AI 후보정 모델이 지정되지 않아'));
  assert.ok(notice);assert.ok(notice.findAllByType('a').some(node=>node.props.href==='#ai'));
 }));
 await test('Disabling correction while a request runs preserves raw data without applying its response',()=>{const gate=deferred();let request;return using({snapshot:snapshot([row('회의을 시작합니다.')]),overrides:{ko_generate:args=>{request=args;return gate.promise;}}},async h=>{
  await h.run(()=>{});
  await h.run(()=>h.session.correction.setEnabled(false));await h.run(()=>gate.resolve(answer(request)));
  assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.session.rows[0].text,'회의을 시작합니다.');
 });});
 await test('Rejected number changes preserve the row and continue correcting later batches',()=>using({snapshot:snapshot([row('회의을 10시에 시작합니다.'),...Array.from({length:5},(_,i)=>row(`회의을 진행합니다 ${i+1}.`,i+2))]),overrides:{ko_generate:async args=>answer(args).replace('10시','11시')}},async h=>{
  await h.run(()=>{});
  assert.equal(h.session.correction.error,'');assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.session.rows[0].text,'회의을 10시에 시작합니다.');assert.equal(h.session.rows[0].ai_correction_issue.reason,'numbers');
  await h.advance(3000);assert.equal(h.session.correction.completed,5);assert.equal(h.session.correction.blocked,1);assert.equal(h.snapshots.at(-1).rows[0].ai_correction_issue.reason,'numbers');
  const count=h.count('ko_generate');await h.advance(30000);assert.equal(h.count('ko_generate'),count);
  h.overrides.set('ko_generate',async args=>answer(args));await h.run(()=>h.session.correction.retry());assert.equal(h.session.correction.error,'');assert.ok(h.session.rows[0].ai_correction.text.includes('10시'));
  assert.equal(h.session.rows[0].ai_correction_issue,undefined);assert.equal(h.session.correction.completed,6);
 }));
 await test('Long utterances are fully corrected across bounded requests',()=>using({snapshot:snapshot([row('오늘 회의을 시작합니다. '.repeat(200))]),overrides:{ko_generate:async args=>answer(args)}},async h=>{
  await h.run(()=>{});
  assert.ok(h.count('ko_generate')>=2);assert.equal(h.session.correction.completed,1);assert.ok(h.session.rows[0].ai_correction.text.length>2800);
  assert.ok(h.calls.filter(c=>c.command==='ko_generate').every(c=>Array.from(c.args.text).length<=6000));
 }));
 await test('A rejected split part leaves its entire utterance raw while another utterance succeeds',()=>using({snapshot:snapshot([row('오늘 회의을 시작합니다. '.repeat(120)+' 예산 10만원입니다.'),row('회의을 마칩니다.',2)]),overrides:{ko_generate:async args=>answer(args).replace('10만원','11만원')}},async h=>{
  await h.run(()=>{});await h.advance(3000);
  assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.session.rows[0].ai_correction_issue.reason,'numbers');assert.equal(h.session.rows[1].ai_correction.text,'회의를 마칩니다.');
 }));
 await test('Saved rejected rows are not retried automatically and changed source is reconsidered',()=>using({snapshot:snapshot([{...row('예산 10만원입니다.'),ai_correction_issue:{version:1,source_text:'예산 10만원입니다.',model_key:'local:local-summary',glossary:'',reason:'numbers'}}]),overrides:{ko_generate:async args=>answer(args)}},async h=>{
  await h.advance(3000);assert.equal(h.count('ko_generate'),0);assert.equal(h.session.correction.blocked,1);
  await h.run(()=>h.session.setRows([{...h.session.rows[0],text:'예산 20만원입니다.'}]));await h.advance(3000);assert.equal(h.session.rows[0].ai_correction.text,'예산 20만원입니다.');assert.equal(h.session.rows[0].ai_correction_issue,undefined);
 }));
 await test('AI correction schema rejects missing duplicate unknown empty and truncated segments',()=>using({},async h=>{
  const {parseCorrections}=h.load(require('node:path').resolve(__dirname,'../src/components/meeting-ko/transcript-correction.ts'));
  const parts=[{id:'S000001',text:'오늘 회의는 다음 주에도 계속 진행합니다.',index:0},{id:'S000002',text:'예산 3000만 원을 검토합니다.',index:1}];
  for(const corrections of [[{id:'S000001',text:parts[0].text}],[{id:'S000001',text:parts[0].text},{id:'S000001',text:parts[0].text}],[{id:'S999999',text:parts[0].text},{id:'S000002',text:parts[1].text}],[{id:'S000001',text:''},{id:'S000002',text:parts[1].text}],[{id:'S000001',text:'회의.'},{id:'S000002',text:parts[1].text}]])assert.throws(()=>parseCorrections(JSON.stringify({corrections}),parts));
 }));
 await test('Complete conversation includes earlier segments beyond the old 80 row limit',()=>using({snapshot:snapshot(Array.from({length:205},(_,i)=>row(`회의 발언 ${i+1}`,i+1)))},async h=>{
  await h.run(()=>h.session.navigate('dictation'));assert.equal(h.renderer.root.findAllByType('article').length,205);
  assert.equal(h.renderer.root.findAllByType('button').some(node=>['앞선 대화','다음 대화'].includes(node.children.join(''))),false);
  assert.ok(h.renderer.root.findAllByType('p').some(node=>node.children.join('')==='회의 발언 1'));
  assert.ok(h.renderer.root.findAllByType('p').some(node=>node.children.join('')==='회의 발언 205'));
 }));
 await test('Restored corrections survive restart without sending a new AI request',()=>using({snapshot:snapshot([{...row('회의을 시작합니다.'),ai_correction:{version:1,source_text:'회의을 시작합니다.',model_key:'local:local-summary',glossary:'',text:'회의를 시작합니다.'}}])},async h=>{
  assert.equal(h.session.correction.completed,1);assert.equal(h.count('ko_generate'),0);await h.run(()=>h.session.correction.setEnabled(true));assert.equal(h.count('ko_generate'),0);
 }));
};

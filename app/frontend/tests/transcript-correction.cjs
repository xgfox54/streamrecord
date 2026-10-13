'use strict';
const assert=require('node:assert/strict');
module.exports=async function correctionTests({test,using,deferred}){
 const snapshot=rows=>({version:1,title:'correction',rows,minutes:'',startedAt:null});
 const row=(text,sequence_id=1)=>({sequence_id,text,is_partial:false});
 const answer=args=>JSON.stringify({corrections:JSON.parse(args.text).segments.map(part=>({id:part.id,text:part.text.replaceAll('회의을','회의를')}))});
 await test('Corrected TXT contains only final AI or reviewed text with a blank line between entries',()=>using({},async h=>{
  const {correctedTranscriptText}=h.load(require('node:path').resolve(__dirname,'../src/components/meeting-ko/transcript-correction.ts'));
  const rows=[
   {...row('최초 원문 하나'),ai_correction:{source_text:'최초 원문 하나',text:'AI 문장 하나'}},
   row('아직 보정하지 않은 원문',2),
   {...row('숫자 보정 취소 원문',3),ai_correction_issue:{source_text:'숫자 보정 취소 원문',candidate_text:'적용하지 않은 후보'}},
   {...row('원문 둘',4),reviewed_text:'직접 확인한 문장'},
   {...row('바뀐 원문',5),ai_correction:{source_text:'이전 원문',text:'오래된 보정본'}},
   {...row('입력 중 원문',6),is_partial:true,reviewed_text:'임시 수정'},
  ];
  const text=correctedTranscriptText(rows);
  assert.equal(text.split('\n\n').length,2);assert.ok(text.includes('AI 문장 하나'));assert.ok(text.includes('직접 확인한 문장'));
  for(const excluded of ['최초 원문','보정하지','보정 취소','적용하지','오래된','임시 수정'])assert.equal(text.includes(excluded),false,excluded);
  assert.equal(correctedTranscriptText([row('보정 전 원문')]),'');
  const {transcriptText}=h.load(require('node:path').resolve(__dirname,'../src/components/meeting-ko/core.ts'));
  assert.equal(transcriptText([row('문장 하나'),row('문장 둘',2)]).split('\n\n').length,2);
 }));
 await test('Saving corrected TXT before corrections exist reports the cause without exporting originals',()=>using({snapshot:snapshot([row('보정 전 원문')]),storage:new Map([['stream-record.option.transcript-correction','false']])},async h=>{
  await h.run(()=>h.session.correction.setEnabled(false));const count=h.count('ko_export');
  await h.run(()=>h.session.save('corrected'));assert.equal(h.count('ko_export'),count);assert.ok(h.session.error.includes('AI 보정본'));
 }));
 await test('AI correction is on by default and preserves Whisper originals and manual review',()=>using({snapshot:snapshot([{...row('오늘 회의을 시작합니다.'),reviewed_text:'사람이 검토한 문장'}]),overrides:{ko_generate:async args=>answer(args)}},async h=>{
  assert.equal(h.session.correction.enabled,true);await h.run(()=>{});assert.equal(h.count('ko_generate'),1);
  assert.equal(h.session.rows[0].text,'오늘 회의을 시작합니다.');assert.equal(h.session.rows[0].reviewed_text,'사람이 검토한 문장');
  assert.equal(h.session.rows[0].ai_correction.text,'오늘 회의를 시작합니다.');
  assert.equal(h.snapshots.at(-1).rows[0].ai_correction.text,'오늘 회의를 시작합니다.');
  await h.run(()=>h.session.save('transcript'));assert.ok(h.calls.filter(c=>c.command==='ko_export').at(-1).args.content.includes('회의을'));
  await h.run(()=>h.session.save('corrected'));const exported=h.calls.filter(c=>c.command==='ko_export').at(-1);assert.ok(exported.args.content.includes('[직접 수정] 사람이 검토한 문장'),'a human edit outranks the AI correction in the corrected export');assert.equal(h.session.rows[0].ai_correction.text,'오늘 회의를 시작합니다.');assert.ok(exported.args.title.endsWith('-AI보정본'));
 }));
 await test('A full 3000-character dictionary reaches every correction batch without additional requests or raw-STT hints',()=>using({overrides:{ko_generate:async args=>answer(args)}},async h=>{
  const {glossaryPacks}=h.load(require('node:path').resolve(__dirname,'../src/components/stream-record/glossary-packs.ts'));
  const glossary=glossaryPacks.find(pack=>pack.id==='audit').terms.join(', ');assert.equal(glossary.length,3000);
  await h.run(()=>h.session.setGlossary(glossary));
  const field=h.renderer.root.findAllByType('input').find(node=>node.props.value===glossary);assert.ok(field);assert.equal(field.props.maxLength,3000);
  await h.start();assert.equal(Object.hasOwn(h.calls.find(call=>call.command==='ko_start_recording').args,'glossary'),false);
  await h.run(()=>h.session.setRows(Array.from({length:8},(_,i)=>row('오늘 회의을 시작합니다.',i+1))));
  await h.advance(3000);await h.advance(3000);
  const calls=h.calls.filter(call=>call.command==='ko_generate'&&call.args.stage==='correction');assert.equal(calls.length,2);
  for(const call of calls){const data=JSON.parse(call.args.text);assert.equal(data.glossary,glossary);assert.ok(data.glossary.includes(glossary.split(', ').at(-1)));assert.equal(data.segments.length,4);assert.ok(call.args.text.length<=6000);}
  assert.equal(h.session.rows.length,8);for(const result of h.session.rows){assert.equal(result.text,'오늘 회의을 시작합니다.');assert.equal(result.ai_correction.glossary,glossary);}
  await h.advance(30000);assert.equal(h.count('ko_generate'),2);assert.equal(h.count('ko_update_stt_glossary'),0);assert.equal(h.snapshots.at(-1).glossary,glossary);
 }));
 await test('Only final Whisper rows are corrected and finalization resumes the queue',()=>using({overrides:{ko_generate:async args=>answer(args)}},async h=>{
  await h.start();
  await h.run(()=>h.emit('transcript-update',{...row('회의을 시작합니다.'),is_partial:true}));assert.equal(h.count('ko_generate'),0);
  await h.run(()=>h.emit('transcript-update',row('회의을 시작합니다.')));await h.advance(3000);
  assert.equal(h.count('ko_generate'),1);assert.equal(h.session.rows[0].ai_correction.text,'회의를 시작합니다.');
 }));
 await test('Changing the model discards late correction responses',()=>{const gate=deferred();let request;return using({snapshot:snapshot([row('회의을 시작합니다.')]),overrides:{ko_generate:args=>{request=args;return gate.promise;}}},async h=>{
  await h.run(()=>{});assert.equal(h.session.correction.running,true);
  assert.deepEqual(Array.from(h.session.correction.runningRows),[0]);
  await h.run(()=>h.session.setModel(''));assert.deepEqual(Array.from(h.session.correction.runningRows),[]);await h.run(()=>gate.resolve(answer(request)));
  assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.session.correction.running,false);
 });});
 await test('With no correction model chosen, correction stays on but shows where to choose one',()=>using({snapshot:snapshot([row('회의을 시작합니다.')])},async h=>{
  await h.run(()=>h.session.setModel(''));await h.run(()=>h.session.navigate('dictation'));
  assert.equal(h.session.correction.enabled,true);assert.equal(h.session.correction.status,'AI 연결 필요');
  const textOf=node=>typeof node==='string'?node:node.children.map(textOf).join('');
  const notice=h.renderer.root.findAllByProps({role:'status'}).find(node=>textOf(node).includes('AI 연결 필요'));
  assert.ok(notice);assert.ok(notice.findAllByType('a').some(node=>node.props.href==='#ai'));
 }));
 await test('Disabling correction while a request runs preserves raw data without applying its response',()=>{const gate=deferred();let request;return using({snapshot:snapshot([row('회의을 시작합니다.')]),overrides:{ko_generate:args=>{request=args;return gate.promise;}}},async h=>{
  await h.run(()=>{});
  await h.run(()=>h.session.correction.setEnabled(false));assert.deepEqual(Array.from(h.session.correction.runningRows),[]);await h.run(()=>gate.resolve(answer(request)));
  assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.session.rows[0].text,'회의을 시작합니다.');
 });});
 await test('Only the active correction batch shows sentence progress, which clears on completion',()=>{const gate=deferred();let request;let calls=0;return using({snapshot:snapshot([...Array.from({length:6},(_,i)=>row(`회의을 진행합니다 ${i+1}.`,i+1)),{...row('입력 중',7),is_partial:true}]),overrides:{ko_generate:args=>{calls++;if(calls===1){request=args;return gate.promise;}return answer(args);}}},async h=>{
  await h.run(()=>h.session.navigate('dictation'));
  assert.deepEqual(Array.from(h.session.correction.runningRows),[0,1,2,3]);
  const indicators=()=>h.renderer.root.findAllByProps({'data-testid':'correcting-indicator'});
  assert.equal(indicators().length,4);assert.ok(indicators().every(node=>node.parent.parent.children[0]==='보정 전 원문'));
  assert.equal(h.renderer.root.findByProps({id:'dictation-row-4'}).findAllByProps({'data-testid':'correcting-indicator'}).length,0);
  assert.equal(h.renderer.root.findByProps({id:'dictation-row-6'}).findAllByProps({'data-testid':'correcting-indicator'}).length,0);
  await h.run(()=>gate.resolve(answer(request)));assert.equal(indicators().length,0);assert.deepEqual(Array.from(h.session.correction.runningRows),[]);
  await h.advance(3000);assert.equal(h.session.correction.completed,6);assert.equal(indicators().length,0);
 });});
 await test('Disabling AI correction leaves legacy candidates unapplied until enabled',()=>using({storage:new Map([['stream-record.option.ai-correction','false']]),snapshot:snapshot([{...row('예산 10만원입니다.'),ai_correction_issue:{version:1,source_text:'예산 10만원입니다.',model_key:'local:local-summary',glossary:'',reason:'numbers',candidate_text:'예산 11만원입니다.'}}])},async h=>{
  await h.run(()=>{});assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.count('ko_generate'),0);
  await h.run(()=>h.session.correction.setEnabled(true));assert.equal(h.session.rows[0].ai_correction.text,'예산 11만원입니다.');assert.equal(h.count('ko_generate'),0);
 }));
 await test('Number changes are applied with a warning and later batches continue',()=>using({snapshot:snapshot([row('회의을 10시에 시작합니다.'),...Array.from({length:5},(_,i)=>row(`회의을 진행합니다 ${i+1}.`,i+2))]),overrides:{ko_generate:async args=>answer(args).replace('10시','11시')}},async h=>{
  await h.run(()=>{});
  assert.equal(h.session.correction.error,'');assert.equal(h.session.rows[0].ai_correction.text,'회의를 11시에 시작합니다.');assert.equal(h.session.rows[0].text,'회의을 10시에 시작합니다.');assert.equal(h.session.rows[0].ai_correction_issue.reason,'numbers');
  await h.advance(3000);assert.equal(h.session.correction.completed,6);assert.equal(h.session.correction.blocked,1);assert.equal(h.snapshots.at(-1).rows[0].ai_correction_issue.reason,'numbers');
  const count=h.count('ko_generate');await h.advance(30000);assert.equal(h.count('ko_generate'),count);
  await h.run(()=>h.session.correction.retry());assert.equal(h.count('ko_generate'),count);assert.ok(h.session.correction.status.startsWith('전체 보정 완료'));
  await h.run(()=>h.session.save('corrected'));assert.ok(h.calls.filter(c=>c.command==='ko_export').at(-1).args.content.includes('11시'));
 }));
 await test('Long utterances are fully corrected across bounded requests',()=>using({snapshot:snapshot([row('오늘 회의을 시작합니다. '.repeat(200))]),overrides:{ko_generate:async args=>answer(args)}},async h=>{
  await h.run(()=>{});
  assert.ok(h.count('ko_generate')>=2);assert.equal(h.session.correction.completed,1);assert.ok(h.session.rows[0].ai_correction.text.length>2800);
  assert.ok(h.calls.filter(c=>c.command==='ko_generate').every(c=>Array.from(c.args.text).length<=6000));
 }));
 await test('Automatic application preserves original and human review without an override button',()=>using({snapshot:snapshot([{...row('회의을 10시에 시작합니다.'),reviewed_text:'직접 검토한 문장'}]),overrides:{ko_generate:async args=>answer(args).replace('10시','11시')}},async h=>{
  await h.run(()=>{});await h.run(()=>h.session.navigate('dictation'));
  const calls=h.count('ko_generate');assert.equal(h.renderer.root.findAllByType('button').some(node=>node.children.join('')==='무시하고 보정 처리'),false);
  assert.equal(h.session.rows[0].text,'회의을 10시에 시작합니다.');assert.equal(h.session.rows[0].reviewed_text,'직접 검토한 문장');assert.equal(h.session.rows[0].ai_correction.text,'회의를 11시에 시작합니다.');assert.equal(h.session.correction.completed,1);
  const saved=h.snapshots.at(-1);assert.equal(saved.rows[0].ai_correction.text,'회의를 11시에 시작합니다.');assert.equal(saved.rows[0].ai_correction_issue.reason,'numbers');
  const {readRows}=h.load(require('node:path').resolve(__dirname,'../src/components/meeting-ko/core.ts'));assert.equal(readRows(saved.rows)[0].ai_correction.text,'회의를 11시에 시작합니다.');
  await h.advance(30000);assert.equal(h.count('ko_generate'),calls);
  await h.run(()=>h.session.save('corrected'));assert.ok(h.calls.filter(c=>c.command==='ko_export').at(-1).args.content.includes('직접 검토한 문장'));
 }));
 await test('Split and shortened responses are applied completely and survive restoration',()=>using({snapshot:snapshot([row('오늘 회의을 시작합니다. '.repeat(120)+' 예산 10만원입니다.'),row('다음 회의에서 안건을 충분히 논의하고 검토한 결과를 공유합니다.',2)]),overrides:{ko_generate:async args=>JSON.stringify({corrections:JSON.parse(args.text).segments.map(part=>({id:part.id,text:part.id==='S000002'?'공유.':part.text.replaceAll('회의을','회의를').replace('10만원','11만원')}))})}},async h=>{
  await h.run(()=>{});await h.advance(3000);assert.equal(h.session.correction.blocked,2);
  const {readRows}=h.load(require('node:path').resolve(__dirname,'../src/components/meeting-ko/core.ts'));const restored=readRows(h.snapshots.at(-1).rows);assert.ok(restored[0].ai_correction_issue.candidate_text.includes('11만원'));assert.ok(restored[0].ai_correction_issue.candidate_text.length>1400);
  await h.run(()=>h.session.setRows(restored));const count=h.count('ko_generate');await h.advance(3000);assert.equal(h.count('ko_generate'),count);assert.equal(h.session.correction.completed,2);assert.equal(h.session.rows[1].ai_correction.text,'공유.');assert.equal(h.session.rows[0].ai_correction.text,restored[0].ai_correction_issue.candidate_text);assert.equal(h.session.rows[0].text,restored[0].text);
 }));
 await test('Legacy rows without candidates resume automatically and still reject malformed IDs',()=>using({snapshot:snapshot([{...row('예산 10만원입니다.'),ai_correction_issue:{version:1,source_text:'예산 10만원입니다.',model_key:'local:local-summary',glossary:'',reason:'numbers'}}]),overrides:{ko_generate:async()=>JSON.stringify({corrections:[{id:'S999999',text:'예산 11만원입니다.'}]})}},async h=>{
  await h.run(()=>{});assert.equal(h.count('ko_generate'),1);assert.ok(h.session.correction.error.includes('ID'));assert.equal(h.session.rows[0].ai_correction,undefined);assert.deepEqual(Array.from(h.session.correction.runningRows),[]);
  h.overrides.set('ko_generate',async()=>JSON.stringify({corrections:[{id:'S000001',text:'예산 11만원입니다.'}]}));await h.run(()=>h.session.correction.retry());assert.equal(h.session.rows[0].ai_correction.text,'예산 11만원입니다.');assert.equal(h.session.rows[0].text,'예산 10만원입니다.');assert.equal(h.session.correction.completed,1);
 }));
 await test('Retries do not duplicate an in-flight request and stale responses cannot apply to a changed source',()=>{const gate=deferred();const next=deferred();let requests=0;return using({snapshot:snapshot([row('예산 10만원입니다.')]),overrides:{ko_generate:()=>++requests===1?gate.promise:next.promise}},async h=>{
  await h.run(()=>{});assert.equal(h.session.correction.running,true);await h.run(()=>h.session.correction.retry());assert.equal(h.count('ko_generate'),1);
  await h.run(()=>h.session.setRows([{...h.session.rows[0],text:'예산 20만원입니다.'}]));await h.run(()=>gate.resolve(JSON.stringify({corrections:[{id:'S000001',text:'예산 11만원입니다.'}]})));assert.equal(h.session.rows[0].ai_correction,undefined);assert.equal(h.session.rows[0].text,'예산 20만원입니다.');
  await h.run(()=>next.resolve(JSON.stringify({corrections:[{id:'S000001',text:'예산 20만 원입니다.'}]})));assert.equal(h.session.rows[0].ai_correction.text,'예산 20만 원입니다.');
 });});
 await test('Number changes in a split part are applied to the complete utterance while another utterance succeeds',()=>using({snapshot:snapshot([row('오늘 회의을 시작합니다. '.repeat(120)+' 예산 10만원입니다.'),row('회의을 마칩니다.',2)]),overrides:{ko_generate:async args=>answer(args).replace('10만원','11만원')}},async h=>{
  await h.run(()=>{});await h.advance(3000);
  assert.ok(h.session.rows[0].ai_correction.text.includes('11만원'));assert.equal(h.session.rows[0].ai_correction_issue.reason,'numbers');assert.equal(h.session.rows[1].ai_correction.text,'회의를 마칩니다.');
 }));
 await test('Saved candidates are applied automatically without another request and changed source is reconsidered',()=>using({snapshot:snapshot([{...row('예산 10만원입니다.'),ai_correction_issue:{version:1,source_text:'예산 10만원입니다.',model_key:'local:local-summary',glossary:'',reason:'numbers',candidate_text:'예산 11만원입니다.'}}]),overrides:{ko_generate:async args=>answer(args)}},async h=>{
  await h.advance(3000);assert.equal(h.count('ko_generate'),0);assert.equal(h.session.rows[0].ai_correction.text,'예산 11만원입니다.');assert.equal(h.session.correction.completed,1);
  await h.run(()=>h.session.setRows([{...h.session.rows[0],text:'예산 20만원입니다.'}]));await h.advance(3000);assert.equal(h.session.rows[0].ai_correction.text,'예산 20만원입니다.');assert.equal(h.session.rows[0].ai_correction_issue,undefined);
 }));
 await test('AI correction schema rejects missing duplicate unknown and empty segments but accepts length changes',()=>using({},async h=>{
  const {parseCorrections}=h.load(require('node:path').resolve(__dirname,'../src/components/meeting-ko/transcript-correction.ts'));
  const parts=[{id:'S000001',text:'오늘 회의는 다음 주에도 계속 진행합니다.',index:0},{id:'S000002',text:'예산 3000만 원을 검토합니다.',index:1}];
  for(const corrections of [[{id:'S000001',text:parts[0].text}],[{id:'S000001',text:parts[0].text},{id:'S000001',text:parts[0].text}],[{id:'S999999',text:parts[0].text},{id:'S000002',text:parts[1].text}],[{id:'S000001',text:''},{id:'S000002',text:parts[1].text}]])assert.throws(()=>parseCorrections(JSON.stringify({corrections}),parts));
  assert.equal(parseCorrections(JSON.stringify({corrections:[{id:'S000001',text:'회의.'},{id:'S000002',text:'예산 4000만 원을 검토합니다.'}]}),parts).get('S000001'),'회의.');
 }));
 await test('Complete conversation includes earlier segments beyond the old 80 row limit',()=>using({snapshot:snapshot(Array.from({length:205},(_,i)=>row(`회의 발언 ${i+1}`,i+1)))},async h=>{
  await h.run(()=>h.session.navigate('dictation'));assert.equal(h.renderer.root.findAllByType('article').length,205);
  assert.equal(h.renderer.root.findAllByType('button').some(node=>['앞선 대화','다음 대화'].includes(node.children.join(''))),false);
  assert.ok(h.renderer.root.findAllByType('button').some(node=>node.children.join('')==='회의 발언 1'));
  assert.ok(h.renderer.root.findAllByType('button').some(node=>node.children.join('')==='회의 발언 205'));
 }));
 await test('Restored corrections survive restart without sending a new AI request',()=>using({snapshot:snapshot([{...row('회의을 시작합니다.'),ai_correction:{version:1,source_text:'회의을 시작합니다.',model_key:'local:local-summary',glossary:'',text:'회의를 시작합니다.'}}])},async h=>{
  assert.equal(h.session.correction.completed,1);assert.equal(h.count('ko_generate'),0);await h.run(()=>h.session.correction.setEnabled(true));assert.equal(h.count('ko_generate'),0);
 }));
};

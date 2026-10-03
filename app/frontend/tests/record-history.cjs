'use strict';
const assert=require('node:assert/strict');
module.exports=async({test,using,deferred})=>{
 const first={version:1,recordId:'record-one',title:'첫 기록',rows:[{sequence_id:1,text:'최초 원문',reviewed_text:'직접 검토',is_partial:false}],minutes:'첫 회의록',startedAt:null,videoUrl:'',glossary:'용어',liveSummary:'첫 요약',audioPath:'original.wav'};
 const second={version:1,recordId:'record-two',title:'둘째 기록',rows:[{sequence_id:1,text:'다른 원문',is_partial:false}],minutes:'둘째 회의록',startedAt:null};
 const audio={path:'original.wav',sha256:'a'.repeat(64),duration_seconds:30};
 const connectAudio=async h=>{h.overrides.set('ko_open_review_audio',async()=>audio);await h.run(()=>h.session.prepareAudio(false));assert.equal(h.session.audioSource.sha256,audio.sha256);};
 await test('Opening another record clears cancelled diarization status and error without changing either transcript',()=>using({snapshot:first,records:[first,second]},async h=>{
  await connectAudio(h);h.overrides.set('ko_run_diarization',async()=>{throw new Error('화자분리를 취소했습니다.');});
  await h.run(h.session.diarization.run);assert.match(h.session.diarization.status,/취소/);assert.match(h.session.error,/취소/);
  await h.run(()=>h.session.openRecord('record-one'));assert.match(h.session.diarization.status,/취소/);
  await h.run(()=>assert.rejects(h.session.openRecord('missing'),/record missing/));assert.match(h.session.diarization.status,/취소/);assert.match(h.session.error,/취소/);
  await h.run(()=>h.session.openRecord('record-two'));
  assert.doesNotMatch(h.session.diarization.status,/취소|완료 안 됨/);assert.equal(h.session.error,'');assert.equal(h.session.rows[0].text,'다른 원문');
  await h.run(()=>h.session.openRecord('record-one'));assert.equal(h.session.rows[0].text,'최초 원문');assert.equal(h.session.rows[0].reviewed_text,'직접 검토');assert.equal(h.session.error,'');
 }));
 await test('A new record does not inherit the previous successful speaker analysis status',()=>using({snapshot:first,records:[first]},async h=>{
  await connectAudio(h);h.overrides.set('ko_run_diarization',async()=>({modelId:'fixture',modelRevision:'fixture',engineRevision:'fixture',audioSha256:audio.sha256,segments:[{start:0,end:10,speaker:1}]}));
  await h.run(h.session.diarization.run);assert.match(h.session.diarization.status,/1명 화자 추정/);
  await h.run(h.session.newRecord);assert.doesNotMatch(h.session.diarization.status,/1명 화자 추정/);assert.equal(h.session.rows.length,0);assert.equal(h.session.audioSource,null);
 }));
 await test('Record switching saves edits and restores separate transcripts minutes and summary',()=>using({snapshot:first,records:[first,second]},async h=>{
  await h.run(()=>h.session.setTitle('수정한 제목'));await h.run(()=>h.session.openRecord('record-two'));
  assert.equal(h.session.activeRecordId,'record-two');assert.equal(h.session.rows[0].text,'다른 원문');assert.equal(h.session.minutes,'둘째 회의록');
  await h.run(()=>h.session.openRecord('record-one'));assert.equal(h.session.title,'수정한 제목');assert.equal(h.session.rows[0].text,'최초 원문');assert.equal(h.session.rows[0].reviewed_text,'직접 검토');assert.equal(h.session.liveSummary,'첫 요약');assert.equal(h.session.consent,false);
 }));
 await test('Failed save prevents record loading or clearing the current transcript',()=>using({snapshot:first,records:[second]},async h=>{
  h.overrides.set('ko_save_snapshot',async()=>{throw new Error('disk full');});await h.run(()=>assert.rejects(h.session.openRecord('record-two'),/disk full/));assert.equal(h.count('ko_load_record'),0);assert.equal(h.session.activeRecordId,'record-one');assert.equal(h.session.rows[0].text,'최초 원문');assert.equal(h.session.mode,'idle');
 }));
 await test('Missing or mismatched target leaves current record and corrections intact',()=>using({snapshot:first},async h=>{
  await h.run(()=>assert.rejects(h.session.openRecord('missing'),/record missing/));h.overrides.set('ko_load_record',async()=>second);await h.run(()=>assert.rejects(h.session.openRecord('wrong-id'),/식별자/));assert.equal(h.session.activeRecordId,'record-one');assert.equal(h.session.rows[0].reviewed_text,'직접 검토');
 }));
 await test('Active recording rejects new or existing record switches',()=>using({},async h=>{
  await h.start();await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'녹음 원문',is_partial:false}));await h.run(()=>assert.rejects(h.session.newRecord(),/진행 중/));await h.run(()=>assert.rejects(h.session.openRecord('record-two'),/진행 중/));assert.equal(h.session.mode,'recording');assert.equal(h.session.rows[0].text,'녹음 원문');assert.equal(h.count('ko_stop_recording'),0);
 }));
 await test('Pending save blocks duplicate record switches and capture until transition completes',()=>using({snapshot:first,records:[second]},async h=>{
  const gate=deferred();h.overrides.set('ko_load_record',()=>gate.promise);let opening;await h.run(()=>{opening=h.session.openRecord('record-two');});assert.equal(h.session.busy,true);await h.run(()=>assert.rejects(h.session.newRecord(),/여는 중/));await h.run(()=>h.session.start('Microphone','started'));assert.equal(h.count('ko_start_recording'),0);const before=h.count('ko_save_snapshot');await h.advance(10000);assert.equal(h.count('ko_save_snapshot'),before);await h.run(async()=>{gate.resolve(second);await opening;});assert.equal(h.session.activeRecordId,'record-two');assert.equal(h.session.busy,false);assert.equal(h.snapshots.at(-1).recordId,'record-two');
 }));
 await test('New record resets content and permission while keeping prior record accessible',()=>using({snapshot:first,records:[first]},async h=>{
  await h.run(()=>h.session.setConsent(true));await h.run(h.session.newRecord);assert.notEqual(h.session.activeRecordId,'record-one');assert.equal(h.session.rows.length,0);assert.equal(h.session.minutes,'');assert.equal(h.session.consent,false);assert.equal(h.session.glossary,'용어');await h.run(()=>h.session.openRecord('record-one'));assert.equal(h.session.rows[0].text,'최초 원문');
 }));
};

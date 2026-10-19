'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./stream-record-ui.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const storage=()=>new Map(['ai-correction','live-summary','live-diarization'].map(name=>['stream-record.option.'+name,'false']));
async function using(fn){const h=harness({storage:storage(),overrides:{ko_cancel_recording:async()=>{}}});await h.mount();try{await h.start();await fn(h);}finally{await h.unmount();}}
const button=(h,label)=>h.renderer.root.findAllByType('button').find(node=>node.children.includes(label));
const cases=[
 ['Cancel live recording without invoking stop or exporting and ignore late recording events',()=>using(async h=>{
  await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'이미 받은 원문',is_partial:false}));
  assert.ok(button(h,'녹음 취소'));await h.run(()=>h.session.cancelRecording());
  assert.equal(h.count('ko_cancel_recording'),1);assert.equal(h.count('ko_stop_recording'),0);assert.equal(h.count('ko_export'),0);assert.equal(h.session.mode,'idle');
  await h.run(()=>{h.emit('transcript-update',{sequence_id:2,text:'늦은 결과',is_partial:false});h.emit('recording-saved',{audio_file:'late.mp4'});});
  assert.equal(h.session.rows.length,1);assert.equal(h.session.rows[0].text,'이미 받은 원문');assert.match(h.session.notice,/취소/);
 })],
 ['Cancel pending stop promptly and ignore its late success after a new recording begins',()=>using(async h=>{
  const gate=deferred();h.overrides.set('ko_stop_recording',()=>gate.promise);let stop;
  await h.run(()=>{stop=h.session.stop();});assert.equal(h.session.mode,'stopping');assert.ok(button(h,'저장 취소'));
  await h.run(()=>h.session.cancelRecording());assert.equal(h.session.mode,'idle');
  await h.start();const exports=h.count('ko_export');await h.run(async()=>{gate.resolve();await stop;});
  assert.equal(h.session.mode,'recording');assert.equal(h.count('ko_export'),exports);assert.equal(h.session.stopFailure,'');
 })],
 ['Cancellation suppresses a late stop error and allows exit without waiting for it',()=>using(async h=>{
  const gate=deferred();h.overrides.set('ko_stop_recording',()=>gate.promise);let stop;
  await h.run(()=>{stop=h.session.stop();});await h.run(()=>h.session.cancelRecording(true));
  assert.equal(h.count('ko_exit_app'),1);assert.equal(h.session.mode,'idle');
  await h.run(async()=>{gate.reject(new Error('cancelled native stop'));await stop;});assert.equal(h.session.error,'');assert.equal(h.session.stopFailure,'');
 })],
 ['Double cancellation sends one native command and failed cancellation remains retryable',()=>using(async h=>{
  const gate=deferred();h.overrides.set('ko_cancel_recording',()=>gate.promise);let cancel;
  await h.run(()=>{cancel=h.session.cancelRecording();});await h.run(()=>h.session.cancelRecording());assert.equal(h.count('ko_cancel_recording'),1);
  await h.run(async()=>{gate.reject(new Error('device cleanup failed'));await cancel;});assert.match(h.session.error,/device cleanup failed/);
  h.overrides.set('ko_cancel_recording',async()=>{});await h.run(()=>h.session.cancelRecording());assert.equal(h.session.mode,'idle');assert.equal(h.count('ko_cancel_recording'),2);
 })],
 ['Cancellation remains available from every workspace view and for YouTube capture',()=>using(async h=>{
  for(const view of ['recording','dictation','youtube','transcript','minutes','ai','settings']){await h.run(()=>h.session.navigate(view));assert.ok(button(h,'녹음 취소'),view);}
  await h.run(()=>h.session.cancelRecording());await h.run(()=>{h.session.setConsent(true);h.session.setVideoUrl('https://www.youtube.com/watch?v=abc12345678');});
  await h.run(()=>h.session.startVideo());assert.equal(h.session.mode,'recording');await h.run(()=>h.session.cancelRecording());assert.equal(h.session.mode,'idle');
 })],
];
(async()=>{let failed=0;for(const [name,test] of cases){try{await test();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}if(failed)process.exitCode=1;})();

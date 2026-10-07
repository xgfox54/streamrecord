'use strict';
const assert=require('node:assert/strict');
const copy=value=>JSON.parse(JSON.stringify(value));
const row=(id,start,end,text='원문 발언')=>({sequence_id:id,text,is_partial:false,audio_start_time:start,audio_end_time:end});
const windowResult=(index,start,end,segments)=>({checkpointIndex:index,windowStartSeconds:start,windowEndSeconds:end,modelId:'nemotron-test',modelRevision:'fixture',engineRevision:'fixture',segments});
const assignment=r=>copy(r.speaker_assignment?.speakers||[]);
module.exports=async({test,using,deferred})=>{
 await test('Live polling persists provisional IDs, reuses overlap and labels late final rows without editing corrections',()=>using({},async h=>{
  let result=null;
  h.overrides.set('ko_poll_live_diarization',async()=>result);
  await h.start();
  await h.run(()=>h.emit('transcript-update',row(1,1,4)));
  result=windowResult(0,0,30,[{start:1,end:10,speaker:1},{start:12,end:20,speaker:2}]);
  await h.advance(3000);
  assert.deepEqual(assignment(h.session.rows[0]),[1]);
  assert.equal(h.session.rows[0].speaker_assignment.provisional,true);
  assert.deepEqual(assignment(h.snapshots.at(-1).rows[0]),[1]);
  await h.run(()=>h.emit('transcript-update',{...row(2,32,35),reviewed_text:'사람이 검토한 원문',ai_correction:{version:1,source_text:'원문 발언',model_key:'local:local-summary',glossary:'',text:'AI 보정 발언'}}));
  result=windowResult(1,0,60,[{start:1,end:10,speaker:2},{start:12,end:20,speaker:1},{start:31,end:40,speaker:2},{start:42,end:50,speaker:1}]);
  await h.advance(3000);
  assert.deepEqual(assignment(h.session.rows[1]),[1]);
  assert.equal(h.session.rows[1].text,'원문 발언');
  assert.equal(h.session.rows[1].reviewed_text,'사람이 검토한 원문');
  assert.equal(h.session.rows[1].ai_correction.text,'AI 보정 발언');
  await h.run(()=>h.emit('transcript-update',row(3,44,46)));
  assert.deepEqual(assignment(h.session.rows[2]),[2]);
  assert.equal(h.calls.filter(c=>c.command==='ko_poll_live_diarization').at(-1).args.afterCheckpoint,0);
 }));
 await test('Periodic whole-recording inference relabels unassigned rows and resumes after the snapshot cursor',()=>using({},async h=>{
  let fullCalls=0;
  h.overrides.set('ko_poll_live_diarization',async args=>{
   if(args.full){fullCalls++;return windowResult(11,0,360,[{start:1,end:10,speaker:1},{start:302,end:310,speaker:1}]);}
   if(args.afterCheckpoint>=3)return null;
   const index=args.afterCheckpoint+1;return windowResult(index,Math.max(0,(index-1)*30),(index+1)*30,[{start:index*30+1,end:index*30+10,speaker:1}]);
  });
  await h.start();for(let i=0;i<3;i++)await h.advance(3000);
  await h.run(()=>h.emit('transcript-update',row(1,302,305)));
  assert.equal(h.session.rows[0].speaker_assignment,undefined);
  await h.advance(300000);assert.equal(fullCalls,1);
  assert.deepEqual(assignment(h.session.rows[0]),[1]);
  await h.advance(3000);
  assert.equal(h.calls.filter(c=>c.command==='ko_poll_live_diarization').at(-1).args.afterCheckpoint,11);
  await h.advance(3000);assert.equal(fullCalls,1,'whole analysis does not run every poll');
 }));
 await test('Stopping discards pending whole-recording results and cancels the native job',()=>using({},async h=>{
  const gate=deferred();
  h.overrides.set('ko_poll_live_diarization',async args=>args.full?gate.promise:windowResult(3,60,120,[]));
  h.overrides.set('ko_cancel_diarization',async()=>{});
  await h.start();await h.advance(300000);
  await h.run(()=>h.emit('transcript-update',row(1,1,4)));
  await h.run(h.session.stop);assert.equal(h.count('ko_cancel_diarization'),1);
  await h.run(()=>gate.resolve(windowResult(11,0,360,[{start:1,end:10,speaker:1}])));
  assert.equal(h.session.rows[0].speaker_assignment,undefined);
 }));
 await test('Failed live inference waits 30 seconds and retries the same cursor while transcription continues',()=>using({},async h=>{
  h.overrides.set('ko_poll_live_diarization',async()=>{throw new Error('missing local model');});
  await h.start();assert.equal(h.count('ko_poll_live_diarization'),1);
  await h.advance(3000);assert.equal(h.count('ko_poll_live_diarization'),1);
  await h.run(()=>h.emit('transcript-update',row(1,1,4)));
  assert.equal(h.session.rows[0].text,'원문 발언');assert.equal(h.session.mode,'recording');
  await h.advance(27000);assert.equal(h.count('ko_poll_live_diarization'),2);
  assert.equal(h.calls.filter(c=>c.command==='ko_poll_live_diarization').at(-1).args.afterCheckpoint,-1);
 }));
 await test('A malformed live response cannot consume the checkpoint or modify raw rows',()=>using({},async h=>{
  let result=null;h.overrides.set('ko_poll_live_diarization',async()=>result);await h.start();
  await h.run(()=>h.emit('transcript-update',row(1,1,4)));
  result=windowResult(0,0,30,[{start:1,end:45,speaker:1}]);await h.advance(3000);
  assert.equal(h.session.rows[0].speaker_assignment,undefined);
  result=windowResult(0,0,30,[{start:1,end:10,speaker:1}]);await h.advance(30000);
  assert.deepEqual(assignment(h.session.rows[0]),[1]);
  assert.equal(h.calls.filter(c=>c.command==='ko_poll_live_diarization').at(-1).args.afterCheckpoint,-1);
 }));
 await test('Stop and restart cancel pending live inference and discard its late result from the next recording',()=>using({},async h=>{
  const gate=deferred();h.overrides.set('ko_poll_live_diarization',()=>gate.promise);
  h.overrides.set('ko_cancel_diarization',async()=>{});
  await h.start();assert.equal(h.count('ko_poll_live_diarization'),1);
  await h.run(()=>h.emit('transcript-update',row(1,1,4,'지난 녹음')));
  await h.run(h.session.stop);assert.equal(h.session.mode,'idle');assert.equal(h.count('ko_cancel_diarization'),1);
  h.overrides.set('ko_poll_live_diarization',async()=>null);await h.start();
  await h.run(()=>h.emit('transcript-update',row(1,1,4,'새 녹음')));
  await h.run(()=>gate.resolve(windowResult(0,0,30,[{start:1,end:10,speaker:1}])));
  assert.equal(h.session.rows[0].text,'새 녹음');assert.equal(h.session.rows[0].speaker_assignment,undefined);
  assert.equal(h.calls.filter(c=>c.command==='ko_poll_live_diarization').at(-1).args.afterCheckpoint,-1);
 }));
 await test('Navigation and rerenders keep one live polling request and release the timer on stop',()=>using({},async h=>{
  const gate=deferred();h.overrides.set('ko_poll_live_diarization',()=>gate.promise);
  h.overrides.set('ko_cancel_diarization',async()=>{});await h.start();
  for(const view of ['dictation','minutes','recording'])await h.run(()=>h.session.navigate(view));
  await h.advance(3000);assert.equal(h.count('ko_poll_live_diarization'),1);
  await h.run(()=>gate.resolve(null));await h.advance(3000);assert.equal(h.count('ko_poll_live_diarization'),2);
  await h.run(h.session.stop);const count=h.count('ko_poll_live_diarization');await h.advance(30000);assert.equal(h.count('ko_poll_live_diarization'),count);
 }));
};

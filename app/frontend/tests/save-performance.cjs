'use strict';
// Real React hooks and structured minutes; only native I/O/model boundaries are simulated.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {harness}=require('./stream-record-ui.cjs');
const root=path.resolve(__dirname,'..'),results=[];
const storage=()=>new Map(['ai-correction','live-summary','live-diarization'].map(name=>['stream-record.option.'+name,'false']));
const note={summary:'검토 사항',decisions:[],proposals:[],actions:[],numbers:[],open_questions:[]};
const snapshot={version:1,recordId:'save-fixture',title:'회의',rows:[{sequence_id:1,text:'검토를 계속합니다.',is_partial:false,audio_start_time:0}],minutes:'',startedAt:null};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function using(options,fn){const h=harness({storage:storage(),...options});await h.mount();try{await fn(h);}finally{await h.unmount();}}
async function test(name,fn){try{const details=await fn();results.push({name,status:'passed',...details});console.log('PASS '+name);}catch(error){results.push({name,status:'failed',error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}
(async()=>{
 await test('Identical explicit saves share one pending write and retain the successful result',()=>using({},async h=>{
  const gate=deferred();h.overrides.set('ko_save_snapshot',()=>gate.promise);let saves;
  await h.run(()=>{saves=Array.from({length:5},()=>h.session.persist());});
  await h.run(async()=>{gate.resolve();await Promise.all(saves);});
  await h.run(()=>h.session.persist());assert.equal(h.count('ko_save_snapshot'),1,'Unchanged state must not wait for repeated native writes');
 }));
 await test('Slow autosave does not build a queue and saves a revision made while pending',()=>using({},async h=>{
  const gate=deferred();const contents=[];h.overrides.set('ko_save_snapshot',args=>{contents.push(JSON.parse(args.content));return contents.length===1?gate.promise:undefined;});
  await h.run(()=>h.session.setTitle('A'));for(let i=0;i<5;i++)await h.advance(10000);
  assert.equal(h.session.recordSwitchBlocked,true);await h.run(()=>h.session.setTitle('B'));
  await h.advance(10000);await h.run(()=>gate.resolve());await h.advance(10000);await h.advance(10000);
  assert.deepEqual(contents.map(x=>x.title),['A','B']);assert.equal(h.session.recordSwitchBlocked,false);
 }));
 await test('Rejected identical saves remain retryable and never certify a failed checkpoint',()=>using({},async h=>{
  let calls=0;h.overrides.set('ko_save_snapshot',async()=>{if(++calls===1)throw new Error('disk full');});
  await h.run(()=>assert.rejects(h.session.persist(),/disk full/));await h.run(()=>h.session.persist());await h.run(()=>h.session.persist());
  assert.equal(calls,2);assert.equal(h.session.recordSwitchBlocked,false);
 }));
 await test('Distinct snapshots remain ordered including returning to an earlier value',()=>using({},async h=>{
  const gate=deferred(),contents=[];h.overrides.set('ko_save_snapshot',args=>{contents.push(JSON.parse(args.content));return contents.length===1?gate.promise:undefined;});let saves;
  await h.run(()=>{h.session.setTitle('A');const a=h.session.persist();h.session.setTitle('B');const b=h.session.persist();h.session.setTitle('A');const c=h.session.persist();saves=[a,b,c];});
  await h.run(async()=>{gate.resolve();await Promise.all(saves);});assert.deepEqual(contents.map(x=>x.title),['A','B','A']);
 }));
 await test('Record switches update the last-session pointer and preserve each record',()=>using({snapshot,records:[snapshot,{...snapshot,recordId:'second',title:'둘째'}]},async h=>{
  await h.run(()=>h.session.openRecord('second'));await h.run(()=>h.session.openRecord(snapshot.recordId));
  assert.equal(h.snapshots.at(-1).recordId,snapshot.recordId);assert.equal(h.session.rows[0].text,snapshot.rows[0].text);
 }));
 await test('Completed minutes reuse durable checkpoints without rewriting them',()=>using({},async h=>{
  const {createStructuredMinutes}=h.load(path.join(root,'src/components/meeting-ko/structured-minutes.ts'));let saved=null,saves=0,generations=0;
  const options={rows:snapshot.rows,title:snapshot.title,modelKey:'local:fixture',generate:async()=>{generations++;return JSON.stringify(note);},progress:()=>{},cancelled:()=>false,checkpoint:null,save:async value=>{saves++;saved=JSON.parse(JSON.stringify(value));}};
  await createStructuredMinutes(options);assert.equal(saves,1,'Last validated checkpoint must not be written twice');
  await createStructuredMinutes({...options,checkpoint:saved});assert.equal(saves,1);assert.equal(generations,1);
 }));
 await test('Minutes stop before another inference when checkpoint persistence fails',()=>using({},async h=>{
  const {createStructuredMinutes}=h.load(path.join(root,'src/components/meeting-ko/structured-minutes.ts'));let generations=0;
  await assert.rejects(createStructuredMinutes({rows:Array.from({length:8},()=>({text:'검토 사항입니다. '.repeat(120),is_partial:false})),title:'회의',modelKey:'fixture',generate:async()=>{generations++;return JSON.stringify(note);},progress:()=>{},cancelled:()=>false,checkpoint:null,save:async()=>{throw new Error('disk full');}}),/disk full/);
  assert.equal(generations,1);
 }));
 await test('Minutes finish without model unload on the save critical path',()=>using({snapshot},async h=>{
  const release=deferred(),exported=deferred();h.overrides.set('ko_export',async()=>{exported.resolve();return 'minutes.md';});h.overrides.set('ko_generate',args=>args.stage==='release'?release.promise:Promise.resolve(JSON.stringify(note)));let task,finished=false;
  await h.run(()=>{task=h.session.summarize().then(()=>{finished=true;});});
  await exported.promise;await h.run(()=>{});
  const observed={finished,mode:h.session.mode};await h.run(async()=>{release.resolve('released');await task;});
  assert.equal(observed.finished,true,'Completed saved minutes must not wait for model teardown');assert.equal(observed.mode,'idle');assert.match(h.session.minutes,/검토 사항/);
 }));
 await test('Recording stop saves the last emitted sentence and original audio path',()=>using({},async h=>{
  await h.start();h.overrides.set('ko_stop_recording',async()=>{h.emit('transcript-update',{sequence_id:1,text:'마지막 문장',is_partial:false,audio_start_time:0});h.emit('recording-saved',{audio_file:'fixture-original.wav'});});
  await h.run(()=>h.session.stop());assert.equal(h.snapshots.at(-1).rows[0].text,'마지막 문장');assert.equal(h.snapshots.at(-1).audioPath,'fixture-original.wav');assert.equal(h.session.mode,'idle');
 }));
 // Controlled benchmark: count native saves and elapsed time, not actual disk/model speed.
 await test('Five unchanged saves incur one synthetic I/O delay',async()=>{
  let writes=0;const h=harness({storage:storage(),overrides:{ko_save_snapshot:async()=>{writes++;await new Promise(resolve=>setTimeout(resolve,100));}}});await h.mount();
  try{const start=performance.now();await h.run(()=>Promise.all(Array.from({length:5},()=>h.session.persist())));const elapsedMs=performance.now()-start;assert.equal(writes,1);return {writes,elapsedMs,nativeDelayMs:100};}finally{await h.unmount();}
 });
 const report={passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,scope:'Actual React hooks and structured generation, simulated native commands. No packaged EXE, capture, disk or model speed claim.',results};
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/save-performance'+(process.env.STREAM_RECORD_RED_PROOF?'-before':'')+'.json'),JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});

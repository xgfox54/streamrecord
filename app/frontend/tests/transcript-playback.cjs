'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {harness}=require('./stream-record-ui.cjs');
const results=[];
const audio={path:'original.wav',filename:'original.wav',duration_seconds:10,sha256:'a'.repeat(64)};
const rows=[{sequence_id:1,text:'첫 원문',audio_start_time:0,audio_end_time:1,is_partial:false},{sequence_id:2,text:'둘째 원문',chunk_start_time:2,is_partial:false},{sequence_id:3,text:'셋째 원문',audio_start_time:4,audio_end_time:5,is_partial:false}];
const snapshot={version:1,recordId:'playback',title:'구간 재생',rows,minutes:'',startedAt:null,audioPath:audio.path,audioSha256:audio.sha256};
function player(readyState=1){return {readyState,currentTime:0,plays:[],pauses:0,play(){this.plays.push(this.currentTime);return Promise.resolve();},pause(){this.pauses++;}};}
async function using(options,fn){const media=options.audioElement||player();const h=harness({snapshot,audioElement:media,...options,overrides:{ko_models:async()=>[],ko_open_review_audio:async()=>audio,...options.overrides}});await h.mount();try{await h.run(()=>h.session.navigate('dictation'));await fn(h,media);}finally{await h.unmount();}}
const button=(h,name)=>h.renderer.root.findAllByType('button').find(node=>node.props['aria-label']===name);
async function test(name,fn){try{await fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(error){results.push({name,status:'failed',error:String(error.stack)});console.error('FAIL '+name+'\n'+error.stack);}}
(async()=>{
 await test('Text click connects the saved original and plays timestamp zero; pause and bounded next-row playback work',()=>using({},async(h,media)=>{
  await h.run(()=>button(h,'받아쓰기-1 원음 재생: 첫 원문').props.onClick());assert.equal(h.count('select_and_validate_audio_command'),0);assert.equal(h.count('ko_open_review_audio'),1);assert.deepEqual(media.plays,[0]);assert.equal(h.session.playbackEnd.current,1);assert.equal(h.session.follow,false);
  await h.run(()=>h.renderer.root.findByType('audio').props.onPlay());assert.equal(h.session.audioPlaying,true);
  await h.run(()=>button(h,'받아쓰기-1 원음 일시정지').props.onClick());assert.equal(h.session.audioPlaying,false);
  await h.run(()=>button(h,'받아쓰기-2 원음 재생').props.onClick());assert.deepEqual(media.plays,[0,2]);assert.equal(h.session.playbackEnd.current,4);
  media.currentTime=4;await h.run(()=>h.renderer.root.findByType('audio').props.onTimeUpdate());assert.equal(h.session.playbackEnd.current,null);assert.equal(h.session.playbackIndex,null);assert.ok(media.pauses>0);
  assert.equal(h.session.rows[0].text,'첫 원문');assert.equal(h.snapshots.at(-1).rows[0].text,'첫 원문');
 }));
 await test('Metadata loading resumes the pending segment without another click',()=>using({audioElement:player(0)},async(h,media)=>{
  await h.run(()=>h.session.playRow(h.session.rows[1]));assert.deepEqual(media.plays,[]);assert.match(h.session.notice,/준비되면/);
  media.readyState=1;await h.run(()=>h.renderer.root.findByType('audio').props.onLoadedMetadata());assert.deepEqual(media.plays,[2]);assert.equal(h.session.notice,'');
 }));
 await test('Search corrected and reviewed text play the original row timestamps',()=>using({},async(h,media)=>{
  await h.run(()=>h.session.setRows(h.session.rows.map((row,i)=>i===1?{...row,ai_correction:{version:1,source_text:row.text,text:'보정 둘째',model_key:'fixture',glossary:''},reviewed_text:'직접 수정 둘째'}:row)));
  const search=h.renderer.root.findByProps({placeholder:'전체 대화에서 찾기'});await h.run(()=>search.props.onChange({target:{value:'직접 수정 둘째'}}));assert.equal(h.renderer.root.findAllByType('article').length,1);
  await h.run(()=>button(h,'받아쓰기-2 원음 재생: 직접 수정 둘째').props.onClick());assert.deepEqual(media.plays,[2]);assert.equal(h.session.rows[1].text,'둘째 원문');
 }));
 await test('Review navigation cancels metadata wait and keeps exactly one audio element',()=>using({audioElement:player(0)},async(h,media)=>{
  await h.run(()=>h.session.playRow(h.session.rows[0]));await h.run(()=>h.session.navigate('transcript'));assert.equal(h.renderer.root.findAllByType('audio').length,1);
  media.readyState=1;await h.run(()=>h.renderer.root.findByType('audio').props.onLoadedMetadata());assert.deepEqual(media.plays,[]);
  await h.run(()=>h.session.playRow(h.session.rows[2]));assert.deepEqual(media.plays,[4]);await h.run(()=>h.session.navigate('dictation'));assert.equal(h.session.playbackIndex,null);
 }));
 await test('Recording start and record switch stop playback and discard pending requests',()=>using({},async(h,media)=>{
  await h.run(()=>h.session.playRow(h.session.rows[0]));await h.start();assert.equal(h.session.mode,'recording');assert.equal(h.session.playbackIndex,null);assert.equal(h.session.audioSource,null);
  await h.run(()=>h.session.playRow(rows[1]));assert.deepEqual(media.plays,[0]);await h.run(()=>h.session.stop());
  await h.run(()=>h.session.newRecord());assert.equal(h.session.playbackIndex,null);assert.equal(h.session.audioSource,null);assert.ok(media.pauses>0);
 }));
 await test('Missing timestamps and partial rows are unavailable without opening an audio file',()=>using({snapshot:{...snapshot,rows:[{sequence_id:1,text:'시간 미상'},{sequence_id:2,text:'입력 중',audio_start_time:0,is_partial:true}]}},async h=>{
  assert.equal(button(h,'받아쓰기-1 원음 재생').props.disabled,true);assert.equal(button(h,'받아쓰기-2 원음 재생'),undefined);assert.equal(button(h,'받아쓰기-2 원음 재생: 입력 중').props.disabled,true);
  await h.run(()=>h.session.playRow(h.session.rows[0]));await h.run(()=>h.session.playRow(h.session.rows[1]));assert.equal(h.count('ko_open_review_audio'),0);
 }));
 await test('Audio identity mismatch and cancelled file selection never play another file',async()=>{
  await using({overrides:{ko_open_review_audio:async()=>({...audio,sha256:'b'.repeat(64)})}},async(h,media)=>{await h.run(()=>h.session.playRow(h.session.rows[0]));assert.match(h.session.error,/SHA-256/);assert.deepEqual(media.plays,[]);assert.equal(h.session.audioSource,null);});
  await using({snapshot:{...snapshot,audioPath:undefined,audioSha256:undefined},overrides:{select_and_validate_audio_command:async()=>null}},async(h,media)=>{await h.run(()=>h.session.playRow(h.session.rows[0]));assert.equal(h.count('select_and_validate_audio_command'),1);assert.deepEqual(media.plays,[]);assert.equal(h.session.mode,'idle');});
 });
 await test('Late preparation after navigation and playback errors cannot leave queued playback',async()=>{
  let resolve;const pending=new Promise(done=>resolve=done);await using({overrides:{ko_open_review_audio:()=>pending}},async(h,media)=>{let request;await h.run(()=>{request=h.session.playRow(h.session.rows[0]);});await h.run(()=>h.session.navigate('minutes'));await h.run(()=>resolve(audio));await h.run(()=>request);assert.deepEqual(media.plays,[]);});
  const media=player();media.play=()=>Promise.reject(new Error('decode error'));await using({audioElement:media},async h=>{await h.run(()=>h.session.playRow(h.session.rows[0]));assert.match(h.session.error,/decode error/);assert.equal(h.session.playbackIndex,null);assert.equal(h.session.playbackEnd.current,null);});
 });
 const report={passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,scope:'Real React session and reader; native commands and audio element methods simulated',results};fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../test-results/transcript-playback.json'),JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});

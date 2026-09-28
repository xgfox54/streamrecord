'use strict';
// Offline regression tests. No audio capture, model download or API access occurs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'src/components/meeting-ko');
let models=[];let config=null;let calls=[];let downloadFails=false;let cancelledDownload=false;
const copy=v=>JSON.parse(JSON.stringify(v));
const api={WhisperAPI:{
  init:async()=>{calls.push('init');},getAvailableModels:async()=>copy(models),
  downloadModel:async name=>{calls.push('download:'+name);if(downloadFails)throw new Error('offline');if(!cancelledDownload)models=models.map(m=>m.name===name?{...m,status:'Available'}:m);},
  loadModel:async name=>{calls.push('load:'+name);}
}};
const invoke=async(command,args)=>{
  if(command==='ko_prepare_bundled_whisper'){calls.push('bundle:small-q5_1');if(downloadFails)throw new Error('bundled model is corrupt');if(!cancelledDownload)models=[...models.filter(m=>m.name!=='small-q5_1'),{name:'small-q5_1',status:'Available',size_mb:181}];return 'small-q5_1';}
  if(command==='api_get_transcript_config')return config;
  if(command==='set_language_preference'){assert.equal(args.language,'ko');calls.push('language:ko');return;}
  if(command==='api_save_transcript_config'){assert.equal(args.provider,'localWhisper');config=args;calls.push('save:'+args.model);return;}
  throw new Error('Unexpected native call: '+command);
};
const cache=new Map();
function load(name){
  if(cache.has(name))return cache.get(name);
  const filename=path.join(source,name+'.ts');
  const result=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>root,getCanonicalFileName:x=>x,getNewLine:()=> '\n'}));
  const module={exports:{}};
  const requireModule=id=>{
    if(id==='@/lib/whisper')return api;
    if(id==='@tauri-apps/api/core')return {invoke};
    if(id==='@tauri-apps/api/event')return {listen:async()=>()=>{}};
    if(id.startsWith('./'))return load(id.slice(2));
    return require(id);
  };
  vm.runInNewContext(result.outputText,{module,exports:module.exports,require:requireModule,console,TextEncoder,crypto:webcrypto,setTimeout,clearTimeout},{filename});
  cache.set(name,module.exports);return module.exports;
}
const korean=load('korean-model');const structured=load('structured-minutes');const core=load('core');
const available=name=>({name,status:'Available',size_mb:181,path:'test',accuracy:'Good',speed:'Fast'});
const missing=name=>({...available(name),status:'Missing'});
let passed=0;const results=[];
async function test(name,fn){await fn();passed++;results.push({name,status:'passed'});console.log('PASS '+name);}
const note=(id='S000001',quote='예산 300만원을 확정한다.')=>({summary:'예산을 논의했다.',decisions:[{text:'예산 300만원 확정',source_id:id,quote,owner:null,due:null}],proposals:[],actions:[],numbers:[],open_questions:[]});
(async()=>{
 await test('English-only and unknown models cannot become Korean defaults',()=>{for(const x of ['small.en','base.en-q5_1','parakeet','../small'])assert.equal(korean.isKoreanModel(x),false);for(const x of ['small','small-q5_1','base','large-v3-turbo-q5_0'])assert.equal(korean.isKoreanModel(x),true);});
 await test('Explicit installed multilingual selection is preserved',()=>assert.equal(korean.chooseKoreanModel([available('base'),available('medium')],'medium'),'medium'));
 await test('Default uses installed multilingual model, not an English model',()=>assert.equal(korean.chooseKoreanModel([available('small.en'),available('base')],'small.en'),'base'));
 await test('Fresh installation selects multilingual small-q5_1',()=>assert.equal(korean.chooseKoreanModel([missing('small-q5_1'),missing('base')]),'small-q5_1'));
 await test('Installed model does not download and saves Korean preferences',async()=>{models=[available('base')];config={provider:'localWhisper',model:'base.en'};calls=[];await korean.ensureKoreanWhisper(()=>{});assert.ok(!calls.some(x=>x.startsWith('download:')));assert.ok(calls.includes('load:base'));assert.ok(calls.includes('language:ko'));assert.ok(calls.includes('save:base'));});
 await test('Missing model uses the installer bundle without downloading',async()=>{models=[missing('small-q5_1')];config=null;calls=[];await korean.ensureKoreanWhisper(()=>{});assert.ok(calls.indexOf('bundle:small-q5_1')>=0);assert.ok(calls.indexOf('bundle:small-q5_1')<calls.indexOf('load:small-q5_1'));assert.ok(!calls.some(x=>x.startsWith('download:')));});
 await test('Corrupt bundle does not download, load or save',async()=>{models=[missing('small-q5_1')];config=null;calls=[];downloadFails=true;try{await assert.rejects(()=>korean.ensureKoreanWhisper(()=>{}),/준비 실패/);}finally{downloadFails=false;}assert.ok(!calls.some(x=>/^(download|save|load):/.test(x)));});
 await test('Incomplete bundle registration cannot be mistaken for ready',async()=>{models=[missing('small-q5_1')];config=null;calls=[];cancelledDownload=true;try{await assert.rejects(()=>korean.ensureKoreanWhisper(()=>{}),/준비 실패/);}finally{cancelledDownload=false;}assert.ok(!calls.some(x=>/^(download|load):/.test(x)));});
 await test('Empty model catalogue still prepares the bundled default',async()=>{models=[];config=null;calls=[];await korean.ensureKoreanWhisper(()=>{});assert.ok(calls.includes('bundle:small-q5_1'));assert.ok(calls.includes('load:small-q5_1'));assert.ok(!calls.some(x=>x.startsWith('download:')));});
 await test('Fresh Korean preparation contains no network download call',()=>{const text=fs.readFileSync(path.join(source,'korean-model.ts'),'utf8');assert.ok(!text.includes('WhisperAPI.downloadModel'));assert.ok(text.includes('ko_prepare_bundled_whisper'));});
 await test('Input device helpers preserve native Stereo Mix and exclude output devices',()=>{const devices=[{name:'Microphone',device_type:'Input'},{name:'Stereo Mix',device_type:'Input'},{name:'Speaker',device_type:'Output'}];assert.equal(core.stereoMixName(devices),'Stereo Mix');assert.deepEqual(copy(core.microphoneInputs(devices)),[devices[0]]);assert.equal(core.stereoMixName([{name:'Stereo Mix',device_type:'Output'}]),'');assert.deepEqual(copy(core.microphoneInputs([{name:'Speaker',device_type:'Output'}])),[]);});
 await test('Unicode source splitting preserves all characters and excludes partials',()=>{const text='한국어😀'.repeat(800);const rows=[{text,is_partial:false},{text:'미확정',is_partial:true}];const parts=structured.sourceParts(rows);assert.equal(parts.map(p=>p.text).join(''),text);assert.ok(parts.length>1);assert.equal(parts[0].id,'S000001');});
 await test('Repeated utterances keep distinct source IDs',()=>{const parts=structured.sourceParts([{text:'네.'},{text:'네.'}]);assert.notEqual(parts[0].id,parts[1].id);});
 await test('Reviewed text is used without changing raw transcript',()=>{const row={text:'3000만원',reviewed_text:'300만원'};assert.equal(structured.reviewText(row),'300만원');assert.equal(row.text,'3000만원');});
 const parts=[{id:'S000001',time:'00:00:01',text:'예산 300만원을 확정한다.'}];
 await test('Exact evidence quote and source pass schema validation',()=>assert.equal(structured.parseNote(JSON.stringify(note()),parts).decisions.length,1));
 await test('Invented source ID is rejected',()=>assert.throws(()=>structured.parseNote(note('S999999'),parts),/근거/));
 await test('Invented quotation is rejected',()=>assert.throws(()=>structured.parseNote(note('S000001','예산 900만원'),parts),/근거/));
 await test('Invented owner is rejected',()=>{const n=note();n.decisions[0].owner='홍길동';assert.throws(()=>structured.parseNote(n,parts),/owner/);});
 await test('Malformed JSON is rejected',()=>assert.throws(()=>structured.parseNote('{bad',parts)));
 await test('All decision rows survive deterministic final rendering',()=>{const result=structured.renderMinutes([note(),note()],parts,'회의');assert.equal(result.split('예산 300만원 확정').length-1,2);assert.ok(result.includes('S000001'));});
 let snapshot=null;let requests=0;
 const opts={rows:[{text:'예산 300만원을 확정한다.',audio_start_time:1}],title:'시험',glossary:'',modelKey:'local:test',generate:async()=>{requests++;return JSON.stringify(note());},progress:()=>{},cancelled:()=>false,checkpoint:null,save:async value=>{snapshot=copy(value);}};
 await test('Structured summary persists a resumable checkpoint',async()=>{const value=await structured.createStructuredMinutes(opts);assert.ok(value.includes('확정 결정사항'));assert.equal(requests,1);assert.ok(snapshot.key);});
 await test('Unchanged completed chunk is reused without another model request',async()=>{await structured.createStructuredMinutes({...opts,checkpoint:snapshot});assert.equal(requests,1);});
 await test('Changed model invalidates previous checkpoint',async()=>{await structured.createStructuredMinutes({...opts,modelKey:'local:other',checkpoint:snapshot});assert.equal(requests,2);});
 await test('Cancellation does not make a model request',async()=>{const before=requests;await assert.rejects(()=>structured.createStructuredMinutes({...opts,cancelled:()=>true}),/취소/);assert.equal(requests,before);});
 await test('No summary for partial-only transcripts',async()=>await assert.rejects(()=>structured.createStructuredMinutes({...opts,rows:[{text:'진행중',is_partial:true}]}),/확정/));
 await test('Mixed final and partial rows cannot produce a falsely complete summary',async()=>await assert.rejects(()=>structured.createStructuredMinutes({...opts,rows:[{text:'완료된 발언'},{text:'진행중',is_partial:true}]}),/미확정/));
 await test('Independent project blocks legacy overlay application before any writes',async()=>{const base=path.resolve(root,'../..');const installer=await import(pathToFileURL(path.join(base,'apply.mjs')).href);assert.throws(()=>installer.applyOverlay(base,path.join(base,'app')),/independent project/);});
 await test('Tauri configuration has no upstream update endpoints',()=>{const config=JSON.parse(fs.readFileSync(path.join(root,'src-tauri','tauri.conf.json'),'utf8'));assert.deepEqual(config.plugins.updater.endpoints,[]);});
 await test('Updater service and dialog honor the independent update policy',()=>{for(const file of ['src/services/updateService.ts','src/components/UpdateDialog.tsx'])assert.ok(fs.readFileSync(path.join(root,file),'utf8').includes('if (!automaticUpdatesEnabled())'));assert.ok(fs.readFileSync(path.join(root,'src/lib/stream-record-policy.ts'),'utf8').includes('return false;'));});
 const review=load('review-core');
 await test('Playback keeps time zero and clamps to the original audio',()=>{assert.deepEqual(copy(review.playbackRange({text:'시작',audio_start_time:0,audio_end_time:12},5)),{start:0,end:5});});
 await test('Playback rejects unknown, negative and non-finite timestamps',()=>{for(const start of [undefined,-1,NaN,Infinity,20])assert.equal(review.playbackRange({text:'발언',audio_start_time:start},10),null);});
 await test('Three-hour recovery plan retains its fractional final window',()=>{const windows=review.recoveryWindows(10800.5);assert.equal(windows.length,451);assert.equal(windows.at(-1).duration,0.5);assert.equal(windows.reduce((n,w)=>n+w.duration,0),10800.5);});
 await test('Recovery refuses invalid file durations',()=>{for(const duration of [0,-1,NaN,Infinity,86401])assert.throws(()=>review.recoveryWindows(duration));});
 await test('Truncated or partial recovery cannot be accepted as completed',()=>{for(const value of [{text:'끝',audio_start_time:0,audio_end_time:24,is_partial:true},{text:'잘림',audio_start_time:0,audio_end_time:20,is_partial:false},{text:'시각 오류',audio_start_time:24,audio_end_time:48,is_partial:false}])assert.throws(()=>review.validateRecovered(value,0,24));});
 let recovery=null;let decoded=[];
 const recoveryOptions={audio:{path:'test.wav',filename:'test',duration_seconds:50,sha256:'a'.repeat(64)},model:'small-q5_1',glossary:'제주가치돌봄',checkpoint:null,decode:async(start,duration)=>{decoded.push(start);return {text:start===24?'':'발언',audio_start_time:start,audio_end_time:start+duration,is_partial:false};},save:async value=>{recovery=copy(value);},progress:()=>{},cancelled:()=>false};
 await test('Recovery preserves empty completed windows without fabricating speech',async()=>{const rows=await review.recoverAudio(recoveryOptions);assert.deepEqual(decoded,[0,24,48]);assert.equal(Object.keys(recovery.windows).length,3);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.is_partial===false));});
 await test('Completed recovery is reused without additional model calls',async()=>{decoded=[];await review.recoverAudio({...recoveryOptions,checkpoint:recovery});assert.equal(decoded.length,0);});
 await test('Recovery model and glossary changes invalidate reuse',async()=>{const saved=copy(recovery);decoded=[];await review.recoverAudio({...recoveryOptions,model:'base',checkpoint:saved});assert.equal(decoded.length,3);decoded=[];await review.recoverAudio({...recoveryOptions,glossary:'변경',checkpoint:saved});assert.equal(decoded.length,3);});
 await test('Failed recovery resumes after the last persisted window',async()=>{let saved=null;await assert.rejects(()=>review.recoverAudio({...recoveryOptions,save:async value=>{saved=copy(value);},decode:async(start,duration)=>{if(start===24)throw new Error('interrupted');return recoveryOptions.decode(start,duration);}}),/interrupted/);assert.equal(Object.keys(saved.windows).length,1);decoded=[];await review.recoverAudio({...recoveryOptions,checkpoint:saved});assert.deepEqual(decoded,[24,48]);});
 await test('Recovery cancellation never submits another window',async()=>{decoded=[];await assert.rejects(()=>review.recoverAudio({...recoveryOptions,cancelled:()=>true}),/취소/);assert.equal(decoded.length,0);});
 await test('Failure to persist a checkpoint stops further inference',async()=>{decoded=[];await assert.rejects(()=>review.recoverAudio({...recoveryOptions,save:async()=>{throw new Error('disk full');}}),/disk full/);assert.deepEqual(decoded,[0]);});
 await test('Fully decoded short Whisper windows are final, not duration-based partials',()=>{const engine=fs.readFileSync(path.join(root,'src-tauri/src/whisper_engine/whisper_engine.rs'),'utf8');assert.ok(engine.includes('let is_partial = false;'));assert.ok(!engine.includes('let is_partial = duration_seconds < 15.0'));assert.ok(engine.includes('params.set_initial_prompt(text)'));});
 await test('Transcription contract preserves raw output, semantic scores and sample spans',()=>{const contract=fs.readFileSync(path.join(root,'src-tauri/src/audio/transcription/provider.rs'),'utf8');for(const field of ['raw_text','score','spans','start_sample','end_sample','timebase_hz'])assert.ok(contract.includes(field),field);assert.ok(contract.includes('MeanTokenProbability'));assert.ok(contract.includes('Unavailable'));});
 await test('Transcription paths contain no fabricated confidence values',()=>{for(const file of ['src-tauri/src/audio/transcription/worker.rs','src-tauri/src/audio/import.rs','src-tauri/src/audio/retranscription.rs','src-tauri/src/audio/post_processor.rs']){const text=fs.readFileSync(path.join(root,file),'utf8');assert.ok(!text.includes('unwrap_or(0.85)'),file);assert.ok(!text.includes('(text, 0.9f32)'),file);assert.ok(!text.includes('confidence: 0.95'),file);assert.ok(!text.includes('confidence: 0.5'),file);}const engine=fs.readFileSync(path.join(root,'src-tauri/src/whisper_engine/whisper_engine.rs'),'utf8');assert.ok(!engine.includes('(segment_length / 100.0)'));});
 await test('Live completion distinguishes terminal outcomes and durable commits',()=>{const worker=fs.readFileSync(path.join(root,'src-tauri/src/audio/transcription/worker.rs'),'utf8');const accounting=fs.readFileSync(path.join(root,'src-tauri/src/audio/transcription/accounting.rs'),'utf8');const commands=fs.readFileSync(path.join(root,'src-tauri/src/audio/recording_commands.rs'),'utf8');const implementation=worker+'\n'+accounting+'\n'+commands;for(const state of ['succeeded','no_speech','failed','cancelled','deferred','pending','processing','result_committed','audio_durable'])assert.ok(implementation.includes(state),state);assert.ok(!implementation.includes('ZERO transcript chunks lost'));assert.ok(implementation.includes('completed_with_errors'));assert.ok(implementation.includes('incomplete'));});
 await test('Live transcription backlog is disk-backed with bounded in-memory dispatch',()=>{const queue=fs.readFileSync(path.join(root,'src-tauri/src/audio/transcription/queue.rs'),'utf8');const worker=fs.readFileSync(path.join(root,'src-tauri/src/audio/transcription/worker.rs'),'utf8');const manager=fs.readFileSync(path.join(root,'src-tauri/src/audio/recording_manager.rs'),'utf8');assert.ok(queue.includes('file.sync_data().await'));assert.ok(queue.includes('fs::rename(&temp_path, &final_path).await'));assert.ok(queue.includes('mpsc::channel(1)'));assert.ok(worker.includes('mpsc::channel::<super::queue::DiskQueueItem>(1)'));assert.ok(!worker.includes('unbounded_channel::<AudioChunk>'));assert.ok(manager.includes('disk_backed_queue().await'));});
 await test('Retranscription creates versioned runs without deleting original transcripts',()=>{const source=fs.readFileSync(path.join(root,'src-tauri/src/audio/retranscription.rs'),'utf8');assert.ok(!source.includes('DELETE FROM transcripts'));assert.ok(source.includes('transcription_runs'));assert.ok(source.includes('transcription_run_segments'));assert.ok(source.includes('run_id'));});
 await test('Playback does not grant wildcard access to recordings or user folders',()=>{const config=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));assert.deepEqual(config.app.security.assetProtocol.scope,['$APPDATA/**']);const source=fs.readFileSync(path.join(root,'src-tauri/src/review_audio.rs'),'utf8');assert.ok(source.includes('allow_file(&file.path)'));assert.ok(source.includes('file,pipe'));});
 const report={passed,failed:0,executedAt:new Date().toISOString(),scope:'Offline mocked regression tests; no microphone, GPU, network or real inference.',results};
 const reports=path.join(root,'test-results');fs.mkdirSync(reports,{recursive:true});fs.writeFileSync(path.join(reports,'stream-record.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});

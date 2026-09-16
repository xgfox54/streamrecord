'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict'), crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const base=path.resolve(__dirname,'..');
let ts;
for(const location of [path.join(base,'app/frontend/node_modules/typescript'),'typescript',path.join(base,'../GPT to Codex/node_modules/typescript')]){try{ts=require(location);break;}catch{}}
if(!ts){console.error('TypeScript not found. Run node setup.mjs prepare first.');process.exit(2);}
const src=path.join(base,'overlay/frontend/src/components/meeting-ko/core.ts');
const source=fs.readFileSync(src,'utf8');
const results=[];
const check=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.stack||String(e)});}};
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const mod={exports:{}};
const localRequire=id=>id==='zod'?require(path.join(base,'app/frontend/node_modules/zod')):require(id);
new Function('module','exports','require',compiled)(mod,mod.exports,localRequire);const c=mod.exports;
(async()=>{
 await check('core TypeScript strict typecheck',()=>{
  const program=ts.createProgram([src],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,baseUrl:path.join(base,'app/frontend'),paths:{zod:['node_modules/zod']},strict:true,noEmit:true,skipLibCheck:true});
  const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);assert.equal(errors.length,0,errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\n'));
 });
 await check('Stereo Mix only selected among inputs',()=>assert.equal(c.stereoMixName([{name:'Stereo Mix',device_type:'Output'},{name:'스테레오 믹스 (Realtek)',device_type:'Input'}]),'스테레오 믹스 (Realtek)'));
 await check('No silent fallback to another microphone',()=>assert.equal(c.stereoMixName([{name:'Mic',device_type:'Input'}]),''));
 await check('Microphone choices exclude Stereo Mix and output devices',()=>assert.deepEqual(c.microphoneInputs([{name:'내장 마이크',device_type:'Input'},{name:'Stereo Mix',device_type:'Input'},{name:'스피커',device_type:'Output'}]).map(d=>d.name),['내장 마이크']));
 await check('Timestamp boundary and invalid values',()=>{assert.equal(c.timestamp(3661.9),'01:01:01');assert.equal(c.timestamp(-1),'00:00:00');assert.equal(c.timestamp(NaN),'00:00:00');});
 await check('Unicode chunks are lossless and bounded',()=>{const text=('가나다🙂회의\n'.repeat(1800));const chunks=c.splitText(text);assert.equal(chunks.join(''),text);assert(chunks.every(v=>Array.from(v).length<=1500));});
 await check('Invalid chunk sizes rejected',()=>assert.throws(()=>c.splitText('abc',0)));
 await check('Array and paginated transcript parsing',()=>{assert.equal(c.readRows([{text:'가'}]).length,1);assert.equal(c.readRows({transcripts:[{text:'나'}]}).length,1);});
 await check('Paginated transcript loading reaches the final page',async()=>{
  const rows=Array.from({length:601},(_,i)=>({id:String(i),text:`구간 ${i}`}));const offsets=[];
  const loaded=await c.loadAllTranscriptRows('meeting-1',async(_meetingId,limit,offset)=>{offsets.push(offset);return {transcripts:rows.slice(offset,offset+limit),total_count:rows.length,has_more:offset+limit<rows.length};});
  assert.equal(loaded.length,601);assert.equal(loaded.at(-1).text,'구간 600');assert.deepEqual(offsets,[0,300,600]);
 });
 await check('Malformed transcripts fail closed',()=>{assert.throws(()=>c.readRows(null));assert.throws(()=>c.readRows([{other:'x'}]));});
 await check('Partial updates replace rather than duplicate',()=>{let rows=c.upsertRow([],{sequence_id:2,text:'회의',is_partial:true});rows=c.upsertRow(rows,{sequence_id:2,text:'회의 시작',is_partial:false});assert.equal(rows.length,1);assert.equal(rows[0].text,'회의 시작');});
 await check('Final transcript cannot be regressed to partial',()=>{const rows=[{sequence_id:1,text:'확정',is_partial:false}];assert.equal(c.upsertRow(rows,{sequence_id:1,text:'임시',is_partial:true})[0].text,'확정');});
 await check('Different repeated utterances are preserved in order',()=>{let rows=c.upsertRow([],{sequence_id:2,text:'네'});rows=c.upsertRow(rows,{sequence_id:1,text:'네'});assert.deepEqual(rows.map(r=>r.sequence_id),[1,2]);});
 await check('Export retains timestamps and partial markers',()=>{assert.equal(c.transcriptText([{text:'발언',audio_start_time:5,is_partial:true}]),'[00:00:05] [미확정] 발언');});
 await check('Short summary calls final stage once',async()=>{const stages=[];const result=await c.createMinutes('회의 자료',async(t,s)=>{stages.push(s);return '요약';},()=>{});assert.equal(result,'요약');assert.deepEqual(stages,['final']);});
 await check('Long summary processes each chunk sequentially',async()=>{let concurrent=0,max=0;const notes=[];const input='내용'.repeat(2200);await c.createMinutes(input,async(t,s)=>{concurrent++;max=Math.max(max,concurrent);await Promise.resolve();concurrent--;if(s==='notes'){notes.push(t);return '핵심 메모';}return '최종';},()=>{});assert.equal(notes.join(''),input);assert.equal(max,1);});
 await check('Cancelled summary dispatches no more model calls',async()=>{let cancelled=false,calls=0;await assert.rejects(()=>c.createMinutes('가'.repeat(4000),async()=>{calls++;cancelled=true;return '메모';},()=>{},()=>cancelled),/취소/);assert.equal(calls,1);});
 await check('Empty model output is rejected',async()=>assert.rejects(()=>c.createMinutes('자료',async()=>'',()=>{}),/빈 응답/));
 await check('Non-shrinking model output is rejected',async()=>assert.rejects(()=>c.createMinutes('가'.repeat(4000),async t=>t,()=>{}),/줄이지/));
 const {applyOverlay,patchRecordingCommands}=await import(pathToFileURL(path.join(base,'apply.mjs')).href);
 const {readPinnedCommit,requirePinnedCommit}=await import(pathToFileURL(path.join(base,'upstream-pin.mjs')).href);
 await check('Native patch explicitly disables the second system-audio track',()=>{
  const actual=fs.readFileSync(path.join(base,'app/frontend/src-tauri/src/audio/recording_commands.rs'),'utf8');
  const patched=patchRecordingCommands(actual);
  assert(patched.includes('pub const DISABLED_SYSTEM_AUDIO_DEVICE'));
  assert(patched.indexOf('requested_name == Some(DISABLED_SYSTEM_AUDIO_DEVICE)')<patched.indexOf('default_output_device()'));
 });
 await check('Native patch enforces exact microphone without disconnect fallback',()=>{
  const actual=fs.readFileSync(path.join(base,'app/frontend/src-tauri/src/audio/recording_commands.rs'),'utf8');
  const patched=patchRecordingCommands(actual);
  assert(patched.includes('pub const EXACT_MIC_DEVICE_PREFIX'));
  assert(patched.includes('if !exact_microphone'));
  assert(patched.includes('value.strip_prefix(EXACT_MIC_DEVICE_PREFIX)'));
 });
 await check('Upstream source is pinned to one immutable full commit',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-ko-pin-'));const pin=path.join(dir,'UPSTREAM_COMMIT.txt');fs.writeFileSync(pin,'A2CB62E827DA7EF59F65064C97233EFB2313878E\n');assert.equal(readPinnedCommit(pin),'a2cb62e827da7ef59f65064c97233efb2313878e');assert.doesNotThrow(()=>requirePinnedCommit('a2cb62e827da7ef59f65064c97233efb2313878e','a2cb62e827da7ef59f65064c97233efb2313878e'));assert.throws(()=>requirePinnedCommit('518e8e6076e476e197b6f196fb9fe8412dcec713','a2cb62e827da7ef59f65064c97233efb2313878e'),/pinned Meetily commit/);fs.writeFileSync(pin,'main\n');assert.throws(()=>readPinnedCommit(pin),/full 40-character/);fs.rmSync(dir,{recursive:true,force:true});});
 await check('YouTube URL is validated before recording starts',()=>{const workspace=fs.readFileSync(path.join(base,'overlay/frontend/src/components/meeting-ko/KoreanWorkspace.tsx'),'utf8');assert(workspace.indexOf("invoke<string>('ko_validate_video'")<workspace.indexOf("invoke('ko_start_recording',{micName:stereoMix"));assert(workspace.includes("recordingStarted?await invoke('ko_stop_recording')"));});
 await check('Native patch retains transcript persistence until workers finish',()=>{
  const actual=fs.readFileSync(path.join(base,'app/frontend/src-tauri/src/audio/recording_commands.rs'),'utf8');
  const patched=patchRecordingCommands(actual);
  assert(patched.indexOf('task_handle.await')<patched.indexOf('app.unlisten(listener_id)'));
  assert(patched.indexOf('app.unlisten(listener_id)')<patched.indexOf('manager_for_cleanup'));
 });
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'meetily-ko-test-'));
 const makeFixture=name=>{
  const dir=path.join(temp,name),app=path.join(dir,'app');
  const write=(rel,s)=>{const p=path.join(app,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
  fs.mkdirSync(path.join(dir,'overlay/frontend/src/app'),{recursive:true});fs.writeFileSync(path.join(dir,'overlay/frontend/src/app/page.tsx'),'export default function Page(){return null;}');
  write('frontend/src/app/page.tsx',"import X from './_components/X'; export default function Home(){return null;}");
  write('frontend/src/app/layout.tsx',"import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'\nconst sourceSans3={variable:'font'};\nexport default function RootLayout(){return <html lang=\"en\"><body className={`${sourceSans3.variable} font-sans antialiased`}><main/></body></html>}\n");
  write('frontend/src-tauri/src/lib.rs','pub mod api;\nstruct RecordingArgs { save_path: String }\nasync fn start_recording(){} async fn stop_recording(){}\n// set_language_preference get_audio_devices get_transcript_history\n tauri::generate_handler![]');
  write('frontend/src-tauri/src/audio/recording_commands.rs',fs.readFileSync(path.join(base,'app/frontend/src-tauri/src/audio/recording_commands.rs'),'utf8'));
  write('frontend/src-tauri/src/audio/import.rs','select_and_validate_audio_command start_import_audio_command is_import_in_progress_command import-complete import-progress import-error');
  write('frontend/src-tauri/src/api/api.rs','api_get_transcript_config api_get_meeting_transcripts limit: i64 offset: i64');
  write('frontend/src-tauri/tauri.conf.json',JSON.stringify({identifier:'original',build:{},app:{windows:[{width:800,height:600}]},bundle:{createUpdaterArtifacts:true}}));
  return {dir,app,write};
 };
 try{
  await check('Patcher preserves originals and relocates imports (fixture)',()=>{const f=makeFixture('a');applyOverlay(f.dir,f.app);assert(fs.existsSync(path.join(f.app,'.meeting-ko-originals/frontend/src/app/page.tsx')));assert(fs.readFileSync(path.join(f.app,'frontend/src/app/_components/MeetilyOriginalHome.tsx'),'utf8').includes("@/app/_components/X"));});
  await check('Patcher configures stream-record v0.0.1 and retains the Korean app data path',()=>{const f=makeFixture('product');applyOverlay(f.dir,f.app);const config=JSON.parse(fs.readFileSync(path.join(f.app,'frontend/src-tauri/tauri.conf.json'),'utf8'));assert.equal(config.productName,'stream-record');assert.equal(config.mainBinaryName,'stream-record');assert.equal(config.version,'0.0.1');assert.equal(config.identifier,'local.meetily.korean.workspace');});
  await check('Patcher manifest tracks the installer generation',()=>{const f=makeFixture('generation');applyOverlay(f.dir,f.app);const manifest=JSON.parse(fs.readFileSync(path.join(f.app,'meeting-ko-install.json'),'utf8'));assert.equal(manifest.schema,3);assert.equal(manifest.installerVersion,5);});
  await check('Patcher installs the Korean localizer in the global layout',()=>{const f=makeFixture('locale');applyOverlay(f.dir,f.app);const layout=fs.readFileSync(path.join(f.app,'frontend/src/app/layout.tsx'),'utf8');assert(layout.includes("import KoreanLocalizer from '@/components/KoreanLocalizer'"));assert(layout.includes('<html lang=\"ko\">'));assert(layout.includes('<KoreanLocalizer />'));});
  await check('Patcher adopts an identical pre-existing overlay file',()=>{const f=makeFixture('adopt');const rel='frontend/src/components/existing.ts';fs.mkdirSync(path.join(f.dir,'overlay',path.dirname(rel)),{recursive:true});fs.writeFileSync(path.join(f.dir,'overlay',rel),'export const existing=true;\n');f.write(rel,'export const existing=true;\n');assert.doesNotThrow(()=>applyOverlay(f.dir,f.app));});
  await check('Patcher is idempotent (fixture)',()=>{const f=makeFixture('b');applyOverlay(f.dir,f.app);assert.equal(applyOverlay(f.dir,f.app).alreadyApplied,true);});
  await check('Patcher refuses unexpected user modifications (fixture)',()=>{const f=makeFixture('c');applyOverlay(f.dir,f.app);f.write('frontend/src/app/page.tsx','user work');assert.throws(()=>applyOverlay(f.dir,f.app),/Local changes/);assert.equal(fs.readFileSync(path.join(f.app,'frontend/src/app/page.tsx'),'utf8'),'user work');});
  await check('Incompatible upstream is rejected before mutation (fixture)',()=>{const f=makeFixture('d');f.write('frontend/src-tauri/src/audio/import.rs','unknown API');assert.throws(()=>applyOverlay(f.dir,f.app),/Import contract/);assert(!fs.existsSync(path.join(f.app,'meeting-ko-install.json')));});
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 const report={timestamp:new Date().toISOString(),environment:process.platform,node:process.version,typescript:ts.version,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,limitations:['No real audio or model inference','Patcher tested on fixtures, not a cloned upstream tree','No Rust/C++ compilation or Windows E2E','UI integration requires full app build'],results};
 fs.mkdirSync(path.join(base,'reports'),{recursive:true});fs.writeFileSync(path.join(base,'reports/validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});

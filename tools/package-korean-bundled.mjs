#!/usr/bin/env node
/** Owner-approved build-time model download, tests and Windows packaging.
 * --build: creates the Korean-model-included installer; --install: additionally
 * backs up/replaces the verified existing installation. No Git publishing,
 * account registration, cloud inference or microphone recording is performed.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {root,resourceDir,filename,prepareModel,verifyModel,hashFile} from './bundled-model.mjs';
import {verifyNsisBuffer} from './nsis-integrity.mjs';
import {expectedInstalledExe} from './release-format.mjs';
import {buildSnapshot,treeSnapshot,verifyVersions} from './release-inputs.mjs';
const frontend=path.join(root,'app/frontend');
const version=JSON.parse(fs.readFileSync(path.join(frontend,'src-tauri/tauri.conf.json'),'utf8')).version;
const out=path.join(root,'outputs',`korean-bundled-${version}`);
const report={version,variant:'korean-model-included',acceleration:'cuda-12.3',startedAt:new Date().toISOString(),phase:'not_started',complete:false,passed:0,failed:0,tests:{},installed:false,physicalAudioTest:'pre_recorded_fixture_only',providerConnections:'implemented_live_accounts_not_tested'};
const home=process.env.USERPROFILE||path.resolve(root,'../../..');
const systemRoot=process.env.SystemRoot||'C:\\Windows';
const ps=path.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const cargo=path.join(home,'.cargo/bin/cargo.exe');
Object.assign(process.env,{USERPROFILE:home,HOME:home,SystemRoot:systemRoot,WINDIR:systemRoot,LOCALAPPDATA:process.env.LOCALAPPDATA||path.join(home,'AppData/Local'),APPDATA:process.env.APPDATA||path.join(home,'AppData/Roaming'),CARGO_BUILD_JOBS:'8',NEXT_TELEMETRY_DISABLED:'1',NODE_TLS_REJECT_UNAUTHORIZED:'1'});
process.env.TEMP||=path.join(process.env.LOCALAPPDATA,'Temp');process.env.TMP||=process.env.TEMP;
const cargoTarget=process.env.CARGO_TARGET_DIR||path.join(path.dirname(root),`.stream-record-cargo-${version}`);process.env.CARGO_TARGET_DIR=cargoTarget;
process.env.PATH=[path.dirname(process.execPath),path.dirname(cargo),'C:\\Program Files\\nodejs','C:\\Program Files\\Git\\cmd','C:\\Program Files\\CMake\\bin','C:\\Program Files\\LLVM\\bin',path.dirname(ps),path.join(systemRoot,'System32'),process.env.PATH||''].join(path.delimiter);
const cuda=process.env.CUDA_PATH||'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.3';
assert.ok(fs.existsSync(path.join(cuda,'bin/nvcc.exe')),'CUDA 12.3 nvcc is required for the GTX 1660 Ti release');
process.env.CUDA_PATH=cuda;process.env.PATH=[path.join(cuda,'bin'),process.env.PATH].join(path.delimiter);
process.env.CMAKE_GENERATOR||='Ninja';
process.env.CMAKE_CUDA_FLAGS||='-allow-unsupported-compiler -D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH';
process.env.CMAKE_CUDA_ARCHITECTURES||='75';
process.env.CMAKE_BUILD_PARALLEL_LEVEL||='8';
const cudaRuntimeDir=path.join(frontend,'src-tauri/binaries/cuda');
const cudaRuntimeFiles=['cudart64_12.dll','cublas64_12.dll','cublasLt64_12.dll'];
function prepareCudaRuntime(){
 fs.mkdirSync(cudaRuntimeDir,{recursive:true});
 for(const name of cudaRuntimeFiles){
  const source=path.join(cuda,'bin',name),destination=path.join(cudaRuntimeDir,name);
  assert.ok(fs.existsSync(source),'Missing CUDA 12.3 runtime component: '+name);
  fs.copyFileSync(source,destination);
 }
 fs.writeFileSync(path.join(cudaRuntimeDir,'CUDA-RUNTIME-NOTICE.txt'),[
  'Stream-Record includes NVIDIA CUDA runtime components for local GPU inference.',
  'Components: '+cudaRuntimeFiles.join(', '),
  'Source: NVIDIA CUDA Toolkit 12.3 Update 2 for Windows.',
  'License: https://docs.nvidia.com/cuda/eula/',
  'The installed application does not require a separate CUDA Toolkit installation.',
  ''
 ].join('\r\n'));
}
const clang=path.join(root,'tools/libclang-16');if(fs.existsSync(path.join(clang,'libclang.dll')))process.env.LIBCLANG_PATH=clang;
process.env.CFLAGS=`${process.env.CFLAGS||''} /utf-8`.trim();process.env.CXXFLAGS=`${process.env.CXXFLAGS||''} /utf-8 /EHsc`.trim();
function clean(text){return String(text).replace(/https?:\/\/[^\s<>"']+/g,raw=>{try{const u=new URL(raw);return u.origin+u.pathname+(u.search?'?[query-redacted]':'');}catch{return '[url-redacted]';}});}
function save(){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'package-result.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'tests.json'),JSON.stringify({passed:report.passed,failed:report.failed,complete:report.complete,tests:report.tests},null,2));}
function phase(name){report.phase=name;save();console.log('PHASE '+name);}
function run(exe,args,cwd,label,{allowFailure=false}={}){
 return new Promise((resolve,reject)=>{
  const log=path.join(out,label+'.log');fs.writeFileSync(log,'');let text='';
  const child=spawn(exe,args,{cwd,env:process.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const collect=b=>{const s=clean(b.toString('utf8'));fs.appendFileSync(log,s);text=(text+s).slice(-4*1024*1024);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('error',e=>reject(new Error(label+': '+e.code)));
  child.once('close',code=>{if(code!==0&&!allowFailure)reject(new Error(label+': exit '+code+'; see '+log));else resolve({code,text,log});});
 });
}
async function host(action,extra=[]){const result=await run(ps,['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/windows-release-host.ps1'),'-Action',action,'-SourceRoot',root,...extra],path.dirname(root),'host-'+action);return JSON.parse(result.text);}
async function sourceSnapshot(){
 const result=await buildSnapshot(root);
 result['runtime-companions']=await treeSnapshot(path.join(frontend,'src-tauri/binaries'));
 result['bundled-diarization']=await treeSnapshot(path.join(root,'app/frontend/src-tauri/bundled-diarization'));
 for(const name of [filename,'manifest.json','WHISPER-LICENSE.txt'])result['bundled-models/'+name]=await hashFile(path.join(resourceDir,name));
 return result;
}
async function main(){
 assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--build'),'Explicit --build is required');assert.ok(fs.existsSync(path.join(root,'STREAM_RECORD_FORK.json')));
 fs.mkdirSync(out,{recursive:true});const prior=path.join(out,'package-result.json');if(fs.existsSync(prior))fs.copyFileSync(prior,path.join(out,'prior-'+Date.now()+'.json'));
 phase('preflight');assert.equal(verifyVersions(root),version);
 prepareCudaRuntime();report.cudaRuntime=await treeSnapshot(cudaRuntimeDir);save();
 const tauri=path.join(frontend,'node_modules/@tauri-apps/cli/tauri.js');assert.ok(fs.existsSync(tauri)&&fs.existsSync(cargo));
 await run(process.execPath,['--check',path.join(root,'tools/bundled-model.mjs')],root,'model-helper-syntax');
 await run(process.execPath,['tools/bundled-model.mjs','--self-test'],root,'bundle-policy-tests');report.passed++;report.tests.bundlePolicy='passed';
 await run(process.execPath,[tauri,'--version'],frontend,'tauri-version');
 phase('prepare-verified-bundled-model');report.bundledModel=await prepareModel({allowDownload:true});save();
 phase('test-offline-bootstrap');
 const iconManifest=JSON.parse(fs.readFileSync(path.join(root,'assets/branding/icon-manifest.json'),'utf8'));
 assert.equal(iconManifest.source_sha256,'ad509a00e923e6a69fbbc7c26e1a08be77e72ae6fb45ab138f05a6193ba75f84');
 assert.ok(iconManifest.files.length>0);
 for(const item of iconManifest.files){const file=path.resolve(root,item.path);assert.ok(file.startsWith(root+path.sep));assert.equal(fs.statSync(file).size,item.bytes);assert.equal(await hashFile(file),item.sha256);}
 report.tests.iconManifest={status:'passed',canonicalSha256:iconManifest.source_sha256,files:iconManifest.files.length};
 const config=JSON.parse(fs.readFileSync(path.join(frontend,'src-tauri/tauri.conf.json'),'utf8'));
 for(const property of ['installerIcon','uninstallerIcon'])assert.equal(config.bundle?.windows?.nsis?.[property],'icons/app_icon.ico','NSIS must explicitly use the canonical icon: '+property);
 report.tests.nsisIconConfiguration='passed';
 await run(process.execPath,['scripts/check-ui-contrast.mjs',path.join(out,'ui-contrast.json')],root,'ui-contrast');
 const contrast=JSON.parse(fs.readFileSync(path.join(out,'ui-contrast.json'),'utf8'));assert.equal(contrast.passed,true);report.tests.uiContrast={status:'passed',pairs:contrast.result.length,scope:contrast.scope};
 await run(process.execPath,['tests/stream-record-ui.cjs'],frontend,'ui-session-tests');
 const ui=JSON.parse(fs.readFileSync(path.join(frontend,'test-results/ui-session.json'),'utf8'));assert.equal(ui.failed,0);assert.ok(ui.passed>0);report.tests.uiSession={status:'passed',passed:ui.passed,scope:ui.scope};report.passed+=ui.passed;
 for(const name of ['record-controls','compact-reader','summary-display','glossary-packs']){
  await run(process.execPath,['tests/'+name+'.cjs'],frontend,name+'-tests');
  const checked=JSON.parse(fs.readFileSync(path.join(frontend,'test-results',name+'.json'),'utf8'));assert.equal(checked.failed,0);assert.ok(checked.passed>0);report.tests[name]={status:'passed',passed:checked.passed,scope:checked.scope};report.passed+=checked.passed;
 }
 await run(process.execPath,['tools/test-release-tools.mjs'],root,'release-tool-tests');
 const releaseTools=JSON.parse(fs.readFileSync(path.join(frontend,'test-results/release-tools.json'),'utf8'));assert.equal(releaseTools.failed,0);report.tests.releaseTools={status:'passed',passed:releaseTools.passed,scope:releaseTools.scope};report.passed+=releaseTools.passed;

 await run(process.execPath,['tests/stream-record.cjs'],frontend,'frontend-tests');
 const front=JSON.parse(fs.readFileSync(path.join(frontend,'test-results/stream-record.json'),'utf8'));assert.equal(front.failed,0);assert.ok(front.passed>=42);report.tests.frontend=front.passed;report.passed+=front.passed;
 await run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit'],frontend,'typecheck');report.tests.typecheck='passed';
 await run(cargo,['check','--locked','--features','cuda'],path.join(frontend,'src-tauri'),'rust-check');report.tests.rustCheck='passed';
 const native=await run(cargo,['test','--lib','stream_record_','--locked','--features','cuda','--','--nocapture'],path.join(frontend,'src-tauri'),'rust-tests');
 const counts=native.text.match(/test result: ok\. (\d+) passed; 0 failed/);assert.ok(counts&&Number(counts[1])>=23,'Offline native tests did not pass');report.tests.rust=Number(counts[1]);report.passed+=Number(counts[1]);
 for(const [name,filter,minimum] of [['recordHistory','meeting_ko::record_history::',4],['connections','meeting_ko::connections',14],['diarization','meeting_ko::diarization::tests',4],['queueRecovery','audio::transcription::queue',13],['builtinLimits','summary::summary_engine::client::tests::bounded',2]]){
  const checked=await run(cargo,['test','--lib',filter,'--locked','--features','cuda','--','--nocapture'],path.join(frontend,'src-tauri'),'rust-'+name);
  const result=[...checked.text.matchAll(/test result: ok. ([0-9]+) passed; 0 failed/g)].at(-1);assert.ok(result&&Number(result[1])>=minimum,'Native '+name+' tests incomplete');report.tests[name]={status:'passed',passed:Number(result[1])};report.passed+=Number(result[1]);
 }
 process.env.STREAM_RECORD_BUNDLED_TEST='1';let offline;
 try{offline=await run(cargo,['test','--lib','stream_record_bundled_real_model_loads_offline','--locked','--features','cuda','--','--ignored','--nocapture'],path.join(frontend,'src-tauri'),'real-bundled-model-offline');}
 finally{delete process.env.STREAM_RECORD_BUNDLED_TEST;}
 assert.ok(/BUNDLED_MODEL_OFFLINE_VERIFIED/.test(offline.text)&&/test result: ok\. 1 passed; 0 failed/.test(offline.text));report.tests.realModelOfflineLoad='passed';report.passed++;save();
 const cudaAudio=process.env.STREAM_RECORD_CUDA_TEST_AUDIO;assert.ok(cudaAudio&&fs.existsSync(cudaAudio),'STREAM_RECORD_CUDA_TEST_AUDIO must identify the approved real-audio fixture');
 process.env.STREAM_RECORD_CUDA_TEST='1';let cudaInference;
 try{cudaInference=await run(cargo,['test','--lib','stream_record_bundled_real_cuda_inference','--locked','--features','cuda','--','--ignored','--nocapture'],path.join(frontend,'src-tauri'),'real-cuda-inference');}
 finally{delete process.env.STREAM_RECORD_CUDA_TEST;}
 const cudaMarker=cudaInference.text.match(/CUDA_INFERENCE_VERIFIED compiled=cuda requested=cuda effective=cuda model=small-q5_1 gpu_vram_mb=(\d+) audio_seconds=([0-9.]+) inference_seconds=([0-9.]+) rtf=([0-9.]+) transcript_chars=(\d+)/);
 assert.ok(cudaMarker&&/test result: ok\. 1 passed; 0 failed/.test(cudaInference.text),'CUDA inference gate did not produce complete evidence');
 report.tests.cudaInference={status:'passed',compiled:'cuda',requested:'cuda',effective:'cuda',gpuVramMb:Number(cudaMarker[1]),audioSeconds:Number(cudaMarker[2]),inferenceSeconds:Number(cudaMarker[3]),rtf:Number(cudaMarker[4]),transcriptChars:Number(cudaMarker[5]),inputSha256:await hashFile(cudaAudio)};report.passed++;save();
 phase('build-application');
 await run(cargo,['build','-p','llama-helper','--release','--locked'],path.join(root,'app'),'sidecar-build');
 fs.copyFileSync(path.join(cargoTarget,'release/llama-helper.exe'),path.join(frontend,'src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe'));
 const before=await sourceSnapshot();report.buildInputs=before;save();
 await run(process.execPath,[tauri,'build','--no-bundle','--','--locked','--features','cuda'],frontend,'application-build');
 assert.deepEqual(await sourceSnapshot(),before,'Application input changed during build');
 const appExe=path.join(cargoTarget,'release/stream-record.exe');assert.ok(fs.statSync(appExe).size>0);report.frontendOutput=await treeSnapshot(path.join(frontend,'out'));save();
 phase('package-model-included-installer');const bundleStarted=Date.now();
 const bundle=path.join(cargoTarget,`release/bundle/nsis/stream-record_${version}_x64-setup.exe`);
 const result=await run(process.execPath,[tauri,'bundle','--bundles','nsis','--verbose','--no-sign'],frontend,'nsis-bundle',{allowFailure:true});
 if(result.code!==0)assert.ok(result.text.includes('os error 32'),'Bundler failed for a non-recoverable reason: see '+result.log);
 const stat=fs.statSync(bundle);assert.ok(stat.mtimeMs>=bundleStarted-2000,'Installer is stale');assert.ok(stat.size<700*1024*1024);
 const total=[...result.text.matchAll(/Total size:\s*(\d+)\s*\//g)].at(-1),crc=[...result.text.matchAll(/CRC \(0x([0-9a-f]{8})\):/gi)].at(-1);
 assert.ok(total&&crc,'Completed NSIS size and CRC are required');
 const integrity=verifyNsisBuffer(fs.readFileSync(bundle),{bytes:Number(total[1]),crc32:crc[1]});
 const nsi=fs.readFileSync(path.join(cargoTarget,'release/nsis/x64/installer.nsi'),'utf8');
 for(const name of [filename,'manifest.json','WHISPER-LICENSE.txt'])assert.ok(nsi.includes(name),'NSIS recipe omitted '+name);
 for(const name of [...cudaRuntimeFiles,'CUDA-RUNTIME-NOTICE.txt'])assert.ok(nsi.includes(name),'NSIS recipe omitted '+name);
 for(const name of ['INSTALLERICON','UNINSTALLERICON']){
  const declaration=nsi.split(/\r?\n/).map(line=>line.trim()).find(line=>line.startsWith('!define '+name+' '));
  const emitted=declaration?.match(/^!define [A-Z]+ "([^"]+)"$/)?.[1];
  assert.ok(emitted,'NSIS recipe omitted canonical '+name);
  assert.equal(path.normalize(emitted).toLowerCase(),path.join(frontend,'src-tauri/icons/app_icon.ico').toLowerCase(),'NSIS recipe changed '+name);
 }
 report.tests.nsisIconRecipe='passed';
 for(const file of ['nemo-speech.exe','Nemotron-3-Diarization.q8_0.gguf','nemo_speech_asr.dll'])assert.ok(nsi.includes(file),'NSIS omitted diarization '+file);
 report.tests.diarizationBundled='passed';
 assert.deepEqual(await sourceSnapshot(),before,'Build inputs changed during packaging');
 assert.deepEqual(await treeSnapshot(path.join(frontend,'out')),report.frontendOutput,'Frontend output changed during packaging');
 const installer=path.join(out,`Stream-Record-${version}-korean-bundled-windows-x64-setup.exe`);fs.copyFileSync(bundle,installer);
 assert.equal(await hashFile(installer),integrity.sha256);
 report.installer={path:installer,...integrity};report.builtExeSha256=await hashFile(appExe);
 const installedExe=expectedInstalledExe(fs.readFileSync(appExe));report.installedExeSha256=installedExe.sha256;report.bundleTypeMarker={offset:installedExe.offset,differingBytes:installedExe.differingBytes,note:'NSIS-installed executable equals the built executable except for the Tauri bundle type marker'};
 report.bundlerExitCode=result.code;report.bundlerSharingViolationRecovered=result.code!==0;report.tests.installerIntegrity='passed';report.passed++;save();
 if(process.argv.includes('--install')){
  phase('locate-and-backup-installation');
  const known=path.join(process.env.LOCALAPPDATA,'stream-record/stream-record.exe');
  const installation=await host('Locate',fs.existsSync(known)?['-ExpectedExe',known]:[]);
  // Close uses the helper's user confirmation, never silently terminates a recording.
  await host('Close',['-ExpectedExe',installation.exe]);
  assert.ok(path.dirname(installation.installDir)!==installation.installDir);
  const backup=path.join(out,'installed-backup-'+Date.now());fs.cpSync(installation.installDir,backup,{recursive:true,errorOnExist:true,force:false,dereference:false});report.backup=backup;save();
  phase('install-verified-package');report.installAttempted=true;save();
  const installed=await host('Install',['-Installer',installer,'-ExpectedExe',installation.exe]);
  assert.equal(await hashFile(installed.exe),report.installedExeSha256);
  const installedModel=path.join(path.dirname(installed.exe),'bundled-models',filename);report.installedModel=await verifyModel(installedModel);
  for(const name of ['manifest.json','WHISPER-LICENSE.txt'])assert.equal(await hashFile(path.join(path.dirname(installed.exe),'bundled-models',name)),await hashFile(path.join(resourceDir,name)));
  report.installed=true;report.installedPath=installed.exe;report.tests.installedPayload='hashes_match';save();
 }
 fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),`${report.installer.sha256}  ${path.basename(report.installer.path)}\n${report.bundledModel.sha256}  ${filename}\n`);
 report.complete=true;report.finishedAt=new Date().toISOString();phase('completed');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{report.failed++;report.error=clean(e.message);report.complete=false;save();console.error(report.error);process.exitCode=1;});

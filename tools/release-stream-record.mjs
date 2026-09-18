#!/usr/bin/env node
/** Stream-Record release orchestration. Run only after explicit local approval.
 * --all: dependency downloads, tests, Windows build, safe folder rename, installation,
 *        source commit/push, package upload and GitLab release.
 * --resume-package: reuse a checked local build only; rerun tests, bundle, install and publish.
 * --unsigned: explicitly produce an unsigned installer; never changes Windows/TLS policy.
 * --self-test: offline policy checks ONLY; never starts the application or contacts a server.
 * PAT values stay in process memory/private child pipes and are never written to disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {inspectCompletedInstaller} from './nsis-integrity.mjs';

const VERSION='0.1.0', TAG=`v${VERSION}`;
const HOST='https://gitlab.aigov.go.kr';
const PROJECT='memory365/streamrecord';
const REMOTE=`${HOST}/${PROJECT}.git`;
const ROOT_FILES=['.gitattributes','.gitignore','AGENTS.md','BUILD.cmd','START.cmd','PROJECT.md','README.md','RELEASE_NOTES.md','LICENSE','STREAM_RECORD_FORK.json','UPSTREAM_COMMIT.txt','setup.mjs','apply.mjs','upstream-pin.mjs'];
let root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let out=path.join(root,'outputs',`release-${VERSION}`);
let token=''; let gitEnv=null;
const secrets=[];
const report={version:VERSION,startedAt:new Date().toISOString(),phase:'not_started',complete:false,tests:{},renamed:false,installedAttempted:false,installedVerified:false,pushed:false,releasePublished:false,physicalAudioTest:'not_run'};
const excludedDirs=new Set(['.git','node_modules','target','.next','out','coverage','test-results','logs','work','reports','outputs','.agents','.codex','.omo','.chatgpt2codex','.venv','venv','__pycache__','gen']);
function sourceAllowed(rel){
  const parts=rel.replaceAll('\\','/').split('/');
  const name=parts.at(-1);
  if(parts.some(p=>excludedDirs.has(p)))return false;
  if(/^\.env(?:\.|$)/i.test(name)&&!/(?:example|sample|template)$/i.test(name))return false;
  if(/\.(?:exe|dll|pdb|bin|gguf|wav|mp3|m4a|mp4|sqlite(?:3)?|db|log|pem|key|pfx|p12|whl|tsbuildinfo)$/i.test(name))return false;
  if(/(?:credential|token).*\.secret$|^last-session\.(?:json|tmp)$|^\.DS_Store$/i.test(name))return false;
  if(parts.includes('binaries')||parts.includes('libclang-16'))return false;
  return true;
}
function clean(s){let text=String(s);for(const secret of secrets)if(secret)text=text.split(secret).join('[REDACTED]');return text;}
function emit(s){console.log(clean(s));}
function saveReport(){fs.mkdirSync(out,{recursive:true});const old=path.join(out,'deployment-result.json');const p=report.phase==='not_started'&&fs.existsSync(old)?path.join(out,`resume-refused-${Date.now()}.json`):old;fs.writeFileSync(p+'.tmp',JSON.stringify(report,null,2));fs.renameSync(p+'.tmp',p);}
function phase(name){report.phase=name;saveReport();emit(`PHASE ${name}`);}
function resolveTool(name,extra=[]){
  for(const dir of [...extra,...(process.env.PATH||'').split(path.delimiter)]){
    const p=path.join(dir,name);if(fs.existsSync(p)&&fs.statSync(p).isFile())return p;
  }
  throw new Error(`Required tool not found: ${name}`);
}
async function run(exe,args,cwd,label,{secret=false,env=process.env,timeout=1800000,input=null}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',failed=false;
    const logfile=secret?null:path.join(out,`${label}.log`);
    if(logfile)fs.writeFileSync(logfile,'');
    const timer=setTimeout(()=>{failed=true;child.kill();reject(new Error(`${label}: execution timed out`));},timeout);
    child.stdout.on('data',b=>{if(stdout.length<16*1024*1024)stdout+=b.toString('utf8');if(logfile)fs.appendFileSync(logfile,clean(b.toString('utf8')));});
    child.stderr.on('data',b=>{if(stderr.length<4*1024*1024)stderr+=b.toString('utf8');if(logfile)fs.appendFileSync(logfile,clean(b.toString('utf8')));});
    child.once('error',e=>{clearTimeout(timer);failed=true;reject(new Error(`${label}: could not start (${e.code||'error'})`));});
    child.once('close',code=>{clearTimeout(timer);if(failed)return;if(code!==0){if(!secret)emit((stdout+'\n'+stderr).slice(-9000));reject(new Error(`${label}: exit ${code}; ${secret?'private operation failed':'see '+logfile}`));}else{if(!secret)emit(`PASS ${label}`);resolve(stdout.trim());}});
    if(input!==null)child.stdin.end(input);else child.stdin.end();
  });
}
let ps,git,cargo;
async function host(action,extra=[],secret=false){return run(ps,['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'tools','windows-release-host.ps1'),'-Action',action,'-SourceRoot',root,...extra],path.dirname(root),`host-${action.toLowerCase()}`,{secret,timeout:900000});}
async function hashFile(p){const h=createHash('sha256');for await(const b of fs.createReadStream(p))h.update(b);return h.digest('hex');}
async function http(url,options={}){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(600000),...options});
  return response;
}
async function api(route,method='GET',body){
  const response=await http(`${HOST}/api/v4${route}`,{method,headers:{'PRIVATE-TOKEN':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new Error(`GitLab ${method} ${route.split('?')[0]}: HTTP ${response.status}`);
  return response.status===204?null:response.json();
}
async function authenticate(){
  const candidates=[process.env.GITLAB_TOKEN,process.env.GLAB_TOKEN].filter(Boolean);
  try{const glab=resolveTool('glab.exe');const value=await run(glab,['auth','token','--hostname','gitlab.aigov.go.kr'],root,'existing-auth',{secret:true,timeout:15000});if(value)candidates.push(value);}catch{}
  for(const candidate of candidates){token=candidate;secrets.push(token);try{return await api('/user');}catch{}}
  emit('TOKEN_INPUT_REQUIRED: opening a masked local GitLab token dialog. Do not paste the token into chat.');
  token=await host('Token',[],true);secrets.push(token);
  if(!token||token.length>512||/[\r\n]/.test(token))throw new Error('No valid token supplied. Nothing has been published.');
  return api('/user');
}
async function validateModelManifest(){
  const text=fs.readFileSync(path.join(root,'app/frontend/src-tauri/src/whisper_engine/model_integrity.rs'),'utf8');
  const revision=text.match(/pub const REVISION: &str = "([a-f0-9]{40})";/)?.[1];
  assert.ok(revision,'Whisper revision must be a pinned 40-character commit');
  const block=text.split('pub const MODEL_SHA256:')[1]?.split('];')[0]||'';
  const entries=[...block.matchAll(/\("([a-z0-9_-]+)", "([a-f0-9]{64})"\)/g)];
  assert.equal(entries.length,12,'Expected 12 verified multilingual Whisper entries');
  const response=await http(`https://huggingface.co/api/models/ggerganov/whisper.cpp/revision/${revision}?blobs=true`);
  if(!response.ok)throw new Error(`Whisper metadata verification: HTTP ${response.status}`);
  const metadata=await response.json();assert.equal(metadata.sha,revision);
  for(const [,model,digest] of entries){const entry=metadata.siblings?.find(x=>x.rfilename===`ggml-${model}.bin`);assert.equal(entry?.lfs?.sha256,digest,`Whisper file checksum must match the pinned public metadata: ${model}`);}
  report.tests.modelManifest={passed:12,revision};saveReport();
}
function walkSource(base,relative=''){
  const files=[];
  for(const entry of fs.readdirSync(path.join(base,relative),{withFileTypes:true})){
    const rel=path.join(relative,entry.name);
    if(!sourceAllowed(rel))continue;
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory())files.push(...walkSource(base,rel));
    else if(entry.isFile())files.push(rel);
  }
  return files;
}
function sourceFiles(){
  const files=ROOT_FILES.filter(f=>fs.existsSync(path.join(root,f)));
  for(const dir of ['app','overlay','tests'])for(const rel of walkSource(path.join(root,dir)))files.push(path.join(dir,rel));
  for(const f of ['tools/release-stream-record.mjs','tools/windows-release-host.ps1','tools/test-release-tools.mjs','tools/nsis-integrity.mjs',`docs/releases/${TAG}.md`])files.push(f);
  return [...new Set(files)].sort();
}
async function snapshotSource(files){const result={};for(const rel of files){if(/(?:^|[\\/])next-env\.d\.ts$/.test(rel))continue;result[rel]=await hashFile(path.join(root,rel));}return result;}
function applicationInputs(){
  const files=walkSource(path.join(root,'app')).map(p=>path.join('app',p));
  // Runtime sidecars are build inputs too, although they are not uploaded as source code.
  for(const name of ['llama-helper-x86_64-pc-windows-msvc.exe','ffmpeg-x86_64-pc-windows-msvc.exe','onnxruntime/onnxruntime.dll','onnxruntime/onnxruntime_providers_shared.dll'])files.push(path.join('app/frontend/src-tauri/binaries',name));
  return files.filter(p=>!/(?:^|[\\/])next-env\.d\.ts$/.test(p)).sort();
}
async function preserveCompiledBuild(){
  const checkpoint={version:VERSION,createdAt:new Date().toISOString(),inputs:await snapshotSource(applicationInputs()),exeSha256:await hashFile(path.join(root,'app/target/release/stream-record.exe'))};
  fs.writeFileSync(path.join(out,'compiled-build-checkpoint.json'),JSON.stringify(checkpoint,null,2));
  return checkpoint;
}
async function requireReusableBuild(){
  const checkpointPath=path.join(out,'compiled-build-checkpoint.json');
  const exe=path.join(root,'app/target/release/stream-record.exe');
  if(fs.existsSync(checkpointPath)){
    const checkpoint=JSON.parse(fs.readFileSync(checkpointPath,'utf8'));
    assert.equal(checkpoint.version,VERSION);
    assert.deepEqual(await snapshotSource(applicationInputs()),checkpoint.inputs,'Application inputs changed; run --all instead of reusing a binary');
    assert.equal(await hashFile(exe),checkpoint.exeSha256,'Compiled executable changed; refusing reuse');
    return checkpoint;
  }
  // One-time recovery of the already completed pre-checkpoint build. Never infer this from an EXE alone.
  const previous=JSON.parse(fs.readFileSync(path.join(out,'deployment-result.json'),'utf8'));
  assert.equal(previous.version,VERSION);assert.equal(previous.phase,'build-windows-installer');
  assert.equal(previous.tests?.frontend?.failed,0);assert.ok(previous.tests.frontend.passed>=40);
  assert.equal(previous.tests?.rust?.failed,0);assert.ok(previous.tests.rust.passed>=17);
  assert.equal(previous.tests.typecheck,'passed');assert.equal(previous.tests.rustCheck,'passed');
  assert.equal(previous.installedAttempted,false);assert.equal(previous.pushed,false);
  const started=Date.parse(previous.startedAt),finished=Date.parse(previous.failedAt);
  assert.ok(Number.isFinite(started)&&Number.isFinite(finished)&&finished>=started);
  const log=fs.readFileSync(path.join(out,'installer-build.log'),'utf8');
  assert.ok(log.includes('Finished `release` profile [optimized]')&&log.includes(`Built application at: ${exe}`),'A successful optimized build receipt is required');
  const binaryStat=fs.statSync(exe);assert.ok(binaryStat.size>0&&binaryStat.mtimeMs>=started&&binaryStat.mtimeMs<=finished+2000,'EXE does not belong to the recorded build');
  for(const rel of applicationInputs()){
    // The helper executable is copied by the successful sidecar-build step during the run.
    const limit=rel.replaceAll('\\','/').includes('/binaries/')?finished+2000:started;
    assert.ok(fs.statSync(path.join(root,rel)).mtimeMs<=limit,`Input is newer than the recorded build: ${rel}`);
  }
  fs.copyFileSync(path.join(out,'deployment-result.json'),path.join(out,`prior-build-${Date.now()}.json`));
  const checkpoint=await preserveCompiledBuild();
  checkpoint.initialEvidence='Previous successful build log, executed tests and unchanged input timestamps; subsequent reuse is hash-checked.';
  fs.writeFileSync(checkpointPath,JSON.stringify(checkpoint,null,2));
  return checkpoint;
}
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function smoke(executable,label){
  const port=await freePort();
  const child=spawn(executable,[],{cwd:path.dirname(executable),env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`},stdio:'ignore',windowsHide:false});
  let spawnError;child.on('error',e=>{spawnError=e;});
  let socket;
  try{
    let target;
    for(let n=0;n<80;n++){
      if(spawnError)throw spawnError;
      if(child.exitCode!==null)throw new Error('Smoke-test application exited before UI initialization');
      try{const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)});const pages=await r.json();target=pages.find(p=>p.type==='page'&&/^(?:https?:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(p.url));if(target)break;}catch{}
      await new Promise(r=>setTimeout(r,500));
    }
    assert.ok(target?.webSocketDebuggerUrl,'The built Tauri window did not expose a local smoke-test target');
    const WS=globalThis.WebSocket||createRequire(path.join(root,'app/frontend/package.json'))('ws');
    socket=new WS(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Local WebView connection timed out')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Local WebView test connection failed'));},{once:true});});
    const expression=`(async()=>{await new Promise(r=>setTimeout(r,1500));const invoke=window.__TAURI_INTERNALS__?.invoke;if(!invoke)throw new Error('Tauri IPC is missing');const devices=await invoke('get_audio_devices');const label=[...document.querySelectorAll('label')].find(e=>e.textContent.includes('녹음 입력 장치'));const options=[...(label?.querySelector('select')?.options||[])].map(e=>e.value);const inputs=devices.filter(e=>e.device_type==='Input');const buttons=[...document.querySelectorAll('button')].map(e=>e.textContent);return {version:await invoke('plugin:app|version'),heading:document.querySelector('h1')?.textContent,recording:await invoke('is_recording'),deviceSelectionConsistent:inputs.every(e=>options.includes(e.name)),stereoPresent:inputs.some(e=>/stereo\\s*mix|스테레오\\s*믹스/i.test(e.name)),hasReviewControl:buttons.some(s=>s.includes('원음'))};})()`;
    const value=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('WebView smoke-test timeout')),20000);
      socket.addEventListener('message',event=>{const msg=JSON.parse(typeof event.data==='string'?event.data:event.data.toString());if(msg.id!==1)return;clearTimeout(timer);if(msg.error||msg.result?.exceptionDetails)return reject(new Error('WebView smoke-test evaluation failed'));resolve(msg.result?.result?.value);});
      socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
    });
    assert.equal(value.version,VERSION);assert.equal(value.recording,false);assert.ok(value.heading?.includes('회의록'));assert.equal(value.deviceSelectionConsistent,true);assert.equal(value.hasReviewControl,true);
    report.tests[label]=value;saveReport();emit(`PASS ${label} (no recording or inference was performed)`);
  }finally{
    socket?.close();
    // This process was launched only for this no-recording test; never terminate an unrelated/user process.
    if(child.pid&&child.exitCode===null){child.kill();await new Promise(r=>{const timer=setTimeout(r,5000);child.once('close',()=>{clearTimeout(timer);r();});});}
  }
}
function copySource(files,destination){
  for(const rel of files){assert.ok(sourceAllowed(rel));const src=path.join(root,rel),dest=path.join(destination,rel);assert.ok(!fs.lstatSync(src).isSymbolicLink());if(fs.statSync(src).size>20*1024*1024)throw new Error(`Unexpected large source file: ${rel}`);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest);}
}
async function publishAssets(projectId,files){
  const links=[];
  for(const filename of files){
    const p=path.join(out,filename),digest=await hashFile(p);
    const url=`${HOST}/api/v4/projects/${projectId}/packages/generic/stream-record/${VERSION}/${encodeURIComponent(filename)}`;
    const existing=await http(url,{method:'HEAD',headers:{'PRIVATE-TOKEN':token}});
    if(existing.status===404){const sent=await http(url,{method:'PUT',headers:{'PRIVATE-TOKEN':token,'Content-Type':'application/octet-stream'},body:fs.createReadStream(p),duplex:'half'});if(!sent.ok)throw new Error(`Asset upload failed: ${filename}, HTTP ${sent.status}`);await sent.arrayBuffer();}
    else if(!existing.ok)throw new Error(`Asset lookup failed: ${filename}, HTTP ${existing.status}`);
    const download=await http(url,{headers:{'PRIVATE-TOKEN':token}});if(!download.ok)throw new Error(`Asset verification failed: ${filename}`);
    const hash=createHash('sha256');for await(const b of download.body)hash.update(b);assert.equal(hash.digest('hex'),digest,`Uploaded asset hash mismatch: ${filename}`);
    links.push({name:filename,url,direct_asset_path:`/${filename}`,link_type:filename.endsWith('.exe')?'package':'other'});emit(`VERIFIED ASSET ${filename}`);
  }
  return links;
}
async function main(){
  assert.equal(process.platform,'win32','Release orchestration is Windows-only');
  assert.ok(fs.existsSync(path.join(root,'STREAM_RECORD_FORK.json')),'Independent project marker required');
  const home=process.env.USERPROFILE||path.resolve(root,'../../..');
  process.env.USERPROFILE=home;process.env.HOME=home;
  process.env.SystemRoot||='C:\\Windows';process.env.WINDIR||=process.env.SystemRoot;
  process.env.LOCALAPPDATA||=path.join(home,'AppData','Local');process.env.APPDATA||=path.join(home,'AppData','Roaming');
  process.env.TEMP||=path.join(process.env.LOCALAPPDATA,'Temp');process.env.TMP||=process.env.TEMP;
  process.env.PATH=[path.dirname(process.execPath),path.join(home,'.cargo','bin'),'C:\\Program Files\\nodejs','C:\\Program Files\\Git\\cmd','C:\\Program Files\\CMake\\bin','C:\\Program Files\\LLVM\\bin',path.join(process.env.SystemRoot,'System32'),process.env.PATH||''].join(path.delimiter);
  process.env.CFLAGS=`${process.env.CFLAGS||''} /utf-8`.trim();process.env.CXXFLAGS=`${process.env.CXXFLAGS||''} /utf-8 /EHsc`.trim();
  process.env.CARGO_BUILD_JOBS='2';process.env.NEXT_TELEMETRY_DISABLED='1';delete process.env.CARGO_NET_OFFLINE;
  process.env.GIT_TERMINAL_PROMPT='0';process.env.GCM_INTERACTIVE='Never';process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
  ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');git=resolveTool('git.exe');cargo=resolveTool('cargo.exe');
  fs.mkdirSync(out,{recursive:true});
  const resumeInstaller=process.argv.includes('--resume-installer');
  const resumePackage=process.argv.includes('--resume-package')||resumeInstaller;
  const unsigned=process.argv.includes('--unsigned');
  // Validate old receipts before overwriting any per-run reports or logs.
  if(resumeInstaller){
    assert.ok(unsigned,'Existing-installer recovery requires explicit unsigned packaging');
    const origin=path.join(out,'packaging-origin.json');
    if(!fs.existsSync(origin))fs.copyFileSync(path.join(out,'deployment-result.json'),origin,fs.constants.COPYFILE_EXCL);
  }
  const reused=resumePackage?await requireReusableBuild():null;
  const recoveredInstaller=resumeInstaller?inspectCompletedInstaller(root,VERSION):null;
  if(recoveredInstaller){
    fs.writeFileSync(path.join(out,'completed-installer-receipt.json'),JSON.stringify(recoveredInstaller,null,2));
    report.recoveredInstaller=recoveredInstaller;
    report.bundlerPostprocessing='Previous command returned sharing violation after makensis completed; installer is independently CRC/size/hash validated. No prior bundler success is claimed.';
  }
  report.reusedCompiledBuild=!!reused;report.signingPolicy=unsigned?'unsigned-explicit':'configured';
  phase('preflight');
  const config=JSON.parse(fs.readFileSync(path.join(root,'app/frontend/src-tauri/tauri.conf.json'),'utf8'));assert.equal(config.version,VERSION);assert.deepEqual(config.plugins.updater.endpoints,[]);
  await run(process.execPath,['tools/test-release-tools.mjs',...(resumeInstaller?['--check-completed-installer']:[])],root,'release-tools-tests');
  const inspection=JSON.parse(await host('Inspect'));report.installationDiscovery=inspection;
  let installation=inspection.count===1?inspection.candidates[0]:null;saveReport();
  if(!installation)emit('Installation is not uniquely registered. Tests and build may proceed; a verified existing executable must be selected before any replacement.');
  phase('verify-public-model-checksums');await validateModelManifest();
  phase('prepare-and-test');
  if(fs.existsSync(path.join(root,'tools/libclang-16/libclang.dll')))process.env.LIBCLANG_PATH=path.join(root,'tools/libclang-16');
  await run(process.execPath,['setup.mjs','prepare'],root,'prepare');
  const frontend=path.join(root,'app/frontend');
  // Invoke the installed Node entry point directly: no cmd.exe /c or nested npm.cmd quoting.
  const tauriCli=path.join(frontend,'node_modules/@tauri-apps/cli/tauri.js');
  assert.ok(fs.existsSync(tauriCli),'The installed Tauri CLI entry point is missing');
  await run(process.execPath,[tauriCli,'--version'],frontend,'tauri-cli-preflight',{timeout:30000});
  const inputFiles=sourceFiles(),before=await snapshotSource(inputFiles);
  await run(process.execPath,['tests/run.cjs'],root,'legacy-tests');
  await run(process.execPath,['tests/stream-record.cjs'],frontend,'frontend-tests');
  const frontReport=JSON.parse(fs.readFileSync(path.join(frontend,'test-results/stream-record.json'),'utf8'));assert.equal(frontReport.failed,0);assert.ok(frontReport.passed>=40);report.tests.frontend={passed:frontReport.passed,failed:0};
  await run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit'],frontend,'typecheck');report.tests.typecheck='passed';
  await run(cargo,['check','--locked'],path.join(frontend,'src-tauri'),'rust-check');report.tests.rustCheck='passed';
  const rustOutput=await run(cargo,['test','--lib','stream_record_','--locked','--','--nocapture'],path.join(frontend,'src-tauri'),'rust-tests');
  const testMatch=rustOutput.match(/test result: ok\. (\d+) passed; (\d+) failed/);assert.ok(testMatch&&Number(testMatch[1])>=11&&Number(testMatch[2])===0,'Native tests must really execute and pass');report.tests.rust={passed:Number(testMatch[1]),failed:0};saveReport();
  phase('verify-live-model-download');
  const liveOutput=await run(cargo,['test','--lib','stream_record_live_small_q5_1_download_uses_production_policy','--locked','--','--ignored','--nocapture'],path.join(frontend,'src-tauri'),'live-model-download',{env:{...process.env,STREAM_RECORD_NETWORK_TEST:'1'}});
  const liveProof=liveOutput.match(/LIVE_MODEL_DOWNLOAD_VERIFIED host=([a-z0-9.-]+) bytes=(\d+) sha256_verified=true model=small-q5_1/);
  assert.ok(liveProof&&/test result: ok\. 1 passed; 0 failed/.test(liveOutput),'A successful production-client full model download and SHA-256 check is required');
  report.tests.liveModelDownload={passed:1,failed:0,model:'small-q5_1',host:liveProof[1],bytes:Number(liveProof[2]),sha256Verified:true,installedModel:false};saveReport();
  fs.writeFileSync(path.join(out,'release-tests.json'),JSON.stringify({passed:report.tests.frontend.passed+report.tests.rust.passed,failed:0,executedAt:new Date().toISOString(),scope:'Executed frontend mocked regressions and Rust unit tests; no physical audio capture or model inference.'},null,2));
  phase('build-windows-installer');
  if(!resumePackage){
  await run(cargo,['build','-p','llama-helper','--release','--locked'],path.join(root,'app'),'sidecar-build');
  const sidecar=path.join(root,'app/target/release/llama-helper.exe');assert.ok(fs.existsSync(sidecar));fs.copyFileSync(sidecar,path.join(frontend,'src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe'));
    await run(process.execPath,[tauriCli,'build','--no-bundle','--','--locked'],frontend,'application-build');
    assert.deepEqual(await snapshotSource(inputFiles),before,'Sources changed during application build');
    await preserveCompiledBuild();
  }else{
    assert.deepEqual(await snapshotSource(applicationInputs()),reused.inputs,'Application inputs changed during preparation/tests');
    assert.equal(await hashFile(path.join(root,'app/target/release/stream-record.exe')),reused.exeSha256,'Compiled executable changed during preparation/tests');
  }
  // Bundle only: a packaging retry must not repeat the expensive optimized compilation.
  if(resumeInstaller){
    assert.equal(inspectCompletedInstaller(root,VERSION).sha256,recoveredInstaller.sha256,'Installer changed during verification');
    report.tests.installerIntegrity={bytes:recoveredInstaller.bytes,crc32:recoveredInstaller.crc32,sha256:recoveredInstaller.sha256};
    emit('VERIFIED completed installer; no re-compilation or re-compression performed');
  }else{
    await run(process.execPath,[tauriCli,'bundle','--bundles','nsis','--verbose',...(unsigned?['--no-sign']:[])],frontend,'nsis-bundle');
  }
  assert.deepEqual(await snapshotSource(inputFiles),before,'Sources changed during verification/build; rebuild before publication');
  await preserveCompiledBuild();
  const builtExe=path.join(root,'app/target/release/stream-record.exe');assert.ok(fs.existsSync(builtExe));
  const bundleDir=path.join(root,'app/target/release/bundle/nsis');
  const bundles=fs.readdirSync(bundleDir).filter(n=>n.endsWith('.exe')&&n.includes(VERSION));assert.equal(bundles.length,1,'Expected one versioned NSIS installer');
  const installerName=`Stream-Record-${VERSION}-windows-x64-setup.exe`;fs.copyFileSync(path.join(bundleDir,bundles[0]),path.join(out,installerName));
  report.installer={filename:installerName,sha256:await hashFile(path.join(out,installerName)),bytes:fs.statSync(path.join(out,installerName)).size};report.builtExeSha256=await hashFile(builtExe);saveReport();
  phase('locate-existing-installation');
  if(!installation)emit('INSTALLATION_SELECTION_REQUIRED: select the existing installed stream-record.exe in the local file dialog, not the setup file.');
  installation=JSON.parse(await host('Locate',installation?['-ExpectedExe',installation.exe]:[]));report.originalInstallation=installation;saveReport();
  phase('close-current-app-and-smoke-test');await host('Close',['-ExpectedExe',installation.exe]);await smoke(builtExe,'builtAppSmoke');
  phase('rename-project');
  const parent=path.dirname(root),destination=path.join(parent,'Stream-Record');process.chdir(parent);
  if(root.toLowerCase()!==destination.toLowerCase()){assert.ok(!fs.existsSync(destination),'Stream-Record already exists; refusing to overwrite');fs.renameSync(root,destination);root=destination;out=path.join(root,'outputs',`release-${VERSION}`);}
  report.renamed=true;report.projectRoot=root;saveReport();
  phase('gitlab-authentication');const user=await authenticate();
  const project=await api(`/projects/${encodeURIComponent(PROJECT)}`);assert.equal(project.path_with_namespace,PROJECT);assert.equal(project.default_branch,'main','Review an unexpected default branch before publishing');
  const existingTag=await http(`${HOST}/api/v4/projects/${project.id}/repository/tags/${TAG}`,{headers:{'PRIVATE-TOKEN':token}});assert.equal(existingTag.status,404,'The release tag already exists or cannot be checked; do not overwrite it');
  const basic=Buffer.from(`oauth2:${token}`).toString('base64');secrets.push(basic);
  gitEnv={...process.env,GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:`http.${HOST}/.extraHeader`,GIT_CONFIG_VALUE_0:`Authorization: Basic ${basic}`,GIT_CONFIG_KEY_1:'http.followRedirects',GIT_CONFIG_VALUE_1:'false',GIT_CONFIG_KEY_2:'http.sslVerify',GIT_CONFIG_VALUE_2:'true'};
  phase('backup-and-install');
  const backup=path.join(out,'installed-backup');assert.ok(!fs.existsSync(backup),'Existing backup must be retained; review before retrying installation');
  assert.ok(path.dirname(installation.installDir)!==installation.installDir,'Refusing to back up a filesystem root');fs.cpSync(installation.installDir,backup,{recursive:true,errorOnExist:true,force:false,dereference:false});report.backupPath=backup;saveReport();
  report.installedAttempted=true;saveReport();const installed=JSON.parse(await host('Install',['-Installer',path.join(out,installerName),'-ExpectedExe',installation.exe]));
  assert.equal(await hashFile(installed.exe),report.builtExeSha256,'Installed executable differs from the verified build');assert.ok(String(installed.displayVersion).startsWith(VERSION));report.installedVerified=true;report.installedPath=installed.exe;saveReport();
  await smoke(installed.exe,'installedAppSmoke');
  phase('prepare-source-release');
  const staging=path.join(root,'work',`publish-${TAG}-${Date.now()}`);fs.mkdirSync(path.dirname(staging),{recursive:true});
  await run(git,['clone','--single-branch','--branch','main',REMOTE,staging],root,'clone-release-history',{env:gitEnv});
  const baseCommit=await run(git,['rev-parse','HEAD'],staging,'release-base');
  const files=sourceFiles();copySource(files,staging);
  const verification={version:VERSION,tests:report.tests,installer:report.installer,builtExeSha256:report.builtExeSha256,signingPolicy:report.signingPolicy,packagingRecovery:report.recoveredInstaller||null,packagingNote:report.bundlerPostprocessing||null,physicalAudioTest:'not_run',verifiedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(out,'BUILD_VERIFICATION.json'),JSON.stringify(verification,null,2));
  fs.mkdirSync(path.join(staging,'docs/releases'),{recursive:true});fs.copyFileSync(path.join(out,'BUILD_VERIFICATION.json'),path.join(staging,'docs/releases',`${TAG}-verification.json`));
  fs.copyFileSync(path.join(root,`docs/releases/${TAG}.md`),path.join(staging,'RELEASE_NOTES.md'));
  const manifestLines=[];for(const file of [installerName,'BUILD_VERIFICATION.json'])manifestLines.push(`${await hashFile(path.join(out,file))}  ${file}`);fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),manifestLines.join('\n')+'\n');
  for(const rel of files){const p=path.join(staging,rel);if(fs.statSync(p).size>2*1024*1024)continue;const text=fs.readFileSync(p,'utf8');if(/glpat-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw new Error(`Potential credential in source file; publication stopped: ${rel}`);}
  await run(git,['add','--',...ROOT_FILES.filter(f=>fs.existsSync(path.join(staging,f))),'app','overlay','tests','tools/release-stream-record.mjs','tools/windows-release-host.ps1','tools/test-release-tools.mjs','tools/nsis-integrity.mjs',`docs/releases/${TAG}.md`,`docs/releases/${TAG}-verification.json`],staging,'stage-release');
  for(const required of ['app/frontend/src/components/meeting-ko/KoreanWorkspace.tsx','app/frontend/src-tauri/src/whisper_engine/model_integrity.rs','app/frontend/src-tauri/src/review_audio.rs'])await run(git,['ls-files','--error-unmatch',required],staging,'verify-source-'+path.basename(required));
  emit(await run(git,['diff','--cached','--stat'],staging,'source-diff'));
  let name='',email='';try{name=await run(git,['config','--get','user.name'],staging,'git-author-name',{secret:true});email=await run(git,['config','--get','user.email'],staging,'git-author-email',{secret:true});}catch{}
  name||=user.name||user.username;email||=user.public_email||user.email;
  if(!name||!email)throw new Error('Git author identity is not configured; no invented author identity will be used');
  await run(git,['-c',`user.name=${name}`,'-c',`user.email=${email}`,'commit','-m',`Release Stream-Record ${TAG}: independent Korean transcription and recovery`],staging,'commit-release');
  const commit=await run(git,['rev-parse','HEAD'],staging,'release-commit');
  await run(git,['fetch','origin','main'],staging,'check-remote-before-push',{env:gitEnv});assert.equal(await run(git,['rev-parse','origin/main'],staging,'remote-base'),baseCommit,'Remote main changed; reconcile without force-pushing');
  await run(git,['tag',TAG,commit],staging,'tag-release');
  await run(git,['push','--atomic','origin','HEAD:refs/heads/main',`refs/tags/${TAG}`],staging,'push-release',{env:gitEnv});report.pushed=true;report.commit=commit;report.sourceRepository=staging;saveReport();
  phase('upload-and-verify-release-assets');const links=await publishAssets(project.id,[installerName,'SHA256SUMS.txt','BUILD_VERIFICATION.json']);
  const notes=fs.readFileSync(path.join(root,`docs/releases/${TAG}.md`),'utf8')+`\n\n## 빌드 검증\n\n프런트엔드 ${report.tests.frontend.passed}개 및 Rust ${report.tests.rust.passed}개 통과, TypeScript·Rust 컴파일·설치본 해시 확인 완료. 실제 음성 캡처·인식 정확도·3시간 회의 시험은 미수행입니다.\n\n소스 커밋: \`${commit}\`\n설치파일 SHA-256: \`${report.installer.sha256}\`\n`;
  await api(`/projects/${project.id}/releases`,'POST',{name:`Stream-Record ${TAG}`,tag_name:TAG,description:notes,assets:{links}});
  const release=await api(`/projects/${project.id}/releases/${TAG}`);assert.equal(release.commit.id,commit);for(const link of links)assert.ok(release.assets.links.some(a=>a.name===link.name&&a.url===link.url));
  const remoteReadme=await api(`/projects/${project.id}/repository/files/README.md?ref=${TAG}`);assert.equal(Buffer.from(remoteReadme.content,'base64').toString('utf8'),fs.readFileSync(path.join(root,'README.md'),'utf8'));
  report.releasePublished=true;report.releaseUrl=`${HOST}/${PROJECT}/-/releases/${TAG}`;report.complete=true;report.finishedAt=new Date().toISOString();phase('completed');emit(JSON.stringify(report,null,2));
}
function selfTest(){
  for(const p of ['app/frontend/src/main.ts','app/frontend/src-tauri/src/review_audio.rs','app/Cargo.lock','README.md','tools/windows-release-host.ps1'])assert.ok(sourceAllowed(p),p);
  for(const p of ['app/target/release/app.exe','work/recording.wav','app/.env','app/node_modules/a.js','app/private.key','app/file.gguf','app/src-tauri/binaries/model.bin','app/frontend/tsconfig.tsbuildinfo'])assert.ok(!sourceAllowed(p),p);
  assert.equal(new URL(REMOTE).hostname,'gitlab.aigov.go.kr');assert.equal(new URL(REMOTE).pathname,'/memory365/streamrecord.git');
  assert.equal(createHash('sha256').update('abc').digest('hex'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  console.log('PASS release policy self-test (offline; no process, download, install or publication)');
}
if(process.argv.includes('--self-test'))selfTest();
else if(process.argv.includes('--all')||process.argv.includes('--resume-package')||process.argv.includes('--resume-installer'))main().catch(error=>{report.error=clean(error.message);report.complete=false;report.failedAt=new Date().toISOString();saveReport();console.error(`RELEASE STOPPED: ${report.error}`);console.error(`Actual effects: ${JSON.stringify({renamed:report.renamed,installedAttempted:report.installedAttempted,installedVerified:report.installedVerified,pushed:report.pushed,releasePublished:report.releasePublished})}`);process.exitCode=1;}).finally(()=>{token='';gitEnv=null;secrets.length=0;});
else{console.error('Usage: node tools/release-stream-record.mjs --self-test | --all | --resume-package [--unsigned] | --resume-installer --unsigned');process.exitCode=2;}

#!/usr/bin/env node
/** Owner-approved HF download hotfix verification/build/install.
 * No Git operations, publication, account registration or inference API calls.
 * --build builds a fresh app and unsigned installer; --install also backs up and
 * replaces only the existing installation verified by windows-release-host.ps1.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const frontend=path.join(root,'app/frontend');
const out=path.join(root,'outputs/hf-redirect-fix-20260917');
const report={startedAt:new Date().toISOString(),complete:false,passed:0,failed:0,phase:'not_started',tests:{},installed:false,physicalAudioTest:'not_run',subscriptionAuthentication:'not_verified'};
const home=process.env.USERPROFILE||path.resolve(root,'../../..');
Object.assign(process.env,{USERPROFILE:home,HOME:home,SystemRoot:process.env.SystemRoot||'C:\\Windows',LOCALAPPDATA:process.env.LOCALAPPDATA||path.join(home,'AppData/Local'),APPDATA:process.env.APPDATA||path.join(home,'AppData/Roaming'),CARGO_BUILD_JOBS:'2',NEXT_TELEMETRY_DISABLED:'1',NODE_TLS_REJECT_UNAUTHORIZED:'1'});
process.env.WINDIR||=process.env.SystemRoot;
process.env.TEMP||=path.join(process.env.LOCALAPPDATA,'Temp');process.env.TMP||=process.env.TEMP;
const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
process.env.PATH=[path.dirname(process.execPath),path.join(home,'.cargo/bin'),'C:\\Program Files\\nodejs','C:\\Program Files\\Git\\cmd','C:\\Program Files\\CMake\\bin','C:\\Program Files\\LLVM\\bin',path.dirname(ps),path.join(process.env.SystemRoot,'System32'),process.env.PATH||''].join(path.delimiter);
const clang=path.join(root,'tools/libclang-16');if(fs.existsSync(path.join(clang,'libclang.dll')))process.env.LIBCLANG_PATH=clang;
process.env.CFLAGS=`${process.env.CFLAGS||''} /utf-8`.trim();process.env.CXXFLAGS=`${process.env.CXXFLAGS||''} /utf-8 /EHsc`.trim();
const clean=s=>String(s).replace(/https?:\/\/[^\s<>"']+/g,raw=>{try{const u=new URL(raw);return u.origin+u.pathname+(u.search?'?[query-redacted]':'');}catch{return '[url-redacted]';}});
function save(){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'hotfix-result.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'hotfix-tests.json'),JSON.stringify({passed:report.passed,failed:report.failed,tests:report.tests,complete:report.complete},null,2));}
function phase(name){report.phase=name;save();console.log('PHASE '+name);}
function run(exe,args,cwd,label){return new Promise((resolve,reject)=>{const logfile=path.join(out,label+'.log');fs.writeFileSync(logfile,'');let text='';const child=spawn(exe,args,{cwd,env:process.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});const collect=b=>{const s=clean(b.toString('utf8'));fs.appendFileSync(logfile,s);text=(text+s).slice(-2*1024*1024);};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',e=>reject(new Error(label+': start failed '+e.code)));child.once('close',code=>code===0?resolve(text):reject(new Error(label+': exit '+code+'; see '+logfile)));});}
async function hash(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function host(action,extra=[]){return JSON.parse(await run(ps,['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/windows-release-host.ps1'),'-Action',action,'-SourceRoot',root,...extra],path.dirname(root),'host-'+action));}
async function inspect(){
 const command="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$_.LocalPort -in @(10100,11434)});$listeners=@(foreach($c in $ports){$p=Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue;[pscustomobject]@{port=$c.LocalPort;address=$c.LocalAddress;pid=$c.OwningProcess;process=$p.ProcessName;executable=$p.Path}});$apps=@(Get-Process -Name 'stream-record' -ErrorAction SilentlyContinue|ForEach-Object{[pscustomobject]@{pid=$_.Id;path=$_.Path;version=$_.MainModule.FileVersionInfo.ProductVersion}});[pscustomobject]@{listeners=$listeners;apps=$apps}|ConvertTo-Json -Depth 5 -Compress";
 try{report.host=JSON.parse(await run(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],root,'local-process-inspection'));}catch(e){report.hostInspectionError=clean(e.message);}
 report.proxy={probed:false,authenticationVerified:false,evidence:'local listener inventory only; plaintext loopback request removed'};
 save();
}
async function main(){
 assert.equal(process.platform,'win32');assert.ok(fs.existsSync(path.join(root,'STREAM_RECORD_FORK.json')));fs.mkdirSync(out,{recursive:true});
 const prior=path.join(out,'hotfix-result.json');if(fs.existsSync(prior))fs.copyFileSync(prior,path.join(out,`prior-${Date.now()}.json`));
 phase('inspect-local-app-and-proxy');await inspect();
 phase('verify-official-download-hosts');
 const policy=fs.readFileSync(path.join(frontend,'src-tauri/src/whisper_engine/model_integrity.rs'),'utf8');
 const hostsBlock=policy.split('pub const HF_TRANSPORT_HOSTS:')[1]?.split('];')[0]||'';
 const hosts=new Set([...hostsBlock.matchAll(/"([a-z0-9.-]+)"/g)].map(m=>m[1]));
 const metaResponse=await fetch('https://huggingface.co/.well-known/meta.json',{redirect:'error',signal:AbortSignal.timeout(30000)});assert.ok(metaResponse.ok,'Official HF metadata unavailable');
 const meta=await metaResponse.json();assert.ok(Array.isArray(meta.cdnDomains)&&Array.isArray(meta.lfsDomains));
 for(const hostname of [...meta.cdnDomains,...meta.lfsDomains])assert.ok(hosts.has(hostname),'Official host not covered by the reviewed policy: '+hostname);
 report.tests.officialTransportHosts={covered:true,checkedAt:new Date().toISOString()};save();
 phase('offline-regression-tests');
 await run(process.execPath,['tests/stream-record.cjs'],frontend,'frontend-tests');
 const front=JSON.parse(fs.readFileSync(path.join(frontend,'test-results/stream-record.json'),'utf8'));assert.equal(front.failed,0);assert.ok(front.passed>=40);report.tests.frontend={passed:front.passed,failed:0};report.passed+=front.passed;
 await run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit'],frontend,'typecheck');report.tests.typecheck='passed';
 const cargo=path.join(home,'.cargo/bin/cargo.exe');
 await run(cargo,['check','--locked'],path.join(frontend,'src-tauri'),'rust-check');report.tests.rustCheck='passed';
 const rust=await run(cargo,['test','--lib','stream_record_','--locked','--','--nocapture'],path.join(frontend,'src-tauri'),'rust-tests');
 const counts=rust.match(/test result: ok\. (\d+) passed; (\d+) failed/);assert.ok(counts&&Number(counts[1])>=19&&Number(counts[2])===0);report.tests.rust={passed:Number(counts[1]),failed:0};report.passed+=Number(counts[1]);save();
 phase('live-production-model-download-and-sha256');
 process.env.STREAM_RECORD_NETWORK_TEST='1';
 let live;try{live=await run(cargo,['test','--lib','model_integrity','--locked','--','--ignored','--nocapture'],path.join(frontend,'src-tauri'),'live-model-download');}finally{delete process.env.STREAM_RECORD_NETWORK_TEST;}
 const proof=live.match(/LIVE_MODEL_DOWNLOAD_VERIFIED host=([a-z0-9.-]+) bytes=(\d+) sha256_verified=true model=small-q5_1/);assert.ok(proof&&/test result: ok\. 1 passed; 0 failed/.test(live),'Production downloader test did not pass');report.tests.liveModelDownload={host:proof[1],bytes:Number(proof[2]),sha256Verified:true,model:'small-q5_1',installed:false};report.passed++;save();
 if(process.argv.includes('--build')){
  phase('build-fresh-hotfix-application');
  const tauri=path.join(frontend,'node_modules/@tauri-apps/cli/tauri.js');
  const version=JSON.parse(fs.readFileSync(path.join(frontend,'src-tauri/tauri.conf.json'),'utf8')).version;
  const appExe=path.join(root,'app/target/release/stream-record.exe');
  await run(process.execPath,[tauri,'build','--no-bundle','--','--locked'],frontend,'application-build');
  assert.ok(fs.statSync(appExe).mtimeMs>=Date.parse(report.startedAt),'Executable is not from this hotfix build');
  phase('package-unsigned-hotfix');
  let lastError;for(let attempt=1;attempt<=2;attempt++){try{await run(process.execPath,[tauri,'bundle','--bundles','nsis','--verbose','--no-sign'],frontend,'nsis-bundle-'+attempt);lastError=null;break;}catch(e){lastError=e;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,3000));}}
  if(lastError)throw lastError;
  const bundle=path.join(root,`app/target/release/bundle/nsis/stream-record_${version}_x64-setup.exe`);assert.ok(fs.statSync(bundle).mtimeMs>=Date.parse(report.startedAt));
  const installer=path.join(out,`Stream-Record-${version}-hf-cdn-hotfix-windows-x64-setup.exe`);fs.copyFileSync(bundle,installer);
  report.build={version,installer,sha256:await hash(installer),exeSha256:await hash(appExe),bytes:fs.statSync(installer).size};save();
  if(process.argv.includes('--install')){
   phase('verify-existing-installation');const installation=await host('Locate');
   await host('Close',['-ExpectedExe',installation.exe]);
   const backup=path.join(out,'installed-backup-'+Date.now());assert.ok(path.dirname(installation.installDir)!==installation.installDir);
   fs.cpSync(installation.installDir,backup,{recursive:true,errorOnExist:true,force:false,dereference:false});report.backup=backup;save();
   phase('replace-existing-installation');report.installAttempted=true;save();
   const installed=await host('Install',['-Installer',installer,'-ExpectedExe',installation.exe]);
   assert.equal(await hash(installed.exe),report.build.exeSha256,'Installed executable does not match the hotfix build');report.installed=true;report.installedPath=installed.exe;report.installedHashVerified=true;save();
  }
 }
 report.complete=true;report.finishedAt=new Date().toISOString();phase('completed');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{report.failed++;report.complete=false;report.error=clean(e.message);save();console.error(report.error);process.exitCode=1;});

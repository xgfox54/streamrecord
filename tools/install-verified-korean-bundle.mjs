#!/usr/bin/env node
/** Explicitly approved installation-only retry. No compilation, model download,
 * Git operations, account authentication or microphone use. Existing work is
 * never force-terminated. Original package-result.json remains unmodified. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyInstalledCompanions,expectedInstalledExe} from './release-format.mjs';
import {verifyNsisBuffer} from './nsis-integrity.mjs';
import {verifyVersions,buildSnapshot,treeSnapshot} from './release-inputs.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=verifyVersions(root);
const directory=path.join(root,`outputs/korean-bundled-${version}`);
const name=`Stream-Record-${version}-korean-bundled-windows-x64-setup.exe`;
const model='ggml-small-q5_1.bin';
const installer=path.join(directory,name);
const systemRoot=process.env.SystemRoot||'C:\\Windows';
const home=process.env.USERPROFILE||path.resolve(root,'../../..');
const local=process.env.LOCALAPPDATA||path.join(home,'AppData/Local');
const ps=path.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const known=path.join(local,'stream-record/stream-record.exe');
const state={startedAt:new Date().toISOString(),version,complete:false,installed:false,installAttempted:false,phase:'not_started',physicalAudioTest:'not_run',applicationLaunchTest:'not_run'};
function save(){fs.writeFileSync(path.join(directory,'installation-result.json'),JSON.stringify(state,null,2));}
function phase(value){state.phase=value;save();console.log('PHASE '+value);}
async function hash(file){const digest=createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');}
function regular(file){const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Expected a regular file: '+path.basename(file));return stat;}
async function execute(args,label){return new Promise((resolve,reject)=>{
 const child=spawn(ps,args,{cwd:root,env:{...process.env,USERPROFILE:home,HOME:home,SystemRoot:systemRoot,LOCALAPPDATA:local,APPDATA:process.env.APPDATA||path.join(home,'AppData/Roaming')},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';const logfile=path.join(directory,'install-only-'+label+'.log');fs.writeFileSync(logfile,'');
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const text=chunk.toString('utf8');fs.appendFileSync(logfile,text);output=(output+text).slice(-1024*1024);});
 child.once('error',e=>reject(new Error(label+': '+e.code)));
 child.once('close',code=>code===0?resolve(output.trim()):reject(new Error(label+': exit '+code+'; see '+logfile)));
});}
async function host(action,extra=[]){return JSON.parse(await execute(['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/windows-release-host.ps1'),'-Action',action,'-SourceRoot',root,...extra],action));}
async function waitForUserExit(){
 const command=`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Windows.Forms;while(@(Get-Process -Name 'stream-record' -ErrorAction SilentlyContinue).Count -gt 0){$text='Stream-Record가 아직 실행 중입니다. 녹음, 전사, 요약을 마치고 저장한 뒤 작업표시줄 오른쪽 트레이의 Stream-Record 아이콘에서 종료하세요. 창의 X 버튼은 트레이로 숨기기일 수 있습니다. 완전히 종료한 후 재시도를 누르세요. 취소하면 설치하지 않습니다. 강제 종료는 하지 않습니다.';$answer=[System.Windows.Forms.MessageBox]::Show($text,'Stream-Record 한국어 모델 포함판 설치',[System.Windows.Forms.MessageBoxButtons]::RetryCancel,[System.Windows.Forms.MessageBoxIcon]::Information);if($answer -ne [System.Windows.Forms.DialogResult]::Retry){throw 'Installation cancelled by user before replacement.'}};Write-Output '{"allStreamRecordProcessesExited":true,"forceKilled":false}'`;
 return JSON.parse(await execute(['-NoLogo','-NoProfile','-STA','-Command',command],'wait-for-user-exit'));
}
async function main(){
 assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--install'),'Explicit --install required');
 assert.ok(fs.existsSync(path.join(root,'STREAM_RECORD_FORK.json')));
 const previous=path.join(directory,'installation-result.json');if(fs.existsSync(previous))fs.copyFileSync(previous,path.join(directory,'prior-installation-'+Date.now()+'.json'));
 phase('verify-completed-package');
 const receipt=JSON.parse(fs.readFileSync(path.join(directory,'package-result.json'),'utf8'));
 assert.equal(receipt.complete,true);assert.equal(receipt.version,version);assert.equal(receipt.variant,'korean-model-included');
 assert.equal(receipt.tests?.installerIntegrity,'passed');assert.equal(receipt.tests?.realModelOfflineLoad,'passed');
 assert.equal(receipt.tests?.cudaInference?.status,'passed');assert.equal(receipt.tests.cudaInference.effective,'cuda');
 assert.equal(receipt.tests?.typecheck,'passed');assert.equal(receipt.tests?.rustCheck,'passed');assert.ok(receipt.tests.frontend>=42&&receipt.tests.rust>=23);
 assert.equal(path.resolve(receipt.installer.path).toLowerCase(),installer.toLowerCase());
 const stat=regular(installer);assert.equal(stat.size,receipt.installer.bytes);assert.ok(stat.size<700*1024*1024);
 const integrity=verifyNsisBuffer(fs.readFileSync(installer),receipt.installer);assert.equal(integrity.sha256,receipt.installer.sha256);
 const exe=path.join(root,'app/target/release/stream-record.exe');regular(exe);assert.equal(await hash(exe),receipt.builtExeSha256);
 assert.match(receipt.installedExeSha256,/^[a-f0-9]{64}$/,'Package receipt lacks the expected installed executable hash');
 assert.equal(expectedInstalledExe(fs.readFileSync(exe)).sha256,receipt.installedExeSha256,'Expected installed executable hash does not derive from the built executable');
 assert.match(receipt.bundledModel.sha256,/^[a-f0-9]{64}$/);assert.match(receipt.builtExeSha256,/^[a-f0-9]{64}$/);
 const sourceModel=path.join(root,'app/frontend/src-tauri/bundled-models',model);assert.equal(regular(sourceModel).size,receipt.bundledModel.bytes);assert.equal(await hash(sourceModel),receipt.bundledModel.sha256);
 const buildInputs=await buildSnapshot(root);buildInputs['runtime-companions']=await treeSnapshot(path.join(root,'app/frontend/src-tauri/binaries'));
 for(const file of [model,'manifest.json','WHISPER-LICENSE.txt'])buildInputs['bundled-models/'+file]=await hash(path.join(root,'app/frontend/src-tauri/bundled-models',file));
 assert.deepEqual(buildInputs,receipt.buildInputs,'Inputs changed after verified package');
 assert.deepEqual(await treeSnapshot(path.join(root,'app/frontend/out')),receipt.frontendOutput,'Frontend output changed after package');
 for(const gate of ['iconManifest','uiSession','releaseTools'])assert.equal(receipt.tests[gate]?.status,'passed',gate);
 state.installer={path:installer,...integrity};state.validatedPreviousTests=receipt.tests;save();
 fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),`${integrity.sha256}  ${name}\n${receipt.bundledModel.sha256}  ${model}\n`);
 phase('wait-for-application-exit');await waitForUserExit();
 let installation=await host('Locate',fs.existsSync(known)?['-ExpectedExe',known]:[]);
 assert.equal(path.basename(installation.exe).toLowerCase(),'stream-record.exe');assert.ok(path.dirname(installation.installDir)!==installation.installDir);
 assert.equal(fs.lstatSync(installation.installDir).isSymbolicLink(),false);
 phase('backup-existing-installation');
 const backup=path.join(directory,'installed-backup-'+Date.now());assert.ok(!fs.existsSync(backup));
 fs.cpSync(installation.installDir,backup,{recursive:true,errorOnExist:true,force:false,dereference:false});state.backup=backup;save();
 // The shared installer helper revalidates the target and refuses any running app.
 phase('install-existing-verified-package');state.installAttempted=true;save();
 const installed=await host('Install',['-Installer',installer,'-ExpectedExe',installation.exe]);
 assert.equal(path.resolve(installed.exe).toLowerCase(),path.resolve(installation.exe).toLowerCase());
 assert.equal(await hash(installed.exe),receipt.installedExeSha256,'Installed executable differs from the packaged build');
 assert.ok(String(installed.displayVersion).startsWith(version));
 const installedResources=path.join(path.dirname(installed.exe),'bundled-models');
 assert.equal(regular(path.join(installedResources,model)).size,receipt.bundledModel.bytes);
 assert.equal(await hash(path.join(installedResources,model)),receipt.bundledModel.sha256);
 for(const file of ['manifest.json','WHISPER-LICENSE.txt']){regular(path.join(installedResources,file));assert.equal(await hash(path.join(installedResources,file)),await hash(path.join(root,'app/frontend/src-tauri/bundled-models',file)));}
 state.installedCompanions=await verifyInstalledCompanions(path.dirname(installed.exe),receipt.buildInputs['runtime-companions']);
 state.installed=true;state.installedPath=installed.exe;state.installedPayload='exe-model-manifest-license-hashes-match';state.complete=true;state.finishedAt=new Date().toISOString();phase('completed');console.log(JSON.stringify(state,null,2));
}
main().catch(error=>{state.complete=false;state.error=String(error.message);save();console.error(state.error);process.exitCode=1;});

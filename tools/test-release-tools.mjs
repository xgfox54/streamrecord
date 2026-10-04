// Offline release-tool checks. Never downloads, records, installs, opens UI or publishes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {crc32,verifyNsisBuffer,inspectCompletedInstaller} from './nsis-integrity.mjs';
import {parseTrackedFiles,formatChecksums,validToken,remoteHasCommit,releaseIdentity,expectedInstalledExe} from './release-format.mjs';
import {verifyVersions,sourceAllowed,sourceFiles} from './release-inputs.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=path.join(root,'tools/release-stream-record.mjs');
const helper=path.join(root,'tools/windows-release-host.ps1');
const report={passed:0,failed:0,scope:'Offline syntax and release policy checks; no download, installation, authentication dialog, audio capture or publication.',results:[]};
function test(name,fn){try{fn();report.passed++;report.results.push({name,status:'passed'});console.log('PASS '+name);}catch(e){report.failed++;report.results.push({name,status:'failed',error:e.message});console.error('FAIL '+name+': '+e.message);}}
function run(exe,args){const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,0,(r.stdout||'')+'\n'+(r.stderr||''));return r.stdout;}
test('Release JavaScript syntax',()=>run(process.execPath,['--check',script]));
test('Offline source selection and checksum policy',()=>assert.match(run(process.execPath,[script,'--self-test']),/PASS release policy self-test/));
test('PowerShell helper parses without invoking any action',()=>{
  assert.equal(process.platform,'win32','Run this native syntax test on Windows');
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const p=helper.replaceAll("'","''");
  run(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',`$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('${p}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{Write-Output $_.Message};exit 1};Write-Output 'syntax passed'`]);
});
test('Product versions agree',()=>{
  const p=JSON.parse(fs.readFileSync(path.join(root,'app/frontend/package.json'),'utf8'));
  const lock=JSON.parse(fs.readFileSync(path.join(root,'app/frontend/package-lock.json'),'utf8'));
  const t=JSON.parse(fs.readFileSync(path.join(root,'app/frontend/src-tauri/tauri.conf.json'),'utf8'));
  assert.equal(p.version,verifyVersions(root));assert.equal(lock.version,p.version);assert.equal(lock.packages[''].version,p.version);assert.equal(t.version,p.version);
});
test('Packaging reuse checks receipts, source hashes and binary bytes',()=>{
  const js=fs.readFileSync(script,'utf8');
  assert.ok(js.includes("process.argv.includes('--resume-package')"));
  assert.ok(js.includes('assert.deepEqual(await snapshotSource(applicationInputs()),checkpoint.inputs'));
  assert.ok(js.includes('assert.equal(await hashFile(exe),checkpoint.exeSha256'));
  assert.ok(js.includes("previous.tests.rustCheck,'passed'"));
  assert.ok(js.includes('binaryStat.mtimeMs>=started'));
});
test('Native compilation and verbose bundling are separate',()=>{
  const js=fs.readFileSync(script,'utf8');
  assert.ok(js.includes("[tauriCli,'build','--no-bundle','--','--locked']"));
  assert.ok(js.includes("[tauriCli,'bundle','--bundles','nsis','--verbose'"));
  assert.ok(js.includes('if(!resumePackage){'));
});
test('Unsigned packaging does not disable TLS or model hash validation',()=>{
  const js=fs.readFileSync(script,'utf8');
  assert.ok(js.includes("unsigned?['--no-sign']:[]"));
  assert.ok(js.includes("process.env.NODE_TLS_REJECT_UNAUTHORIZED='1'"));
  assert.ok(js.includes('await validateModelManifest()'));
  assert.ok(js.includes("assert.equal(hash.digest('hex'),digest"));
});
test('Installation names and quoted registry paths are parsed without probing the host',()=>{
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const p=helper.replaceAll("'","''");
  const command=`. '${p}' -Action FunctionsOnly; foreach($name in @('stream-record',' Stream Record v0.0.1 ','stream-record 0.1.0','StreamRecord.exe')) { if(-not (Test-ProductName $name)) { throw ('Rejected valid name: '+$name) } }; foreach($name in @('Meetily','stream-record-tools','stream-record setup','OtherStream-Record')) { if(Test-ProductName $name) { throw ('Accepted unrelated name: '+$name) } }; $a=Get-ExecutableFromRegistration '"C:\\Program Files\\Stream-Record\\uninstall.exe" /S'; if($a -ne 'C:\\Program Files\\Stream-Record\\uninstall.exe') { throw 'Quoted uninstall path mismatch' }; $b=Get-ExecutableFromRegistration 'C:\\Apps\\Stream Record\\stream-record.exe,0'; if($b -ne 'C:\\Apps\\Stream Record\\stream-record.exe') { throw 'Icon path mismatch' }; if(Get-ExecutableFromRegistration '') { throw 'Empty registration unexpectedly resolved' }; Write-Output 'discovery functions passed'`;
  assert.match(run(ps,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command]),/discovery functions passed/);
});
test('Missing installation does not block compilation or select an arbitrary target',()=>{
  const js=fs.readFileSync(script,'utf8'),p=fs.readFileSync(helper,'utf8');
  assert.ok(js.includes('let installation=inspection.count===1?inspection.candidates[0]:null'));
  assert.ok(js.indexOf("phase('build-windows-installer')")<js.indexOf("phase('locate-existing-installation')"));
  assert.ok(js.indexOf("phase('locate-existing-installation')")<js.indexOf("phase('backup-and-install')"));
  assert.ok(p.includes('$picker.CheckFileExists = $true'));
  assert.ok(p.includes('explicit-user-selection'));
  assert.ok(p.includes('Get-VerifiedInstallation $ExpectedExe'));
});
test('Installation path is revalidated and development builds are not install targets',()=>{
  const js=fs.readFileSync(script,'utf8'),p=fs.readFileSync(helper,'utf8');
  assert.ok(js.includes("'-ExpectedExe',installation.exe"));
  assert.ok(p.includes('$file.VersionInfo.ProductName'));
  assert.ok(p.includes('$dir.StartsWith($source'));
  assert.ok(p.includes("-ArgumentList ('/S /D=' + $before.installDir)"));
  assert.ok(p.includes("if ($after.installDir -ine $before.installDir)"));
});
test('Token dialog masks input and release transport avoids token URLs',()=>{
  const p=fs.readFileSync(helper,'utf8'),js=fs.readFileSync(script,'utf8');
  assert.ok(p.includes('$box.UseSystemPasswordChar = $true'));
  assert.ok(p.includes('$box.Clear(); $form.Dispose()'));
  assert.ok(js.includes("await host('Token',[],true)"));
  assert.ok(js.includes("const logfile=secret?null:"));
  assert.ok(js.includes("GIT_CONFIG_KEY_1:'http.followRedirects',GIT_CONFIG_VALUE_1:'false'"));
});
test('Release uses non-force atomic push and verifies installed bytes',()=>{
  const js=fs.readFileSync(script,'utf8');
  assert.ok(js.includes("['push','--atomic','origin','HEAD:refs/heads/main'"));
  assert.ok(!js.includes("['push','--force'"));
  assert.ok(js.includes("assert.equal(await hashFile(installed.exe),report.builtExeSha256"));
  assert.ok(js.includes("assert.equal(hash.digest('hex'),digest"));
});
test('Git ignore keeps standalone app source distributable',()=>{
  const lines=fs.readFileSync(path.join(root,'.gitignore'),'utf8').split(/\r?\n/);
  assert.ok(!lines.includes('app/'));assert.ok(lines.includes('**/target/'));assert.ok(lines.includes('**/.env'));
});
test('Publication-only command syntax and source policy',()=>{
  const publisher=path.join(root,'tools/publish-verified-korean-bundle.mjs');
  run(process.execPath,['--check',publisher]);
  assert.match(run(process.execPath,[publisher,'--self-test']),/PASS verified bundle publication policy/);
});
test('Source selection excludes private data and preserves branding inputs',()=>{
  for(const file of ['app/recordings/session.json','app/.meeting-ko-originals/a.ts','app/meeting-ko-install.json','app/source.rs.backup','app/credentials.json','app/backend/requirements.txt','app/backend/whisper.cpp/bindings/go/whisper.go','app/frontend/src-tauri/src/lib_old_complex.rs','docs/releases/v0.2.0-verification.json'])assert.equal(sourceAllowed(file),false,file);
  assert.equal(sourceAllowed('assets/branding/streamrecord-icon-source.png'),true);
});
test('Published application source contains no embedded remote analytics credential',()=>{
  assert.equal(fs.existsSync(path.join(root,'app/frontend/src-tauri/src/analytics')),false);
  const files=['app/frontend/src-tauri/src/lib.rs'];
  for(const relative of files)assert.doesNotMatch(fs.readFileSync(path.join(root,relative),'utf8'),/phc_[A-Za-z0-9]{20,}/,relative);
});
test('Git NUL output parses distinct tracked source paths',()=>{
  const separator=String.fromCharCode(0),files=['README.md','app/frontend/src/app/page.tsx','assets/branding/streamrecord-icon-source.png'];
  assert.deepEqual(parseTrackedFiles(files.join(separator)+separator),files);
});
test('Checksums and release identity contain real line endings',()=>{
  const lineFeed=String.fromCharCode(10),lines=['a'.repeat(64)+'  first.exe','b'.repeat(64)+'  second.json'];
  assert.deepEqual(formatChecksums(lines).split(lineFeed),[...lines,'']);
  assert.equal(releaseIdentity('commit','hash').split(lineFeed).length,5);
});
test('Token validation accepts ordinary r and n but rejects actual line breaks',()=>{
  assert.equal(validToken('ordinary-token-with-r-and-n'),true);
  assert.equal(validToken('token'+String.fromCharCode(10)+'second'),false);
  assert.equal(validToken('token'+String.fromCharCode(13)+'second'),false);
});
test('Remote ref parser verifies both exact branch and tag names',()=>{
  const tab=String.fromCharCode(9),lineFeed=String.fromCharCode(10),sha='a'.repeat(40);
  assert.equal(remoteHasCommit(sha+tab+'refs/heads/main'+lineFeed+sha+tab+'refs/tags/v0.2.0'+lineFeed,sha,'v0.2.0'),true);
  assert.equal(remoteHasCommit(sha+tab+'refs/heads/other'+lineFeed+sha+tab+'refs/tags/v0.2.0'+lineFeed,sha,'v0.2.0'),false);
});
test('Source inventory omits env variants and case-insensitive private directories',()=>{
  const work=path.join(root,'work');fs.mkdirSync(work,{recursive:true});const fixture=fs.mkdtempSync(path.join(work,'release-policy-'));
  const rejected=['app/backend/temp.env','app/backend/TEMP.ENV.LOCAL','app/.env.example','app/Recordings/session.txt','app/RECOVERY/state.json','app/Cache/private.txt','app/session-copy.json','app/credentials.json'];
  for(const relative of [...rejected,'app/frontend/src/page.tsx']){const file=path.join(fixture,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');}
  assert.deepEqual(sourceFiles(fixture),['app/frontend/src/page.tsx']);
  for(const relative of rejected)assert.equal(sourceAllowed(relative),false,relative);
});
test('Installed executable hash is derived from the built executable through the Tauri bundle type marker only',()=>{
  const built=Buffer.concat([Buffer.from('MZ head text/plain__TAURI_BUNDLE_TYPE_VAR_UNK text/css tail')]);
  const derived=expectedInstalledExe(built);const patched=Buffer.from(built.toString('latin1').replace('_VAR_UNK','_VAR_NSS'),'latin1');
  assert.equal(derived.differingBytes,3);assert.equal(derived.offset,built.indexOf('__TAURI_BUNDLE_TYPE_VAR_UNK'));
  assert.equal(derived.sha256,createHash('sha256').update(patched).digest('hex'));
  assert.throws(()=>expectedInstalledExe(patched),/already patched/);
  assert.throws(()=>expectedInstalledExe(Buffer.from('no marker here')),/lacks the Tauri bundle type marker/);
  assert.throws(()=>expectedInstalledExe(Buffer.concat([built,built])),/more than one/);
  for(const tool of ['tools/install-verified-korean-bundle.mjs','tools/publish-verified-korean-bundle.mjs']){const js=fs.readFileSync(path.join(root,tool),'utf8');assert.ok(js.includes('receipt.installedExeSha256'),tool+' must compare against the derived installed hash');assert.ok(!js.includes("hash(installed.exe),receipt.builtExeSha256")&&!js.includes('installation.installedPath),receipt.builtExeSha256'),tool+' must not expect the unpatched build hash on disk');}
});
test('CRC32 implementation matches the standard check value',()=>assert.equal(crc32(Buffer.from('123456789')),0xcbf43926));
function installerFixture(){
  const bytes=Buffer.alloc(2048);bytes.write('MZ');Buffer.from([0xef,0xbe,0xad,0xde,...Buffer.from('NullsoftInst')]).copy(bytes,516);
  bytes.writeUInt32LE(crc32(bytes.subarray(512,bytes.length-4)),bytes.length-4);
  return {bytes,expected:{bytes:bytes.length,crc32:bytes.readUInt32LE(bytes.length-4).toString(16).padStart(8,'0')}};
}
test('Completed NSIS byte stream validates without running an installer',()=>{const f=installerFixture();assert.equal(verifyNsisBuffer(f.bytes,f.expected).bytes,2048);});
test('Changed installer payload is rejected',()=>{const f=installerFixture();f.bytes[1024]^=1;assert.throws(()=>verifyNsisBuffer(f.bytes,f.expected),/CRC verification failed/);});
test('Truncated installer is rejected',()=>{const f=installerFixture();assert.throws(()=>verifyNsisBuffer(f.bytes.subarray(0,1800),f.expected),/size differs/);});
test('Installer CRC must match the completed build log',()=>{const f=installerFixture();f.expected.crc32='00000000';assert.throws(()=>verifyNsisBuffer(f.bytes,f.expected),/CRC differs/);});
if(process.argv.includes('--check-completed-installer'))test('Actual generated installer matches makensis size and CRC',()=>{report.installerIntegrity=inspectCompletedInstaller(root,verifyVersions(root));});
report.executedAt=new Date().toISOString();const directory=path.join(root,'app/frontend/test-results');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'release-tools.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.failed)process.exitCode=1;

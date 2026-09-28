#!/usr/bin/env node
// Publication only. No builds, app launches, installation, or audio capture.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseTrackedFiles,formatChecksums,validToken,remoteHasCommit,releaseIdentity,verifyInstalledCompanions,expectedInstalledExe} from './release-format.mjs';
import {verifyNsisBuffer} from './nsis-integrity.mjs';
import {sourceAllowed,sourceFiles,sourceSnapshot,buildSnapshot,treeSnapshot,hashFile,verifyVersions} from './release-inputs.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST='https://gitlab.aigov.go.kr', PROJECT='memory365/streamrecord', PROJECT_ID=1092;
const REMOTE=`${HOST}/${PROJECT}.git`;
let token='',gitEnv; const secrets=[];
let out;const report={complete:false,pushed:false,releasePublished:false,startedAt:new Date().toISOString()};
function clean(value){let text=String(value);for(const secret of secrets)text=text.split(secret).join('[REDACTED]');return text;}
function save(){if(out)fs.writeFileSync(path.join(out,'deployment-result.json'),JSON.stringify(report,null,2));}
function phase(value){report.phase=value;save();console.log('PHASE '+value);}
function tool(name,extra=[]){for(const dir of [...extra,...(process.env.PATH||'').split(path.delimiter)]){const file=path.join(dir,name);if(fs.existsSync(file))return file;}throw new Error('Tool unavailable: '+name);}
async function run(exe,args,cwd,label,{secret=false,env=process.env}={}){
 return new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 const log=secret?null:path.join(out,label+'.log');if(log)fs.writeFileSync(log,'');
 child.stdout.on('data',b=>{stdout+=b.toString();if(log)fs.appendFileSync(log,clean(b.toString()));});
 child.stderr.on('data',b=>{stderr+=b.toString();if(log)fs.appendFileSync(log,clean(b.toString()));});
 child.once('error',e=>reject(new Error(label+': '+e.code)));child.once('close',code=>code===0?resolve(stdout.trim()):reject(new Error(label+': exit '+code+(secret?'':'; see '+log))));
 });
}
async function http(url,options={}){return fetch(url,{redirect:'error',signal:AbortSignal.timeout(600000),...options});}
async function api(route,method='GET',body){const response=await http(`${HOST}/api/v4${route}`,{method,headers:{'PRIVATE-TOKEN':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,`GitLab ${method} ${route.split('?')[0]}: HTTP ${response.status}`);return response.status===204?null:response.json();}
async function authenticate(){
 const candidates=[process.env.GITLAB_TOKEN,process.env.GLAB_TOKEN].filter(Boolean);
 try{candidates.push(await run(tool('glab.exe'),['auth','token','--hostname','gitlab.aigov.go.kr'],root,'existing-auth',{secret:true}));}catch{}
 for(const candidate of candidates){token=candidate;secrets.push(token);try{return await api('/user');}catch{}}
 const ps=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 console.log('TOKEN_INPUT_REQUIRED: masked local GitLab dialog; never paste tokens in chat.');
 token=await run(ps,['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/windows-release-host.ps1'),'-Action','Token','-SourceRoot',root],root,'masked-token',{secret:true});secrets.push(token);
 assert.ok(validToken(token),'Invalid token input');return api('/user');
}
async function verifyPackage(version){
 const receipt=JSON.parse(fs.readFileSync(path.join(out,'package-result.json'),'utf8'));
 assert.equal(receipt.complete,true);assert.equal(receipt.version,version);assert.equal(receipt.variant,'korean-model-included');
 for(const test of ['typecheck','rustCheck','realModelOfflineLoad','installerIntegrity'])assert.equal(receipt.tests[test],'passed',test);
 assert.equal(receipt.tests?.cudaInference?.status,'passed');assert.equal(receipt.tests.cudaInference.effective,'cuda');
 assert.ok(receipt.tests.frontend>=42&&receipt.tests.rust>=23);
 for(const gate of ['iconManifest','uiSession','releaseTools'])assert.equal(receipt.tests[gate]?.status,'passed',gate);
 const name=`Stream-Record-${version}-korean-bundled-windows-x64-setup.exe`, installer=path.join(out,name);
 assert.equal(path.resolve(receipt.installer.path).toLowerCase(),installer.toLowerCase());
 verifyNsisBuffer(fs.readFileSync(installer),receipt.installer);
 assert.equal(await hashFile(installer),receipt.installer.sha256);
 assert.equal(await hashFile(path.join(root,'app/target/release/stream-record.exe')),receipt.builtExeSha256);
 const inputs=await buildSnapshot(root);inputs['runtime-companions']=await treeSnapshot(path.join(root,'app/frontend/src-tauri/binaries'));
 for(const file of ['ggml-small-q5_1.bin','manifest.json','WHISPER-LICENSE.txt'])inputs['bundled-models/'+file]=await hashFile(path.join(root,'app/frontend/src-tauri/bundled-models',file));
 assert.deepEqual(inputs,receipt.buildInputs,'Application/build inputs changed after verified package');
 assert.deepEqual(await treeSnapshot(path.join(root,'app/frontend/out')),receipt.frontendOutput,'Frontend output changed after package');
 assert.equal(inputs['bundled-models/ggml-small-q5_1.bin'],receipt.bundledModel.sha256);
 const installation=JSON.parse(fs.readFileSync(path.join(out,'installation-result.json'),'utf8'));
 assert.equal(installation.version,version);assert.equal(installation.complete,true);assert.equal(installation.installed,true);
 assert.equal(installation.installer.sha256,receipt.installer.sha256);
 assert.match(receipt.installedExeSha256,/^[a-f0-9]{64}$/);assert.equal(expectedInstalledExe(fs.readFileSync(path.join(root,'app/target/release/stream-record.exe'))).sha256,receipt.installedExeSha256);
 assert.equal(await hashFile(installation.installedPath),receipt.installedExeSha256);
 for(const file of ['ggml-small-q5_1.bin','manifest.json','WHISPER-LICENSE.txt'])assert.equal(await hashFile(path.join(path.dirname(installation.installedPath),'bundled-models',file)),inputs['bundled-models/'+file]);
 await verifyInstalledCompanions(path.dirname(installation.installedPath),receipt.buildInputs['runtime-companions']);
 const evidenceArg=process.argv.indexOf('--ui-evidence');assert.ok(evidenceArg>0&&process.argv[evidenceArg+1],'--ui-evidence <JSON> required');
 const evidence=JSON.parse(fs.readFileSync(path.resolve(process.argv[evidenceArg+1]),'utf8'));
 assert.equal(evidence.version,version);assert.equal(evidence.status,'passed');assert.equal(evidence.installedExeSha256,receipt.installedExeSha256);
 assert.ok(Array.isArray(evidence.evidenceFiles)&&evidence.evidenceFiles.length>0,'Installed UI evidence files required');
 for(const file of evidence.evidenceFiles){assert.ok(path.isAbsolute(file.path));assert.equal(await hashFile(file.path),file.sha256);}
 return {receipt,installation,evidence,name};
}
async function upload(version,files){
 const links=[];
 for(const name of files){const file=path.join(out,name),sha256=await hashFile(file);const url=`${HOST}/api/v4/projects/${PROJECT_ID}/packages/generic/stream-record/${version}/${encodeURIComponent(name)}`;
 const exists=await http(url,{method:'HEAD',headers:{'PRIVATE-TOKEN':token}});
 assert.equal(exists.status,404,'Release asset already exists or cannot be checked: '+name);
 const sent=await http(url,{method:'PUT',headers:{'PRIVATE-TOKEN':token,'Content-Type':'application/octet-stream'},body:fs.createReadStream(file),duplex:'half'});assert.ok(sent.ok,`Upload failed: ${name}, HTTP ${sent.status}`);await sent.arrayBuffer();
 const download=await http(url);assert.ok(download.ok,'Public download failed: '+name);const digest=createHash('sha256');let bytes=0;for await(const chunk of download.body){digest.update(chunk);bytes+=chunk.length;}assert.equal(digest.digest('hex'),sha256);assert.equal(bytes,fs.statSync(file).size);
 links.push({name,url,link_type:'package'});report.uploadedAssets??=[];report.uploadedAssets.push({name,url,sha256,bytes});save();
 }return links;
}
async function main(){
 assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--publish'),'Explicit --publish required');const version=verifyVersions(root),tag=`v${version}`;
 out=path.join(root,'outputs',`korean-bundled-${version}`);assert.ok(fs.existsSync(out));report.version=version;
 const old=path.join(out,'deployment-result.json');if(fs.existsSync(old))fs.copyFileSync(old,path.join(out,`prior-deployment-${Date.now()}.json`));
 phase('verify-final-package-installation-ui');const {receipt,installation,evidence,name}=await verifyPackage(version);
 for(const file of ['README.md','RELEASE_NOTES.md','docs/UI_ACCEPTANCE_REPORT.md'])assert.ok(fs.existsSync(path.join(root,file)),file);
 assert.ok(fs.readFileSync(path.join(root,'README.md'),'utf8').includes(version),'README version missing');
 assert.ok(fs.readFileSync(path.join(root,'RELEASE_NOTES.md'),'utf8').includes(version),'Release notes version missing');
 const snapshot=await sourceSnapshot(root);report.sourceSnapshot=snapshot;
 for(const relative of Object.keys(snapshot)){const file=path.join(root,relative);assert.ok(fs.statSync(file).size<=20*1024*1024,'Unexpected large source file: '+relative);const text=fs.readFileSync(file,'utf8');assert.ok(!/glpat-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text),'Potential credential in source: '+relative);}
 const verification={version,signingPolicy:'unsigned',tests:receipt.tests,installer:{...receipt.installer,path:name},builtExeSha256:receipt.builtExeSha256,installedExeSha256:receipt.installedExeSha256,bundleTypeMarker:receipt.bundleTypeMarker,buildInputs:receipt.buildInputs,frontendOutput:receipt.frontendOutput,sourceSnapshot:snapshot,bundlerExitCode:receipt.bundlerExitCode,bundlerSharingViolationRecovered:receipt.bundlerSharingViolationRecovered,installedPayload:installation.installedPayload,installedUi:{version:evidence.version,status:evidence.status,installedExeSha256:evidence.installedExeSha256,evidenceFiles:evidence.evidenceFiles.map(file=>({name:path.basename(file.path),sha256:file.sha256}))},physicalAudioTest:receipt.physicalAudioTest||'not_run',verifiedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(out,'BUILD_VERIFICATION.json'),JSON.stringify(verification,null,2));
 fs.copyFileSync(path.join(root,'docs/UI_ACCEPTANCE_REPORT.md'),path.join(out,'UI_ACCEPTANCE_REPORT.md'));fs.copyFileSync(path.join(root,'RELEASE_NOTES.md'),path.join(out,'RELEASE_NOTES.md'));
 const assets=[name,'BUILD_VERIFICATION.json','UI_ACCEPTANCE_REPORT.md','RELEASE_NOTES.md'];const sums=[];for(const file of assets)sums.push(`${await hashFile(path.join(out,file))}  ${file}`);fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),formatChecksums(sums));assets.push('SHA256SUMS.txt');
 phase('authenticate-exact-project');const user=await authenticate(),project=await api(`/projects/${PROJECT_ID}`);
 assert.equal(project.path_with_namespace,PROJECT);assert.equal(project.http_url_to_repo,REMOTE);assert.equal(project.visibility,'public');assert.equal(project.default_branch,'main');
 const branch=await api(`/projects/${PROJECT_ID}/repository/branches/main`);assert.equal(branch.can_push,true,'Current user cannot push main');
 const existing=await http(`${HOST}/api/v4/projects/${PROJECT_ID}/repository/tags/${tag}`,{headers:{'PRIVATE-TOKEN':token}});assert.equal(existing.status,404,'Tag exists or cannot be checked; never overwrite');
 const basic=Buffer.from(`oauth2:${token}`).toString('base64');secrets.push(basic);
 gitEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:`http.${HOST}/.extraHeader`,GIT_CONFIG_VALUE_0:`Authorization: Basic ${basic}`,GIT_CONFIG_KEY_1:'http.followRedirects',GIT_CONFIG_VALUE_1:'false',GIT_CONFIG_KEY_2:'http.sslVerify',GIT_CONFIG_VALUE_2:'true'};
 const git=tool('git.exe',['C:/Program Files/Git/cmd']);const stage=path.join(root,'work',`publish-${tag}-${Date.now()}`);assert.ok(!fs.existsSync(stage));fs.mkdirSync(path.dirname(stage),{recursive:true});report.sourceRepository=stage;
 phase('stage-source-from-current-main');await run(git,['clone','--single-branch','--branch','main',REMOTE,stage],root,'clone-main',{env:gitEnv});
 const base=await run(git,['rev-parse','HEAD'],stage,'base');assert.equal(base,branch.commit.id,'Remote main changed during clone');
 // This removal is confined to the fresh clone, never the user's nested app repository.
 await run(git,['rm','-r','--ignore-unmatch','--','.'],stage,'replace-tracked-source');
 for(const relative of Object.keys(snapshot)){const dest=path.join(stage,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,relative),dest);assert.equal(await hashFile(dest),snapshot[relative]);}
 await run(git,['add','--force','--all'],stage,'stage-all');const tracked=parseTrackedFiles(await run(git,['ls-files','-z'],stage,'tracked-source'));for(const file of tracked)assert.ok(sourceAllowed(file),'Forbidden tracked source: '+file);for(const file of Object.keys(snapshot))assert.ok(tracked.includes(file),'Source omitted by ignore rules: '+file);
 let author='',email='';try{author=await run(git,['config','--get','user.name'],stage,'author',{secret:true});email=await run(git,['config','--get','user.email'],stage,'email',{secret:true});}catch{}
 author||=user.name||user.username;email||=user.public_email||user.email;assert.ok(author&&email,'Git author identity unavailable');
 await run(git,['-c',`user.name=${author}`,'-c',`user.email=${email}`,'commit','-m',`Release Stream-Record ${tag}: KRDS UI and bundled Korean model`],stage,'commit');const commit=await run(git,['rev-parse','HEAD'],stage,'commit-id');report.commit=commit;save();
 assert.deepEqual(await sourceSnapshot(root),snapshot,'Source changed while preparing publication');
 await run(git,['fetch','origin','main'],stage,'recheck-main',{env:gitEnv});assert.equal(await run(git,['rev-parse','origin/main'],stage,'remote-base'),base,'Remote advanced; reconcile without force');
 await run(git,['tag',tag,commit],stage,'new-tag');phase('atomic-nonforce-push');
 try{await run(git,['push','--atomic','origin','HEAD:refs/heads/main',`refs/tags/${tag}`],stage,'push',{env:gitEnv});}
 catch(error){const refs=await run(git,['ls-remote','origin','refs/heads/main',`refs/tags/${tag}`],stage,'check-uncertain-push',{env:gitEnv});report.remoteRefsAfterPushError=refs;report.pushed=remoteHasCommit(refs,commit,tag);save();throw error;}
 report.pushed=true;save();phase('upload-and-public-download-check');const links=await upload(version,assets);
 const notes=fs.readFileSync(path.join(root,'RELEASE_NOTES.md'),'utf8')+releaseIdentity(commit,receipt.installer.sha256);
 await api(`/projects/${PROJECT_ID}/releases`,'POST',{name:`Stream-Record ${tag}`,tag_name:tag,description:notes,assets:{links}});
 const release=await api(`/projects/${PROJECT_ID}/releases/${tag}`),finalBranch=await api(`/projects/${PROJECT_ID}/repository/branches/main`),finalTag=await api(`/projects/${PROJECT_ID}/repository/tags/${tag}`);
 assert.equal(release.commit.id,commit);assert.equal(finalBranch.commit.id,commit);assert.equal(finalTag.commit.id,commit);for(const link of links)assert.ok(release.assets.links.some(item=>item.name===link.name&&item.url===link.url));
 const readme=await api(`/projects/${PROJECT_ID}/repository/files/README.md?ref=${tag}`);assert.equal(Buffer.from(readme.content,'base64').toString('utf8'),fs.readFileSync(path.join(root,'README.md'),'utf8'));
 report.releasePublished=true;report.releaseUrl=`${HOST}/${PROJECT}/-/releases/${tag}`;report.complete=true;report.finishedAt=new Date().toISOString();phase('completed');console.log(JSON.stringify({version,commit,releaseUrl:report.releaseUrl,complete:true}));
}
function selfTest(){
 for(const file of ['README.md','assets/branding/streamrecord-icon-source.png','scripts/generate-app-icons.mjs','tools/publish-verified-korean-bundle.mjs','docs/UI_ACCEPTANCE_REPORT.md','app/frontend/src-tauri/icons/app_icon.ico','app/Cargo.lock'])assert.ok(sourceAllowed(file),file);
 for(const file of ['work/x.md','app/.env.example','app/target/x.exe','app/frontend/src-tauri/bundled-models/manifest.json','app/secret.key','assets/a.zip','app/frontend/test-results/report.json','app/last-session.json','app/backend/requirements.txt','app/frontend/src-tauri/src/lib_old_complex.rs','docs/releases/v0.2.0-verification.json'])assert.ok(!sourceAllowed(file),file);
 assert.equal(new URL(REMOTE).pathname,'/memory365/streamrecord.git');console.log('PASS verified bundle publication policy self-test (offline)');
}
if(process.argv.includes('--self-test'))selfTest();
else if(process.argv.includes('--publish'))main().catch(error=>{report.error=clean(error.message);report.complete=false;report.failedAt=new Date().toISOString();save();console.error('PUBLICATION STOPPED: '+report.error);console.error(JSON.stringify({pushed:report.pushed,releasePublished:report.releasePublished}));process.exitCode=1;}).finally(()=>{token='';gitEnv=null;secrets.length=0;});
else{console.error('Usage: node tools/publish-verified-korean-bundle.mjs --self-test | --publish --ui-evidence <installed-ui-evidence.json>');process.exitCode=2;}

#!/usr/bin/env node
// Build-time preparation only. The installed app never invokes this downloader.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const resourceDir=path.join(root,'app/frontend/src-tauri/bundled-models');
export const modelId='small-q5_1';
export const filename='ggml-small-q5_1.bin';
export const expectedBytes=190085487;
export function readPolicy(){
 const text=fs.readFileSync(path.join(root,'app/frontend/src-tauri/src/whisper_engine/model_integrity.rs'),'utf8');
 const revision=text.match(/pub const REVISION: &str = "([0-9a-f]{40})";/)?.[1];
 const sha256=text.match(/\("small-q5_1", "([0-9a-f]{64})"\)/)?.[1];
 const block=text.split('pub const HF_TRANSPORT_HOSTS:')[1]?.split('];')[0]||'';
 const hosts=new Set([...block.matchAll(/"([a-z0-9.-]+)"/g)].map(m=>m[1]));
 assert.ok(revision&&sha256&&hosts.has('huggingface.co'),'Missing pinned native model policy');
 return {revision,sha256,hosts,url:`https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/${filename}`};
}
export function allowedUrl(raw,hosts){
 try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&hosts.has(u.hostname);}catch{return false;}
}
export async function hashFile(file){const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
export async function verifyModel(file,policy=readPolicy()){
 const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Model must be a regular file');
 assert.equal(stat.size,expectedBytes,'Bundled model size mismatch');
 assert.equal(await hashFile(file),policy.sha256,'Bundled model SHA-256 mismatch');
 return {modelId,filename,bytes:stat.size,sha256:policy.sha256,revision:policy.revision,source:policy.url,license:'MIT',defaultLanguage:'ko'};
}
async function download(policy,temp){
 let url=policy.url;let response;
 for(let hop=0;hop<=5;hop++){
  assert.ok(allowedUrl(url,policy.hosts),'Unapproved model transport host');
  response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(1800000),headers:{'User-Agent':'Stream-Record-model-bundler','Cache-Control':'no-cache'}});
  if([301,302,303,307,308].includes(response.status)){
   const next=response.headers.get('location');await response.body?.cancel();
   assert.ok(next&&hop<5,'Model redirect limit exceeded');url=new URL(next,url).href;continue;
  }
  assert.equal(response.status,200,`Model download returned HTTP ${response.status}`);break;
 }
 assert.ok(response?.body&&response.status===200,'Model body unavailable');
 const file=await fs.promises.open(temp,'wx');let count=0;const digest=createHash('sha256');let lastProgress=0;
 try{
  for await(const chunk of response.body){
   count+=chunk.length;assert.ok(count<=expectedBytes,'Model exceeded the pinned byte count');digest.update(chunk);
   let offset=0;while(offset<chunk.length){const written=await file.write(chunk,offset,chunk.length-offset);assert.ok(written.bytesWritten>0);offset+=written.bytesWritten;}
   const progress=Math.floor(count/expectedBytes*10);if(progress>lastProgress){lastProgress=progress;console.log(`MODEL_DOWNLOAD ${progress*10}%`);}
  }
  assert.equal(count,expectedBytes);assert.equal(digest.digest('hex'),policy.sha256);await file.sync();
 }finally{await file.close();}
 console.log('MODEL_DOWNLOAD_VERIFIED host='+new URL(url).hostname+' bytes='+count);
}
export async function prepareModel({allowDownload=false}={}){
 const policy=readPolicy();fs.mkdirSync(resourceDir,{recursive:true});const model=path.join(resourceDir,filename);
 if(!fs.existsSync(model)){
  assert.ok(allowDownload,'Bundled model is absent. Run the explicitly approved build-time preparation.');
  const temp=path.join(resourceDir,`.download-${randomUUID()}`);
  try{await download(policy,temp);await verifyModel(temp,policy);try{fs.linkSync(temp,model);}catch(e){if(e.code!=='EEXIST')throw e;await verifyModel(model,policy);}}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 const manifest=await verifyModel(model,policy);
 assert.ok(fs.existsSync(path.join(resourceDir,'WHISPER-LICENSE.txt')),'Model license notice must ship with the model');
 const tempManifest=path.join(resourceDir,`.manifest-${randomUUID()}.tmp`);
 fs.writeFileSync(tempManifest,JSON.stringify({schemaVersion:1,...manifest},null,2)+'\n');fs.renameSync(tempManifest,path.join(resourceDir,'manifest.json'));
 return manifest;
}
function selfTest(){
 const policy=readPolicy();
 assert.equal(allowedUrl(policy.url,policy.hosts),true);
 for(const url of ['https://huggingface.co.evil.test/x','http://huggingface.co/x','https://meetily.ai/x','https://user@huggingface.co/x','https://huggingface.co:8443/x'])assert.equal(allowedUrl(url,policy.hosts),false);
 const win=JSON.parse(fs.readFileSync(path.join(root,'app/frontend/src-tauri/tauri.windows.conf.json'),'utf8'));
 for(const name of [filename,'manifest.json','WHISPER-LICENSE.txt'])assert.equal(win.bundle.resources['bundled-models/'+name],'bundled-models/'+name);
 const source=fs.readFileSync(path.join(root,'app/frontend/src/components/meeting-ko/korean-model.ts'),'utf8');assert.ok(source.includes('ko_prepare_bundled_whisper'));assert.ok(!source.includes('WhisperAPI.downloadModel'));
 console.log('PASS bundled model policy, resource mapping, offline default and denied hosts');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--self-test'))selfTest();
 else if(process.argv.includes('--prepare'))prepareModel({allowDownload:true}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error('BUNDLED MODEL PREPARATION FAILED: '+e.message.replace(/https?:\/\/\S+/g,'[url-redacted]'));process.exitCode=1;});
 else if(process.argv.includes('--verify'))verifyModel(path.join(resourceDir,filename)).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});
 else{console.error('Use --self-test, --prepare (downloads a model), or --verify');process.exitCode=2;}
}

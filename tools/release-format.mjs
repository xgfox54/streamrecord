import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hashFile} from './release-inputs.mjs';

export function parseTrackedFiles(output) {return output.split('\0').filter(Boolean);}
export function formatChecksums(lines) {return lines.join('\n')+'\n';}
export function validToken(value) {return typeof value==='string'&&value.length>0&&value.length<=512&&!/[\r\n]/.test(value);}
export function remoteHasCommit(refs,commit,tag) {
 const entries=new Map(refs.trim().split(/\r?\n/).map(line=>{const [sha,ref]=line.split('\t');return [ref,sha];}));
 return entries.get('refs/heads/main')===commit&&entries.get(`refs/tags/${tag}`)===commit;
}
export function releaseIdentity(commit,sha256) {return `\n\nSource commit: ${commit}\nInstaller SHA-256: ${sha256}\n`;}
// Tauri's bundler rewrites this marker inside the executable to "NSS" before makensis embeds it,
// then restores the built file. The installed binary therefore differs from the built one only here.
const bundleTypeMarker={built:Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK'),installed:Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS')};
export function expectedInstalledExe(built) {
 assert.equal(built.indexOf(bundleTypeMarker.installed),-1,'Built executable is already patched for NSIS');
 const offset=built.indexOf(bundleTypeMarker.built);
 assert.ok(offset>=0,'Built executable lacks the Tauri bundle type marker');
 assert.equal(built.indexOf(bundleTypeMarker.built,offset+1),-1,'Built executable has more than one bundle type marker');
 const patched=Buffer.concat([built.subarray(0,offset),bundleTypeMarker.installed,built.subarray(offset+bundleTypeMarker.built.length)]);
 return {offset,sha256:createHash('sha256').update(patched).digest('hex'),differingBytes:3};
}
const companions={
 'ffmpeg-x86_64-pc-windows-msvc.exe':'ffmpeg.exe',
 'llama-helper-x86_64-pc-windows-msvc.exe':'llama-helper.exe',
 'onnxruntime/onnxruntime.dll':'onnxruntime.dll',
 'onnxruntime/onnxruntime_providers_shared.dll':'onnxruntime_providers_shared.dll',
 'onnxruntime/onnxruntime-LICENSE.txt':'onnxruntime-LICENSE.txt',
 'cuda/cublas64_12.dll':'cublas64_12.dll',
 'cuda/cublasLt64_12.dll':'cublasLt64_12.dll',
 'cuda/cudart64_12.dll':'cudart64_12.dll',
 'cuda/CUDA-RUNTIME-NOTICE.txt':'CUDA-RUNTIME-NOTICE.txt',
};
export async function verifyInstalledCompanions(directory,snapshot) {
 assert.deepEqual(Object.keys(snapshot).sort(),Object.keys(companions).sort(),'Runtime companion mapping changed; review installer mapping');
 const hashes={};
 for(const [source,destination] of Object.entries(companions)){hashes[destination]=await hashFile(path.join(directory,destination));assert.equal(hashes[destination],snapshot[source],'Installed runtime differs: '+destination);}
 return hashes;
}

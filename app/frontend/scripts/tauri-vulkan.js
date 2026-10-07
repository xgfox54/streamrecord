const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const command=process.argv[2];
if(!['dev','build'].includes(command))throw new Error('Expected dev or build');
const sdk=process.env.VULKAN_SDK;
if(process.platform==='win32'&&(!sdk||!fs.existsSync(path.join(sdk,'Bin/glslc.exe'))))throw new Error('VULKAN_SDK must name a prepared SDK containing Bin/glslc.exe');
const env={...process.env};
if(process.platform==='win32'){
 env.CMAKE_PROJECT_INCLUDE=path.resolve(__dirname,'../../.github/force-portable-ggml.cmake').replaceAll('\\','/');
 env.CXXFLAGS=[env.CXXFLAGS||'','/EHsc','/utf-8'].filter(Boolean).join(' ');
 env.CFLAGS=[env.CFLAGS||'','/utf-8'].filter(Boolean).join(' ');
 env.PATH=path.join(sdk,'Bin')+path.delimiter+(env.PATH||'');
}
const args=[path.resolve(__dirname,'../node_modules/@tauri-apps/cli/tauri.js'),command];
// The pinned native build script does not watch our CMake patch as an input.
// Refresh only its generated cache so every explicit Vulkan build applies it.
const clean=spawnSync('cargo',['clean','-p','whisper-rs-sys',...(command==='build'?['--release']:[])],{cwd:path.resolve(__dirname,'../src-tauri'),env,stdio:'inherit',windowsHide:true});
if(clean.error)throw clean.error;
if(clean.status!==0)throw new Error('Failed to refresh the generated Whisper native cache');
if(command==='build')args.push('--config',path.resolve(__dirname,'../../../tools/tauri.gpu-release.conf.json'));
args.push('--','--features','vulkan');
const result=spawnSync(process.execPath,args,{cwd:path.resolve(__dirname,'..'),env,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status??1;

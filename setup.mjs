import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {applyOverlay} from './apply.mjs';
import {readPinnedCommit,requirePinnedCommit} from './upstream-pin.mjs';
const base = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(base, 'app');
const frontend = path.join(app, 'frontend');
const repo = 'https://github.com/Zackriya-Solutions/meetily.git';
const expectedCommit = readPinnedCommit(path.join(base,'UPSTREAM_COMMIT.txt'));
const action = process.argv[2] || 'doctor';
const acceleration = process.argv[3] || 'cpu';
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
if(win){
  const candidates=[
    path.join(process.env.USERPROFILE||'', '.cargo', 'bin'),
    'C:\\Program Files\\CMake\\bin',
    'C:\\Program Files\\LLVM\\bin',
  ].filter(p=>p&&fs.existsSync(p));
  process.env.PATH=[...candidates,process.env.PATH||''].join(path.delimiter);
  const bundledClang=path.join(base,'tools','libclang-16');
  for(const dir of [bundledClang,'C:\\Program Files\\LLVM\\bin']){
    if(!process.env.LIBCLANG_PATH&&fs.existsSync(path.join(dir,'libclang.dll')))process.env.LIBCLANG_PATH=dir;
  }
  process.env.CXXFLAGS=[process.env.CXXFLAGS||'','/utf-8','/EHsc'].filter(Boolean).join(' ');
  process.env.CFLAGS=[process.env.CFLAGS||'','/utf-8'].filter(Boolean).join(' ');
}
function run(command, args, cwd = base, capture = false) {
  // Only fixed internal npm arguments are passed to the Windows command shell.
  const result = spawnSync(command, args, {cwd, stdio:capture?'pipe':'inherit',encoding:'utf8',shell:win && command === npm});
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  return (result.stdout || '').trim();
}
function doctor() {
  const result = {timestamp:new Date().toISOString(),platform:process.platform,node:process.version,checks:{},note:'Presence/version check only; no audio, model inference or compiler integration was tested.'};
  for (const [tool, required] of [['git',true],['cargo',true],['rustc',true],['cmake',true],['clang',false],['ollama',false]]) {
    try {result.checks[tool] = {present:true,version:run(tool,['--version'],base,true).split('\n')[0],required};}
    catch (e) {result.checks[tool] = {present:false,required,error:e.message};}
  }
  try {result.checks.npm={present:true,version:run(npm,['--version'],base,true),required:true};}
  catch (e) {result.checks.npm={present:false,required:true,error:e.message};}
  fs.mkdirSync(path.join(base,'reports'),{recursive:true});fs.writeFileSync(path.join(base,'reports','doctor.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  return Object.values(result.checks).every(c=>!c.required||c.present);
}
function prepare() {
  const alignTauriPackages = () => {
    const modules = path.join(frontend,'node_modules','@tauri-apps');
    if (!fs.existsSync(modules)) return;
    const lock = fs.readFileSync(path.join(app,'Cargo.lock'),'utf8').replace(/\r\n/g,'\n');
    const crateVersion = name => {
      const block = lock.split('[[package]]').find(b => b.includes('\nname = "'+name+'"\n'));
      const line = block && block.split('\n').find(l => l.startsWith('version = "'));
      return line ? line.slice(11,-1) : null;
    };
    const minor = version => version.split('.').slice(0,2).join('.');
    const wanted = [];
    for (const entry of fs.readdirSync(modules)) {
      const crate = entry === 'api' ? 'tauri' : entry.startsWith('plugin-') ? 'tauri-'+entry : null;
      const manifest = path.join(modules,entry,'package.json');
      if (!crate || !fs.existsSync(manifest)) continue;
      const expected = crateVersion(crate);
      const installed = JSON.parse(fs.readFileSync(manifest,'utf8')).version;
      if (expected && minor(installed) !== minor(expected)) wanted.push('@tauri-apps/'+entry+'@'+minor(expected));
    }
    if (!wanted.length) return;
    console.log('Aligning Tauri npm packages with the locked Rust crates: '+wanted.join(', '));
    run(npm,['install','--no-save','--no-audit','--no-fund',...wanted],frontend);
  };
  if (!fs.existsSync(app)) {
    run('git',['clone','--no-checkout','--filter=blob:none',repo,app]);
    run('git',['fetch','--depth','1','origin',expectedCommit],app);
    run('git',['checkout','--detach',expectedCommit],app);
    run('git',['submodule','update','--init','--recursive','--depth','1'],app);
  } else {
    if (!fs.existsSync(path.join(app,'.git'))) throw new Error('app/ already exists and is not a Git checkout. No files deleted.');
    const origin = run('git',['remote','get-url','origin'],app,true).replace(/\.git$/,'');
    if(origin!==repo.replace(/\.git$/,''))throw new Error('app/ origin is not the official Meetily repository.');
  }
  const commit = run('git',['rev-parse','HEAD'],app,true);
  requirePinnedCommit(commit,expectedCommit);
  console.log(applyOverlay(base,app));
  if (!fs.existsSync(path.join(frontend,'node_modules','typescript'))) {
    const locked = fs.existsSync(path.join(frontend,'package-lock.json'));
    console.log(locked?'Installing from upstream package-lock.json':'No npm lock found: generating a local npm lockfile.');
    run(npm,[locked?'ci':'install','--no-audit','--no-fund'],frontend);
  }
  alignTauriPackages();
}
function validate() {
  run(process.execPath,[path.join(base,'tests','run.cjs')]);
  run(process.execPath,[path.join(frontend,'node_modules','typescript','bin','tsc'),'--noEmit'],frontend);
}
function prepareSidecar(release) {
  const args=['build','-p','llama-helper'];
  if(release)args.push('--release');
  if(acceleration==='cuda')args.push('--features','cuda');
  run('cargo',args,app);
  const hostLine=run('rustc',['-vV'],base,true).split(/\r?\n/).find(line=>line.startsWith('host: '));
  if(!hostLine)throw new Error('rustc did not report a target host.');
  const host=hostLine.slice('host: '.length).trim();
  const profile=release?'release':'debug';
  const source=path.join(app,'target',profile,win?'llama-helper.exe':'llama-helper');
  if(!fs.existsSync(source))throw new Error(`llama-helper sidecar was not produced: ${source}`);
  const binaries=path.join(frontend,'src-tauri','binaries');fs.mkdirSync(binaries,{recursive:true});
  const destination=path.join(binaries,`llama-helper-${host}${win?'.exe':''}`);
  fs.copyFileSync(source,destination);
  console.log(`Prepared sidecar: ${destination}`);
}
try {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or later is required.');
  if (!['doctor','prepare','check','dev','build'].includes(action)) throw new Error('Usage: node setup.mjs doctor|prepare|check|dev|build [cpu|cuda]');
  if (!['cpu','cuda'].includes(acceleration)) throw new Error('Acceleration must be cpu or cuda. CUDA requires a compatible developer toolkit.');
  if (action === 'doctor') { if (!doctor()) process.exitCode = 1; }
  else {
    prepare();
    if (action === 'check' || action === 'build') validate();
    if (action === 'check') { prepareSidecar(false); run('cargo',['check','--locked'],path.join(frontend,'src-tauri')); }
    if (action === 'dev' || action === 'build') {
      prepareSidecar(action==='build');
      const script = `tauri:${action}:${acceleration}`;
      const manifest = JSON.parse(fs.readFileSync(path.join(frontend,'package.json'),'utf8'));
      if(!manifest.scripts?.[script])throw new Error(`Expected upstream script is missing: ${script}`);
      run(npm,['run',script],frontend);
      if(action==='build')console.log('Build command completed. Inspect app/frontend/src-tauri/target/release and its bundle directory for actual artifacts.');
    }
  }
} catch (error) {
  console.error('\nFAILED: '+error.message+'\nNo successful build is being claimed. Existing source and recordings were not deleted.');
  process.exitCode = 1;
}

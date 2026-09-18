import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const excluded = new Set(['.git','node_modules','target','.next','out','coverage','test-results','logs','work','reports','outputs','.agents','.codex','.omo','.chatgpt2codex','.venv','venv','__pycache__','gen','binaries','libclang-16','bundled-models','.meeting-ko-originals','recordings','recovery','cache','.cache','backups','data']);
const roots = new Set(['app','tools','scripts','assets','docs','tests','overlay','licenses']);
const rootFiles = new Set(['.gitattributes','.gitignore','AGENTS.md','PROJECT.md','README.md','RELEASE_NOTES.md','DESIGN.md','LICENSE','NOTICE','STREAM_RECORD_FORK.json','UPSTREAM_COMMIT.txt','setup.mjs','apply.mjs','upstream-pin.mjs','BUILD.cmd','BUILD-KOREAN.cmd','START.cmd'].map(name => name.toLowerCase()));
export function sourceAllowed(relative) {
  const parts = relative.replaceAll('\\','/').split('/'), name = parts.at(-1);
  if (!roots.has(parts[0].toLowerCase()) && !(parts.length === 1 && rootFiles.has(name.toLowerCase()))) return false;
  const normalized = parts.map(part => part.toLowerCase()).join('/');
  if (normalized === 'app/backend' || normalized.startsWith('app/backend/')) return false;
  if (normalized === 'docs/releases' || normalized.startsWith('docs/releases/')) return false;
  if (normalized === 'app/frontend/src-tauri/src/lib_old_complex.rs') return false;
  if (normalized === 'app/frontend/pnpm-lock.yaml') return false;
  if (parts.some(part => excluded.has(part.toLowerCase()))) return false;
  if (/(?:^|\.)env(?:\.|$)/i.test(name) || ['next-env.d.ts','.npmrc','.netrc','.pypirc'].includes(name.toLowerCase())) return false;
  if (/\.(?:exe|dll|pdb|bin|gguf|wav|mp3|m4a|mp4|sqlite3?|db|log|pem|key|pfx|p12|whl|tsbuildinfo|zip|7z|tar|gz)$/i.test(name)) return false;
  return !/(?:credential|token).*\.secret$|^last-session\.|^meeting-ko-install\.json$|\.backup$|^\.DS_Store$|credential.*\.json$|^(?:recovery|recording|transcript|session)(?:[-_.].*)?\.json$/i.test(name);
}
export async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
export function sourceFiles(root) {
  const files = [];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root,relative), {withFileTypes:true})) {
      const rel = path.posix.join(relative,entry.name);
      if (!sourceAllowed(rel)) continue;
      assert.ok(!entry.isSymbolicLink(), `Source symlink refused: ${rel}`);
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) files.push(rel);
    }
  }
  walk('');
  return files.sort();
}
export async function sourceSnapshot(root) {
  const result = {};
  for (const relative of sourceFiles(root)) result[relative] = await hashFile(path.join(root,relative));
  return result;
}
export async function buildSnapshot(root) {
  const all = await sourceSnapshot(root);
  return Object.fromEntries(Object.entries(all).filter(([name]) => /^(app|tools|scripts|assets)\//.test(name)));
}
export async function treeSnapshot(directory) {
  assert.ok(fs.existsSync(directory), `Missing build directory: ${directory}`);
  const result = {};
  async function walk(relative) {
    for (const entry of fs.readdirSync(path.join(directory,relative), {withFileTypes:true})) {
      const rel = path.posix.join(relative,entry.name);
      assert.ok(!entry.isSymbolicLink(), `Build symlink refused: ${rel}`);
      if (entry.isDirectory()) await walk(rel);
      else if (entry.isFile()) result[rel] = await hashFile(path.join(directory,rel));
    }
  }
  await walk('');
  assert.ok(Object.keys(result).length, 'Empty build directory');
  return result;
}
export function verifyVersions(root) {
  const read = relative => fs.readFileSync(path.join(root,relative),'utf8');
  const pkg = JSON.parse(read('app/frontend/package.json'));
  const lock = JSON.parse(read('app/frontend/package-lock.json'));
  const tauri = JSON.parse(read('app/frontend/src-tauri/tauri.conf.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version,pkg.version); assert.equal(lock.packages[''].version,pkg.version); assert.equal(tauri.version,pkg.version);
  const cargo = read('app/frontend/src-tauri/Cargo.toml');
  const name = cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1],pkg.version);
  const crate = read('app/Cargo.lock').split('[[package]]').find(block => block.match(/^name = "([^"]+)"/m)?.[1] === name);
  assert.equal(crate?.match(/^version = "([^"]+)"/m)?.[1],pkg.version);
  return pkg.version;
}

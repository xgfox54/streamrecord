// Read-only validation of an explicitly unsigned, completed NSIS installer.
// This module never launches an installer, downloads, deletes or publishes anything.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const table=Uint32Array.from({length:256},(_,value)=>{
  let n=value;for(let bit=0;bit<8;bit++)n=(n&1)?(0xedb88320^(n>>>1)):(n>>>1);return n>>>0;
});
export function crc32(bytes){
  let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;
}
export function verifyNsisBuffer(bytes,expected){
  assert.ok(Buffer.isBuffer(bytes)&&bytes.length>1024,'Installer is missing or too short');
  assert.equal(bytes.length,expected.bytes,'Installer size differs from completed makensis output');
  assert.equal(bytes.toString('ascii',0,2),'MZ','Installer is not a Windows executable');
  const signature=Buffer.from([0xef,0xbe,0xad,0xde,...Buffer.from('NullsoftInst','ascii')]);
  assert.ok(bytes.indexOf(signature,512)>=512,'NSIS signature is missing');
  const expectedCrc=parseInt(expected.crc32,16)>>>0;
  assert.match(expected.crc32,/^[0-9a-f]{8}$/i,'A complete makensis CRC is required');
  assert.equal(bytes.readUInt32LE(bytes.length-4),expectedCrc,'Installer trailing CRC differs from build log');
  assert.equal(crc32(bytes.subarray(512,bytes.length-4)),expectedCrc,'Installer payload CRC verification failed');
  return {bytes:bytes.length,crc32:expected.crc32.toLowerCase(),sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function inspectCompletedInstaller(root,version){
  assert.match(version,/^\d+\.\d+\.\d+$/);
  const directory=path.join(root,'outputs',`release-${version}`);
  const receiptPath=path.join(directory,'completed-installer-receipt.json');
  const relativePath=`app/target/release/bundle/nsis/stream-record_${version}_x64-setup.exe`;
  const file=path.join(root,relativePath);
  const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Expected a regular generated installer');
  assert.ok(stat.size<512*1024*1024,'Unexpected installer size');
  let expected;
  if(fs.existsSync(receiptPath)){
    expected=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
    assert.equal(expected.version,version);assert.equal(expected.relativePath,relativePath);
    assert.equal(expected.origin,'completed-makensis-postprocess-sharing-violation');
  }else{
    const origin=path.join(directory,'packaging-origin.json');
    const previous=JSON.parse(fs.readFileSync(fs.existsSync(origin)?origin:path.join(directory,'deployment-result.json'),'utf8'));
    assert.equal(previous.version,version);assert.equal(previous.phase,'build-windows-installer');
    assert.equal(previous.signingPolicy,'unsigned-explicit');
    assert.equal(previous.installedAttempted,false);assert.equal(previous.pushed,false);
    assert.equal(previous.tests?.frontend?.failed,0);assert.ok(previous.tests.frontend.passed>=40);
    assert.equal(previous.tests?.rust?.failed,0);assert.ok(previous.tests.rust.passed>=17);
    const log=fs.readFileSync(path.join(directory,'nsis-bundle.log'),'utf8');
    assert.ok(log.includes('os error 32'),'Recovery is limited to the recorded Windows sharing violation');
    assert.ok(log.includes('due to --no-sign flag.'),'Unsigned packaging must be explicit');
    assert.ok(log.includes(`Skipping signing for ${file} due to --no-sign flag.`),'Final installer was not reached');
    const total=[...log.matchAll(/Total size:\s*(\d+)\s*\//g)].at(-1);
    const crc=[...log.matchAll(/CRC \(0x([0-9a-f]{8})\):/gi)].at(-1);
    assert.ok(total&&crc,'makensis did not report a completed installer with a CRC');
    const started=Date.parse(previous.startedAt),ended=Date.parse(previous.failedAt);
    assert.ok(Number.isFinite(started)&&Number.isFinite(ended)&&ended>=started);
    assert.ok(stat.mtimeMs>=started&&stat.mtimeMs<=ended+3000,'Installer is not from the recorded run');
    expected={version,relativePath,bytes:Number(total[1]),crc32:crc[1].toLowerCase(),origin:'completed-makensis-postprocess-sharing-violation',originalRun:previous.startedAt,originalFailure:previous.failedAt,logSha256:createHash('sha256').update(log).digest('hex')};
  }
  const verified=verifyNsisBuffer(fs.readFileSync(file),expected);
  if(expected.sha256)assert.equal(verified.sha256,expected.sha256,'Installer changed since its validation receipt');
  return {...expected,...verified,validatedAt:new Date().toISOString()};
}

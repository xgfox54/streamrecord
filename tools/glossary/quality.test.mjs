import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,editCounts} from './quality.mjs';
const ref={id:'fixture',audioSha256:'a'.repeat(64),durationSeconds:10,reference:'예산 100억 100억 승인',referenceKind:'human-reviewed',sourceUrl:'https://example.org/human',importantTerms:['예산'],split:'evaluation'};
const run={id:'fixture',audioSha256:'a'.repeat(64),engine:'test-engine',model:'test-only',text:'예산 10억 승인',elapsedSeconds:5,firstPartialMs:null,committedMs:null,peakRamMiB:null,peakVramMiB:null};
test('edit metric distinguishes dropped and repeated content',()=>assert.deepEqual(editCounts('가나다','가다다라'),{distance:2,substitutions:1,deletions:0,insertions:1,referenceCharacters:3}));
test('repeated numbers are counted instead of collapsed into a set',()=>{
 const result=evaluate(ref,run);
 assert.deepEqual(result.numericTokens,{expected:2,matched:0,unexpected:1});
 assert.equal(result.rtf,0.5);assert.equal(result.firstPartialMs,null);
});
test('reject different audio and unreviewed reference rather than produce misleading CER',()=>{
 assert.throws(()=>evaluate({...ref,audioSha256:'b'.repeat(64)},run));
 assert.throws(()=>evaluate({...ref,referenceKind:'model-generated'},run));
});
test('empty reference is rejected rather than yielding perfect CER',()=>assert.throws(()=>evaluate({...ref,reference:' '},run)));

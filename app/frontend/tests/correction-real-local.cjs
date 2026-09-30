'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file){file=path.resolve(file);if(!path.extname(file))file+='.ts';if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id)):require(id),Error});return module.exports;}
(async()=>{
 const native=fs.readFileSync(path.join(root,'src-tauri/src/meeting_ko/generation.rs'),'utf8');const match=native.match(/Stage::Correction => ("[^\n]+")/);assert.ok(match);const system=JSON.parse(match[1]);
 const {correctTranscript}=load(path.join(root,'src/components/meeting-ko/transcript-correction.ts'));
 const rows=[{sequence_id:1,text:'오늘 회의을 시작 하겠습니다. 예산은 3000만 원입니다.',is_partial:false},{sequence_id:2,text:'다음 주 월요일에 결과을 공유 하겠습니다.',is_partial:false}];
 const requests=[],started=Date.now();
 const result=await correctTranscript({batch:rows.map((row,index)=>({row,index})),rows,glossary:'',modelKey:'local:gemma4:e2b-it-qat',generate:async text=>{
  const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'gemma4:e2b-it-qat',system,prompt:text,stream:false,keep_alive:'5m',format:{type:'object',properties:{corrections:{type:'array',minItems:1,items:{type:'object',properties:{id:{type:'string'},text:{type:'string',minLength:1}},required:['id','text'],additionalProperties:false}}},required:['corrections'],additionalProperties:false},think:false,options:{temperature:.1,num_ctx:8192,num_predict:4000}}),signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error('HTTP '+response.status);const body=await response.json();requests.push({doneReason:body.done_reason,totalDuration:body.total_duration,response:body.response});fs.writeFileSync(path.join(root,'test-results/correction/real-local-response.json'),JSON.stringify({requests},null,2));if(body.done_reason==='length')throw new Error('Truncated');return body.response;
 }});
 assert.equal(result.length,2);assert.ok(result[0].correction.text.includes('3000'));assert.equal(rows[0].text,'오늘 회의을 시작 하겠습니다. 예산은 3000만 원입니다.');
 const report={scope:'Actual installed Ollama inference using native correction system prompt and production frontend parser; synthetic Korean only, not Tauri IPC',model:'gemma4:e2b-it-qat',elapsedMs:Date.now()-started,requests,result,passed:true};
 fs.mkdirSync(path.join(root,'test-results/correction'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/correction/real-local.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

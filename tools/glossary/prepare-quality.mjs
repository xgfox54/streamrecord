import{execFileSync}from'node:child_process';
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{createHash}from'node:crypto';
import{resolve}from'node:path';
import{createRequire}from'node:module';
const require=createRequire(new URL('../../app/frontend/package.json',import.meta.url));
const{z}=require('zod');
const output=resolve(process.argv[2]??'outputs/glossary-quality');
await mkdir(output,{recursive:true});
const url='https://datasets-server.huggingface.co/rows?dataset=google%2Ffleurs&config=ko_kr&split=test&offset=0&length=3';
const raw=execFileSync('curl',['--fail','--silent','--show-error','--proto','=https','--max-time','60',url],{encoding:'utf8',maxBuffer:1000000});
const data=z.object({rows:z.array(z.object({row_idx:z.number().int(),row:z.object({id:z.number().int(),num_samples:z.number().positive(),transcription:z.string().min(1),raw_transcription:z.string().min(1),audio:z.array(z.object({src:z.string().url()})).min(1)})})).min(1)}).parse(JSON.parse(raw));
const references=[];
for(const item of data.rows){
 const audioUrl=new URL(item.row.audio[0].src);
 if(audioUrl.hostname!=='datasets-server.huggingface.co'||audioUrl.protocol!=='https:')throw new TypeError('Unexpected dataset audio host');
 const audioPath=resolve(output,`fleurs-ko-test-${item.row_idx}.wav`);
 execFileSync('curl',['--fail','--silent','--show-error','--proto','=https','--max-time','60','--max-filesize','3000000',audioUrl.href,'-o',audioPath]);
 references.push({id:`fleurs-ko-test-${item.row_idx}`,audioPath,audioSha256:createHash('sha256').update(await readFile(audioPath)).digest('hex'),durationSeconds:item.row.num_samples/16000,reference:item.row.raw_transcription,referenceKind:'published-reference',sourceUrl:'https://huggingface.co/datasets/google/fleurs',sourceDatasetId:item.row.id,sourceRowIndex:item.row_idx,datasetRevision:audioUrl.pathname.split('/')[5],importantTerms:[],split:'evaluation'});
}
await writeFile(resolve(output,'references.json'),JSON.stringify(references,null,2)+'\n');
const gpu=execFileSync('nvidia-smi',['--query-gpu=name,memory.total,memory.free','--format=csv,noheader'],{encoding:'utf8'}).trim();
const imports=execFileSync('python',['-c',"import importlib.util,json;print(json.dumps({p:bool(importlib.util.find_spec(p)) for p in ['faster_whisper','nemo','torch']}))"],{encoding:'utf8'});
await writeFile(resolve(output,'preflight.json'),JSON.stringify({createdAt:new Date().toISOString(),gpu,runtimes:JSON.parse(imports),samples:references.length,attribution:'Google FLEURS, CC-BY-4.0, https://huggingface.co/datasets/google/fleurs; audio unchanged; published reference, not re-reviewed against waveform',engines:[{id:'native-whisper',status:'NOT_RUN',reason:'Existing bundled model; quality harness requires transcript output from actual native adapter'},{id:'faster-whisper-large-v3-turbo',status:'NOT_RUN',source:'https://github.com/SYSTRAN/faster-whisper',reason:'Optional Python runtime and model not installed; no automatic default replacement'},{id:'nemotron-3.5-asr-streaming-0.6b',status:'NOT_RUN',source:'https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b',reason:'Optional runtime/model not installed; ko-KR official support verified, GTX throughput unmeasured'}]},null,2)+'\n');
console.log(JSON.stringify({output,samples:references.length,gpu,runtimes:JSON.parse(imports)}));

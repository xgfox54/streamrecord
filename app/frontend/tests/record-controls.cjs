'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const Renderer=require('react-test-renderer');
const {act}=Renderer;
const root=path.resolve(__dirname,'..');
const modules=new Map();
function load(filename){
 filename=path.resolve(filename);
 if(filename.endsWith('.json'))return JSON.parse(fs.readFileSync(filename,'utf8'));
 if(!path.extname(filename))filename+=fs.existsSync(filename+'.ts')?'.ts':'.tsx';
 if(modules.has(filename))return modules.get(filename).exports;
 const module={exports:{}};modules.set(filename,module);
 const result=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const localRequire=id=>id.endsWith('.css')?{}:id.startsWith('.')?load(path.join(path.dirname(filename),id)):require(id);
 vm.runInNewContext(result.outputText,{module,exports:module.exports,require:localRequire,console},{filename});
 return module.exports;
}
const {RecordToolbar}=load(path.join(root,'src/components/stream-record/RecordToolbar.tsx'));
const {RecordVideo}=load(path.join(root,'src/components/stream-record/RecordVideo.tsx'));
const text=node=>typeof node==='string'?node:node.children.map(text).join('');
function harness(Component,input='microphone',overrides={}){
 const calls=[];
 const session={ready:true,busy:false,mode:'idle',modeLabel:'준비',devices:[{name:'Mic A',device_type:'Input'},{name:'Stereo Mix',device_type:'Input'}],microphone:'Mic A',consent:true,rows:[],minutes:'',elapsed:0,hasRecordingStart:false,videoUrl:'https://www.youtube.com/watch?v=abc12345678',videoEmbedUrl:'https://www.youtube-nocookie.com/embed/abc12345678',glossary:'',modelStatus:'',setConsent:()=>{},setMicrophone:()=>{},setGlossary:()=>{},setRecordingKind:()=>{},refreshDevices:async()=>{},setError:()=>{},messageOf:String,setVideoUrl:()=>{},prepareVideo:async()=>{calls.push('prepare');},start:async name=>{calls.push(name);},startVideo:async()=>{calls.push('video');},stop:async()=>{calls.push('stop');},importAudio:async()=>{calls.push('import');},...overrides};
 let renderer;
 act(()=>{renderer=Renderer.create(React.createElement(Component,{session,input,onInputChange:()=>{}}));});
 return {calls,session,renderer,click:label=>act(()=>{const node=renderer.root.findAllByType('button').find(button=>text(button).includes(label));assert.ok(node);if(!node.props.disabled)node.props.onClick();}),button:label=>renderer.root.findAllByType('button').find(button=>text(button).includes(label)),close:()=>act(()=>renderer.unmount())};
}
const results=[];
function test(name,fn){try{fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(error){results.push({name,status:'failed',error:String(error.stack)});console.error(error.stack);}}
test('When the selected microphone is missing, another microphone is not substituted',()=>{const h=harness(RecordToolbar,'microphone',{microphone:'Removed Mic'});try{h.click('녹음 시작');assert.deepEqual(h.calls,[]);assert.equal(h.button('녹음 시작').props.disabled,true);}finally{h.close();}});
for(const [input,expected] of [['microphone','Mic A'],['pc','Stereo Mix'],['youtube','video'],['file','import']])test('When '+input+' is chosen, only its capture action is invoked',()=>{const h=harness(RecordToolbar,input);try{h.click(input==='file'?'파일 선택':'녹음 시작');assert.deepEqual(h.calls,[expected]);}finally{h.close();}});
test('When consent is absent, capture and import remain disabled',()=>{for(const input of ['microphone','pc','youtube','file']){const h=harness(RecordToolbar,input,{consent:false});try{h.click(input==='file'?'파일 선택':'녹음 시작');assert.deepEqual(h.calls,[]);}finally{h.close();}}});
test('When YouTube lacks Stereo Mix, microphone cannot substitute',()=>{const h=harness(RecordToolbar,'youtube',{devices:[{name:'Mic A',device_type:'Input'}]});try{h.click('녹음 시작');assert.deepEqual(h.calls,[]);}finally{h.close();}});
test('When capture is active, stop stays usable while input selection is disabled',()=>{const h=harness(RecordToolbar,'pc',{busy:true,mode:'recording'});try{assert.equal(h.renderer.root.findAllByType('fieldset').every(fieldset=>fieldset.props.disabled),true);h.click('중지');assert.deepEqual(h.calls,['stop']);}finally{h.close();}});
test('When session rerenders, the always-expanded video keeps iframe identity and 1280 by 720 dimensions',()=>{const h=harness(RecordVideo);try{const iframe=h.renderer.root.findByType('iframe');act(()=>h.renderer.update(React.createElement(RecordVideo,{session:{...h.session,busy:true}})));assert.equal(h.renderer.root.findByType('iframe'),iframe);assert.equal(iframe.props.src,h.session.videoEmbedUrl);assert.equal(iframe.props.width,'1280');assert.equal(iframe.props.height,'720');assert.equal(h.renderer.root.findAllByType('button').some(button=>['크게','접기','펼치기','작게'].includes(text(button))),false);}finally{h.close();}});
const report={passed:results.filter(item=>item.status==='passed').length,failed:results.filter(item=>item.status==='failed').length,scope:'Offline React capture callbacks and iframe identity; native engine not executed.',tests:results};
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/record-controls.json'),JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;

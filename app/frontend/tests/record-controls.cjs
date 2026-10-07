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
const {RecordToolbar,CaptureActions}=load(path.join(root,'src/components/stream-record/RecordToolbar.tsx'));
const {RecordVideo}=load(path.join(root,'src/components/stream-record/RecordVideo.tsx'));
const {Spinner}=load(path.join(root,'src/components/stream-record/TranscriptActivity.tsx'));
const text=node=>typeof node==='string'?node:node.children.map(text).join('');
function harness(Component,input='microphone',overrides={}){
 const calls=[];
 const session={ready:true,busy:false,mode:'idle',modeLabel:'준비',devices:[{name:'Mic A',device_type:'Input'},{name:'Speakers',device_type:'Output'}],microphone:'Mic A',systemDevice:'Output:Speakers',setSystemDevice:()=>{},consent:true,rows:[],minutes:'',elapsed:0,hasRecordingStart:false,videoUrl:'https://www.youtube.com/watch?v=abc12345678',videoEmbedUrl:'https://www.youtube-nocookie.com/embed/abc12345678',glossary:'',modelStatus:'',setConsent:()=>{},setMicrophone:()=>{},setGlossary:()=>{},setRecordingKind:()=>{},refreshDevices:async()=>{},setError:message=>{if(message)calls.push({error:message});},messageOf:String,setVideoUrl:()=>{},prepareVideo:async()=>{calls.push('prepare');},start:async(name,notice,deviceType)=>{calls.push({name,deviceType});},startVideo:async()=>{calls.push('video');},stop:async()=>{calls.push('stop');},importAudio:async()=>{calls.push('import');},...overrides};
 let renderer;
 act(()=>{renderer=Renderer.create(React.createElement(Component,{session,input,onInputChange:()=>{}}));});
 return {calls,session,renderer,click:label=>act(()=>{const node=renderer.root.findAllByType('button').find(button=>text(button).includes(label));assert.ok(node);if(!node.props.disabled)node.props.onClick();}),button:label=>renderer.root.findAllByType('button').find(button=>text(button).includes(label)),close:()=>act(()=>renderer.unmount())};
}
const {suggestedRecordTitle,recordDisplayTitle,durationLabel}=load(path.join(root,'src/components/stream-record/record-presentation.ts'));
const results=[];
function test(name,fn){try{fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(error){results.push({name,status:'failed',error:String(error.stack)});console.error(error.stack);}}
test('Record titles preserve custom names and use an actual video title or input date for a new record',()=>{
 const date=new Date(2026,9,7,14,5);
 assert.equal(suggestedRecordTitle('사용자 제목','youtube',date,'영상 제목'),'사용자 제목');
 assert.equal(suggestedRecordTitle('새 기록','youtube',date,' 영상 제목 '),'영상 제목');
 assert.ok(suggestedRecordTitle('새 기록','pc',date).startsWith('PC 소리 기록 · '));
 assert.equal(recordDisplayTitle('원래 제목','2026-10-07T00:00:00Z','pc'),'원래 제목');
 assert.ok(recordDisplayTitle('새 기록','2026-10-07T00:00:00Z').startsWith('기록 · '));
 assert.equal(recordDisplayTitle('새 기록','invalid'),'새 기록');
 assert.equal(durationLabel(undefined),'');assert.equal(durationLabel(-1),'');assert.equal(durationLabel(NaN),'');
 assert.equal(durationLabel(3601.5),'60분 1초');assert.equal(durationLabel(0),'0초');
});
test('Missing selected microphone reports a fix without silently recording another device',()=>{const h=harness(CaptureActions,'microphone',{microphone:'Removed Mic'});try{assert.equal(h.button('녹음 시작').props.disabled,false);h.click('녹음 시작');assert.equal(h.calls.length,1);assert.ok(h.calls[0].error.includes('장치'));}finally{h.close();}});
for(const [input,expected] of [['microphone',{name:'Mic A',deviceType:'Input'}],['pc',{name:'Speakers',deviceType:'Output'}],['youtube','video'],['file','import']])test('Ready '+input+' uses only its intended capture source',()=>{const h=harness(CaptureActions,input);try{assert.equal(h.button(input==='file'?'파일 선택':'녹음 시작').props.disabled,false);h.click(input==='file'?'파일 선택':'녹음 시작');assert.deepEqual(h.calls,[expected]);}finally{h.close();}});
test('Missing permission reports an actionable message without recording or importing',()=>{for(const input of ['microphone','pc','youtube','file']){const h=harness(CaptureActions,input,{consent:false});try{h.click(input==='file'?'파일 선택':'녹음 시작');assert.equal(h.calls.length,1);assert.ok(h.calls[0].error.includes('권한'));}finally{h.close();}}});
test('YouTube with no playback device never substitutes a microphone',()=>{const h=harness(CaptureActions,'youtube',{devices:[{name:'Mic A',device_type:'Input'}]});try{h.click('녹음 시작');assert.equal(h.calls.length,1);assert.ok(h.calls[0].error.includes('장치'));}finally{h.close();}});
test('YouTube start is in the video component and absent from the source toolbar',()=>{const h=harness(RecordToolbar,'youtube'),video=harness(RecordVideo);try{assert.equal(h.button('녹음 시작'),undefined);assert.ok(video.button('영상 소리 녹음 시작'));}finally{h.close();video.close();}});
test('When capture is active, stop stays usable while input selection is disabled',()=>{const h=harness(RecordToolbar,'pc',{busy:true,mode:'recording'});try{assert.equal(h.renderer.root.findAllByType('fieldset').every(fieldset=>fieldset.props.disabled),true);h.click('중지');assert.deepEqual(h.calls,['stop']);}finally{h.close();}});
test('When session rerenders, the always-expanded video keeps iframe identity and 1280 by 720 dimensions',()=>{const h=harness(RecordVideo);try{const iframe=h.renderer.root.findByType('iframe');act(()=>h.renderer.update(React.createElement(RecordVideo,{session:{...h.session,busy:true}})));assert.equal(h.renderer.root.findByType('iframe'),iframe);assert.equal(iframe.props.src,h.session.videoEmbedUrl);assert.equal(iframe.props.width,'1280');assert.equal(iframe.props.height,'720');assert.equal(h.renderer.root.findAllByType('button').some(button=>['크게','접기','펼치기','작게'].includes(text(button))),false);}finally{h.close();}});
test('Stereo Mix panel offers enabling only when Windows has it turned off',()=>{
 const spy=[];const cases={disabled:true,active:false,unplugged:false,unsupported:false};
 for(const [state,hasButton] of Object.entries(cases)){const h=harness(RecordToolbar,'pc',{stereoMix:{state,id:'{id}',name:'Stereo Mix'},stereoMixBusy:false,enableStereoMix:async()=>{spy.push(state);}});try{assert.ok(h.renderer.root.findAllByProps({'data-testid':'stereo-mix-panel'}).length>=1);assert.equal(Boolean(h.button('스테레오 믹스 켜기')),hasButton,state);if(hasButton){h.click('스테레오 믹스 켜기');assert.deepEqual(spy,['disabled']);}}finally{h.close();}}
 const none=harness(RecordToolbar,'pc',{stereoMix:null});try{assert.equal(none.renderer.root.findAllByProps({'data-testid':'stereo-mix-panel'}).length,0);}finally{none.close();}
 const microphone=harness(RecordToolbar,'microphone',{stereoMix:{state:'disabled',id:'{id}',name:'Stereo Mix'},enableStereoMix:async()=>{}});try{assert.equal(microphone.renderer.root.findAllByProps({'data-testid':'stereo-mix-panel'}).length,0);}finally{microphone.close();}
});
test('Stereo Mix button is unavailable while a task is running or enabling is in progress',()=>{
 for(const overrides of [{busy:true,mode:'recording'},{stereoMixBusy:true}]){const h=harness(RecordToolbar,'youtube',{stereoMix:{state:'disabled',id:'{id}',name:'Stereo Mix'},enableStereoMix:async()=>{},...overrides});try{assert.equal(h.button(overrides.stereoMixBusy?'켜는 중':'스테레오 믹스 켜기').props.disabled,true);}finally{h.close();}}
});
test('An enabled Stereo Mix input is selectable beside the speakers for PC sound',()=>{
 const h=harness(RecordToolbar,'pc',{devices:[{name:'Mic A',device_type:'Input'},{name:'Speakers',device_type:'Output'},{name:'스테레오 믹스(Realtek(R) Audio)',device_type:'Input'}],systemDevice:'Input:스테레오 믹스(Realtek(R) Audio)'});
 try{const select=h.renderer.root.findAllByType('select').find(node=>node.props.id==='record-device');assert.equal(select.props.value,'Input:스테레오 믹스(Realtek(R) Audio)');assert.deepEqual(select.findAllByType('option').map(option=>option.props.value),['','Output:Speakers','Input:스테레오 믹스(Realtek(R) Audio)']);}finally{h.close();}
});
test('Start button shows a spinner while the model and device are being prepared',()=>{
 const h=harness(CaptureActions,'youtube',{mode:'starting',busy:true});
 try{assert.equal(h.renderer.root.findAll(node=>node.type===Spinner).length,1);assert.ok(text(h.button('모델 준비 중')).includes('모델 준비 중'));}finally{h.close();}
 const idle=harness(CaptureActions,'youtube');try{assert.equal(idle.renderer.root.findAll(node=>node.type===Spinner).length,0);}finally{idle.close();}
});
const report={passed:results.filter(item=>item.status==='passed').length,failed:results.filter(item=>item.status==='failed').length,scope:'Offline React capture callbacks and iframe identity; native engine not executed.',tests:results};
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/record-controls.json'),JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;

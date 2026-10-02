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
 const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const localRequire=id=>id.endsWith('.css')?{}:id.startsWith('.')?load(path.join(path.dirname(filename),id)):require(id);
 vm.runInNewContext(compiled.outputText,{module,exports:module.exports,require:localRequire,console},{filename});
 return module.exports;
}
const {GlossaryPicker,appendGlossaryTerms}=load(path.join(root,'src/components/stream-record/GlossaryPicker.tsx'));
const copy=value=>JSON.parse(JSON.stringify(value));
const results=[];
function test(name,fn){try{fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(error){results.push({name,status:'failed',error:String(error.stack)});console.error(error.stack);}}
function harness(glossary='수동 입력',busy=false){
 const calls=[];
 let session={activeRecordId:'record-a',glossary,busy,setGlossary:value=>calls.push(value)};
 let renderer;
 act(()=>{renderer=Renderer.create(React.createElement(GlossaryPicker,{session}));});
 return {calls,renderer,select:id=>act(()=>renderer.root.findByProps({value:id}).props.onChange({target:{checked:true}})),update:values=>act(()=>{session={...session,...values};renderer.update(React.createElement(GlossaryPicker,{session}));}),apply:()=>act(()=>{const button=renderer.root.findAllByType('button').find(node=>node.props['data-action']==='append-glossary');assert.ok(button);if(!button.props.disabled)button.props.onClick();}),close:()=>act(()=>renderer.unmount())};
}
test('Given manual separators when terms repeat then manual text survives and additions are unique',()=>{
 const manual=' 탄소중립; 예비비\n기관명 ';
 const result=appendGlossaryTerms(manual,['탄소중립',' 예비비 ','기관명','기금운용결산','기금운용결산','']);
 assert.equal(result.text,manual+', 기금운용결산');assert.deepEqual(copy(result.omitted),[]);
});
test('Given an exact limit when a longer term is omitted then later fitting terms still append',()=>{
 const result=appendGlossaryTerms('가'.repeat(495),['너무긴용어','예비비','추가']);
 assert.equal(result.text,'가'.repeat(495)+', 예비비');assert.equal(result.text.length,500);assert.deepEqual(copy(result.omitted),['너무긴용어','추가']);
});
test('Given manual input already beyond the limit when adding terms then it is never truncated',()=>{
 const manual='가'.repeat(501);const result=appendGlossaryTerms(manual,['예비비']);
 assert.equal(result.text,manual);assert.deepEqual(copy(result.omitted),['예비비']);
});
test('Given a new picker when untouched then no terms are selected or applied',()=>{
 const h=harness();try{assert.equal(h.renderer.root.findAllByType('input').some(node=>node.props.checked),false);assert.deepEqual(h.calls,[]);}finally{h.close();}
});
test('Given budget and education packs when applying then shared terms appear once after manual input',()=>{
 const h=harness('지방교육재정교부금');try{h.select('budget');h.select('education');assert.deepEqual(h.calls,[]);h.apply();assert.equal(h.calls.length,1);assert.ok(h.calls[0].startsWith('지방교육재정교부금, '));assert.equal(h.calls[0].split('지방교육재정교부금').length,2);assert.ok(h.calls[0].includes('예비비'));assert.ok(h.calls[0].includes('마을키움터'));}finally{h.close();}
});
test('Given selected packs when switching records then draft selection and status reset',()=>{
 const h=harness();try{h.select('budget');h.update({activeRecordId:'record-b',glossary:'다른 기록'});assert.equal(h.renderer.root.findAllByType('input').some(node=>node.props.checked),false);assert.equal(h.renderer.root.findAllByProps({role:'status'}).length,0);assert.deepEqual(h.calls,[]);}finally{h.close();}
});
test('Given a full glossary when applying a pack then omissions are reported and manual text stays intact',()=>{
 const manual='가'.repeat(500);const h=harness(manual);try{h.select('welfare');h.apply();assert.equal(h.calls[0],manual);const status=h.renderer.root.findByProps({role:'status'});assert.ok(JSON.stringify(status.children).includes('가족친화'));}finally{h.close();}
});
test('Given an active recording when a selection exists then applying is disabled',()=>{
 const h=harness();try{h.select('budget');h.update({busy:true});h.apply();assert.deepEqual(h.calls,[]);assert.equal(h.renderer.root.findAllByType('fieldset').every(node=>node.props.disabled),true);}finally{h.close();}
});
test('Given pending selection when manual input changes then application uses the latest input',()=>{
 const h=harness('이전 입력');try{h.select('budget');h.update({glossary:'수정한 입력; 예비비'});h.apply();assert.ok(h.calls[0].startsWith('수정한 입력; 예비비, '));assert.equal(h.calls[0].split('예비비').length,2);assert.equal(h.calls[0].includes('이전 입력'),false);}finally{h.close();}
});
test('Given a selected pack when unchecked then it contributes no terms',()=>{
 const h=harness();try{h.select('budget');h.select('education');act(()=>h.renderer.root.findByProps({value:'budget'}).props.onChange({target:{checked:false}}));h.apply();assert.equal(h.calls[0].includes('예비비'),false);assert.ok(h.calls[0].includes('마을키움터'));}finally{h.close();}
});
const report={passed:results.filter(item=>item.status==='passed').length,failed:results.filter(item=>item.status==='failed').length,scope:'Offline pure helper and real React component behavior; no speech inference or native capture.',tests:results};
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/glossary-packs.json'),JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;

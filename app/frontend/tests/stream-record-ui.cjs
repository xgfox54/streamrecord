'use strict';
// Offline React behavior tests: only the native/browser boundaries are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const {act} = Renderer;
const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const flush = async () => {for (let i = 0; i < 50; i++) await Promise.resolve();};
const inputDevices = [{name:'Microphone',device_type:'Input'}, {name:'Stereo Mix',device_type:'Input'}, {name:'Speaker',device_type:'Output'}];
function harness(options = {}) {
  const calls = [], snapshots = [], listeners = new Map(), subscriptions = new Map(), timers = new Map(), browserListeners = new Map();
  const overrides = new Map(); let active = false, clock = Date.parse('2026-09-17T00:00:00Z'), timerId = 0, session, renderer;
  const document = {activeElement:null,getElementById:id=>{
    const element = renderer?.root.findAll(node=>typeof node.type==='string' && node.props.id===id)[0];
    return element ? createNodeMock(element) : null;
  }};
  const createNodeMock = element => {
    const node = {id:element.props.id || '',tagName:element.type.toUpperCase(),scrollTop:0,scrollHeight:0,clientHeight:0,
      focus:()=>{document.activeElement=node;},scrollIntoView:()=>{}};
    return node;
  };
  class ClockDate extends Date {constructor(...args) {super(...(args.length ? args : [clock]));} static now() {return clock;}}
  const window = {location:{hash:''}, localStorage:{getItem:()=>null,setItem:()=>{}}, confirm:()=>true,
    setInterval:(fn,delay)=>{const id = ++timerId; timers.set(id,{fn,delay}); return id;}, clearInterval:id=>timers.delete(id),
    addEventListener:(name,fn)=>{if (!browserListeners.has(name)) browserListeners.set(name,new Set()); browserListeners.get(name).add(fn);},
    removeEventListener:(name,fn)=>browserListeners.get(name)?.delete(fn)};
  const emit = (name,payload) => {for (const fn of [...(listeners.get(name) || [])]) fn({payload});};
  const listen = async (name,handler) => {
    subscriptions.set(name,(subscriptions.get(name) || 0)+1);
    if (options.listenGate) await options.listenGate.promise;
    if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(handler);
    return () => listeners.get(name).delete(handler);
  };
  const invoke = async (command,args) => {
    calls.push({command,args:args === undefined ? undefined : copy(args)});
    if (overrides.has(command)) return overrides.get(command)(args);
    if (command === 'ko_load_snapshot') return options.snapshot || null;
    if (command === 'get_audio_devices') return copy(inputDevices);
    if (command === 'ko_models') return [{id:'local-summary',provider:'local'}];
    if (command === 'is_recording') return active;
    if (command === 'is_import_in_progress_command') return false;
    if (command === 'api_get_transcript_config') return {provider:'localWhisper',model:'base'};
    if (command === 'api_save_transcript_config' || command === 'set_language_preference') return;
    if (command === 'ko_start_recording') {active = true; return;}
    if (command === 'ko_stop_recording') {active = false; return;}
    if (command === 'ko_close_video' || command === 'ko_exit_app') return;
    if (command === 'ko_save_snapshot') {snapshots.push(JSON.parse(args.content)); return 'snapshot.json';}
    if (command === 'ko_export') return `saved.${args.kind}`;
    throw new Error(`Unexpected native call: ${command}`);
  };
  const modules = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (!path.extname(filename)) filename += fs.existsSync(filename+'.ts') ? '.ts' : '.tsx';
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = {exports:{}}; modules.set(filename,module);
    const result = ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
    assert.equal((result.diagnostics || []).filter(d=>d.category === ts.DiagnosticCategory.Error).length,0);
    const requireModule = id => {
      if (id === '@tauri-apps/api/core') return {invoke,convertFileSrc:value=>value};
      if (id === '@tauri-apps/api/event') return {listen};
      if (id === '@tauri-apps/api/window') return {getCurrentWindow:()=>({onCloseRequested:handler=>listen('window-close',handler)})};
      if (id === '@/lib/whisper') return {WhisperAPI:{init:async()=>{},getAvailableModels:async()=>options.modelFails ? [] : [{name:'base',status:'Available'}],loadModel:async()=>{calls.push({command:'loadModel'});}}};
      if (id.endsWith('.css')) return {};
      if (id.startsWith('.')) return load(path.join(path.dirname(filename),id));
      return require(id);
    };
    vm.runInNewContext(result.outputText,{module,exports:module.exports,require:requireModule,console,window,document,Date:ClockDate,Error,TextEncoder,crypto:webcrypto,setTimeout,clearTimeout},{filename});
    return module.exports;
  }
  const {useMeetingSession} = load(path.join(root,'src/components/stream-record/useMeetingSession.ts'));
  const {TranscriptView} = load(path.join(root,'src/components/stream-record/TranscriptView.tsx'));
  const {RecordingView} = load(path.join(root,'src/components/stream-record/RecordingView.tsx'));
  const {AppShell} = load(path.join(root,'src/components/stream-record/AppShell.tsx'));
  function Surface() {
    session = useMeetingSession();
    return React.createElement(AppShell,{view:session.view,onNavigate:session.navigate,status:session.modeLabel,recording:session.mode==='recording',onStop:session.stop},
      session.view === 'transcript' ? React.createElement(TranscriptView,{session,evidence:null,onEvidenceShown:()=>{}}) : session.view === 'recording' ? React.createElement(RecordingView,{session}) : React.createElement('div',{'data-view':session.view}));
  }
  return {calls,snapshots,listeners,subscriptions,timers,browserListeners,overrides,emit,load,document,
    get session() {return session;}, get renderer() {return renderer;},
    mount:async()=>{await act(async()=>{renderer = Renderer.create(React.createElement(React.StrictMode,null,React.createElement(Surface)),{createNodeMock}); await flush();});},
    unmount:async()=>{await act(async()=>{renderer.unmount(); await flush();});},
    run:async fn=>{await act(async()=>{await fn(); await flush();});},
    advance:async ms=>{await act(async()=>{clock += ms; for (const timer of [...timers.values()]) if (timer.delay <= ms) timer.fn(); await flush();});},
    start:async()=>{await act(async()=>{session.setConsent(true);}); await act(async()=>{await session.start('Microphone','started'); await flush();});},
    count:command=>calls.filter(call=>call.command===command).length};
}
const results = [];
async function test(name,fn) {
  try {await fn(); results.push({name,status:'passed'}); console.log('PASS '+name);}
  catch (error) {results.push({name,status:'failed',error:error.stack}); console.error('FAIL '+name+'\n'+error.stack);}
}
async function using(options,fn) {const h = harness(options); await h.mount(); try {await fn(h);} finally {await h.unmount();}}
(async()=>{
  await test('Real RecordingView preserves idle PC and video choices through all navigation views',()=>using({},async h=>{
    for (const kind of ['pc','video']) {
      await h.run(()=>h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.value===kind).props.onChange());
      assert.equal(h.renderer.root.findByType('select').props.value,'Stereo Mix');
      for (const view of ['transcript','minutes','ai','settings','recording']) await h.run(()=>h.renderer.root.findAllByType('a').find(node=>node.props.href===`#${view}`).props.onClick());
      assert.equal(h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.checked).props.value,kind);
      assert.equal(h.renderer.root.findByType('select').props.value,'Stereo Mix'); assert.equal(h.session.mode,'idle'); assert.equal(h.count('ko_start_recording'),0);
    }
  }));
  await test('Real RecordingView preserves active PC source after remount without restarting native capture',()=>using({},async h=>{
    await h.run(()=>h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.value==='pc').props.onChange());
    await h.run(()=>h.session.setConsent(true));
    await h.run(()=>h.renderer.root.findAllByType('button').find(node=>node.props['aria-describedby']==='start-help').props.onClick());
    assert.equal(h.session.mode,'recording'); assert.equal(h.calls.find(call=>call.command==='ko_start_recording').args.micName,'Stereo Mix');
    for (const view of ['transcript','minutes','ai','settings','recording']) await h.run(()=>h.renderer.root.findAllByType('a').find(node=>node.props.href===`#${view}`).props.onClick());
    assert.equal(h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.checked).props.value,'pc');
    assert.equal(h.renderer.root.findByType('select').props.value,'Stereo Mix'); assert.equal(h.session.mode,'recording'); assert.equal(h.count('ko_start_recording'),1); assert.equal(h.count('ko_stop_recording'),0);
  }));
  await test('Native input enumeration retains Stereo Mix, excludes output and never fabricates devices',()=>using({},async h=>{
    assert.deepEqual(copy(h.session.devices),inputDevices.filter(device=>device.device_type==='Input'));
    assert.equal(h.session.microphone,'Microphone');
    await h.run(()=>h.session.setMicrophone('Stereo Mix')); await h.run(h.session.refreshDevices);
    assert.equal(h.session.microphone,'Stereo Mix');
  }));
  await test('Every navigation link preserves active recording and exactly one transcript subscription',()=>using({},async h=>{
    await h.start(); const counts = [...h.subscriptions.entries()];
    for (const [index,view] of ['recording','transcript','minutes','ai','settings','recording'].entries()) {
      const link = h.renderer.root.findAllByType('a').find(node=>node.props.href===`#${view}` && node.props['aria-current'] !== undefined) || h.renderer.root.findAllByType('a').find(node=>node.props.href===`#${view}`);
      await h.run(()=>link.props.onClick());
      await h.run(()=>h.emit('transcript-update',{sequence_id:index,text:`구간 ${index}`,is_partial:true}));
      await h.run(()=>h.emit('transcript-update',{sequence_id:index,text:`확정 ${index}`,is_partial:false}));
      assert.equal(h.session.view,view); assert.equal(h.session.mode,'recording'); assert.equal(h.session.rows.length,index+1);
      assert.equal(h.document.activeElement.tagName,'H1');
      assert.equal(h.listeners.get('transcript-update').size,1); assert.deepEqual([...h.subscriptions.entries()],counts);
    }
    assert.equal(h.count('ko_start_recording'),1); assert.equal(h.count('ko_stop_recording'),0);
    assert.deepEqual(copy(h.session.rows.map(row=>row.text)),['확정 0','확정 1','확정 2','확정 3','확정 4','확정 5']);
  }));
  await test('Concurrent double start invokes native capture exactly once',()=>using({},async h=>{
    await h.run(()=>h.session.setConsent(true));
    await h.run(()=>Promise.all([h.session.start('Microphone','one'),h.session.start('Microphone','two')]));
    assert.equal(h.count('ko_start_recording'),1); assert.equal(h.session.mode,'recording');
  }));
  await test('Failed Korean model preparation prevents native capture and preserves saved rows',()=>using({modelFails:true,snapshot:{version:1,title:'existing',rows:[{text:'원문'}],minutes:'',startedAt:null}},async h=>{
    h.overrides.set('ko_prepare_bundled_whisper',async()=>{throw new Error('corrupt bundled model');}); await h.start();
    assert.equal(h.count('ko_start_recording'),0); assert.equal(h.session.mode,'idle'); assert.equal(h.session.rows[0].text,'원문');
    assert.ok(h.session.error); assert.equal(h.session.hasRecordingStart,false);
  }));
  await test('Elapsed clock stays zero until native start resolves then counts actual recording time',()=>using({},async h=>{
    const gate = deferred(); h.overrides.set('ko_start_recording',()=>gate.promise);
    await h.run(()=>h.session.setConsent(true)); let starting;
    await h.run(()=>{starting = h.session.start('Microphone','started');});
    assert.equal(h.session.mode,'starting'); await h.advance(5000);
    assert.equal(h.session.elapsed,0); assert.equal(h.session.hasRecordingStart,false);
    await h.run(async()=>{gate.resolve(); await starting;}); assert.equal(h.session.hasRecordingStart,true); assert.equal(h.session.elapsed,0);
    await h.advance(3000); assert.equal(h.session.elapsed,3);
  }));
  await test('Rejected native start never activates elapsed recording time',()=>using({},async h=>{
    h.overrides.set('ko_start_recording',async()=>{throw new Error('device failed');}); await h.start(); await h.advance(5000);
    assert.equal(h.session.mode,'idle'); assert.equal(h.session.elapsed,0); assert.equal(h.session.hasRecordingStart,false);
  }));
  await test('Final transcript event is persisted and exported before native exit',()=>using({},async h=>{
    await h.start(); h.overrides.set('ko_stop_recording',async()=>{h.emit('transcript-update',{sequence_id:1,text:'마지막 발언',is_partial:false});});
    await h.run(h.session.confirmExit);
    const commands = h.calls.map(call=>call.command), stop = commands.indexOf('ko_stop_recording'), exit = commands.indexOf('ko_exit_app');
    assert.ok(exit > stop); assert.equal(h.count('ko_exit_app'),1);
    const finalSave = h.calls.findIndex((call,index)=>index>stop && call.command==='ko_save_snapshot' && JSON.parse(call.args.content).rows[0]?.text==='마지막 발언');
    const bundle = h.calls.findIndex(call=>call.command==='ko_export' && call.args.kind==='bundle');
    assert.ok(finalSave>stop && finalSave<exit); assert.ok(bundle>finalSave && bundle<exit);
    assert.equal(JSON.parse(h.calls[bundle].args.content).rows[0].text,'마지막 발언');
  }));
  for (const failure of ['ko_stop_recording','ko_save_snapshot','ko_export']) {
    await test(`${failure} failure prevents application exit and retains transcript`,()=>using({},async h=>{
      await h.start(); await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'보존할 원문',is_partial:false}));
      h.overrides.set(failure,async()=>{throw new Error('injected failure');}); await h.run(h.session.confirmExit);
      assert.equal(h.count('ko_exit_app'),0); assert.equal(h.session.rows[0].text,'보존할 원문'); assert.ok(h.session.error); assert.equal(h.session.exiting,false);
    }));
  }
  await test('Native inactive after stop error still blocks repeated exit until risk acknowledgment',()=>using({},async h=>{
    await h.start(); await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'원음 저장 실패 후 보존',is_partial:false}));
    h.overrides.set('ko_stop_recording',async()=>{throw new Error('audio file save failed');}); h.overrides.set('is_recording',async()=>false);
    await h.run(h.session.confirmExit); assert.equal(h.session.mode,'idle'); assert.ok(h.session.stopFailure); assert.equal(h.count('ko_exit_app'),0);
    assert.equal(h.snapshots.at(-1).rows[0].text,'원음 저장 실패 후 보존');
    await h.run(h.session.confirmExit); assert.equal(h.count('ko_exit_app'),0); assert.equal(h.count('ko_stop_recording'),1);
    await h.run(()=>h.session.setAcknowledgeStopFailure(true)); await h.run(h.session.confirmExit);
    assert.equal(h.count('ko_exit_app'),1); assert.equal(h.session.rows[0].text,'원음 저장 실패 후 보존');
  }));
  await test('Pending export rejects duplicate clicks and releases guard after completion',()=>using({snapshot:{version:1,title:'export',rows:[{text:'보존 원문'}],minutes:'',startedAt:null}},async h=>{
    const gate = deferred(); h.overrides.set('ko_export',()=>gate.promise);
    await h.run(()=>{h.session.save('transcript'); h.session.save('bundle');}); assert.equal(h.count('ko_export'),1);
    await h.run(()=>{gate.resolve('saved.txt');}); assert.equal(h.snapshots.at(-1).rows[0].text,'보존 원문');
    h.overrides.delete('ko_export'); await h.run(()=>h.session.save('bundle')); assert.equal(h.count('ko_export'),2);
    assert.equal(h.calls.filter(call=>call.command==='ko_export').at(-1).args.kind,'bundle');
  }));
  await test('Export rejection releases duplicate guard and permits a later retry',()=>using({snapshot:{version:1,title:'export',rows:[{text:'보존 원문'}],minutes:'',startedAt:null}},async h=>{
    h.overrides.set('ko_export',async()=>{throw new Error('disk full');}); await h.run(()=>h.session.save('bundle'));
    assert.ok(h.session.error); assert.equal(h.count('ko_export'),1); h.overrides.delete('ko_export');
    await h.run(()=>h.session.save('bundle')); assert.equal(h.count('ko_export'),2); assert.equal(h.snapshots.at(-1).rows[0].text,'보존 원문');
  }));
  await test('StrictMode mounted effect teardown and remount clean all native listeners and timers',async()=>{
    const h = harness(); await h.mount(); assert.equal(h.listeners.get('transcript-update').size,1); await h.unmount();
    assert.ok([...h.listeners.values()].every(set=>set.size===0)); assert.equal(h.timers.size,0); assert.ok([...h.browserListeners.values()].every(set=>set.size===0));
    await h.mount(); assert.equal(h.listeners.get('transcript-update').size,1); await h.start();
    await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'한 번',is_partial:false})); assert.equal(h.session.rows.length,1); await h.unmount();
    assert.ok([...h.listeners.values()].every(set=>set.size===0)); assert.equal(h.timers.size,0);
  });
  await test('Unmount during pending listener registration releases late listeners',async()=>{
    const gate = deferred(), h = harness({listenGate:gate}); await h.mount(); await h.unmount();
    await h.run(()=>{gate.resolve();}); assert.ok([...h.listeners.values()].every(set=>set.size===0)); assert.equal(h.timers.size,0);
  });
  await test('Actual reviewed-text editor persists correction while original and raw export remain unchanged',()=>using({snapshot:{version:1,title:'review',rows:[{sequence_id:1,text:'3000만원',is_partial:false}],minutes:'',startedAt:null}},async h=>{
    await h.run(()=>h.session.navigate('transcript'));
    const button = label=>h.renderer.root.findAllByType('button').find(node=>node.children.join('')===label);
    await h.run(()=>button('검토본 수정').props.onClick());
    await h.run(()=>h.renderer.root.findByType('textarea').props.onChange({target:{value:'300만원'}}));
    await h.run(()=>button('검토본 저장').props.onClick());
    assert.equal(h.session.rows[0].text,'3000만원'); assert.equal(h.session.rows[0].reviewed_text,'300만원'); assert.equal(h.session.editing,null);
    assert.equal(h.snapshots.at(-1).rows[0].text,'3000만원'); assert.equal(h.snapshots.at(-1).rows[0].reviewed_text,'300만원');
    await h.run(()=>h.session.save('transcript')); const raw = h.calls.filter(call=>call.command==='ko_export').at(-1);
    assert.ok(raw.args.content.includes('3000만원')); assert.ok(!raw.args.content.includes('300만원'));
  }));
  const passed = results.filter(result=>result.status==='passed').length, failed = results.length-passed;
  const report = {passed,failed,executedAt:new Date().toISOString(),scope:'Offline React 18 renderer with real session hook, transcript editor, AppShell and helpers; mocked Tauri/browser boundary. StrictMode wrapper plus explicit teardown/remount; no native capture, network, model inference or WebView rendering.',results};
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true}); fs.writeFileSync(path.join(root,'test-results/ui-session.json'),JSON.stringify(report,null,2));
  console.log(`UI session tests: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(error=>{console.error(error); process.exitCode = 1;});

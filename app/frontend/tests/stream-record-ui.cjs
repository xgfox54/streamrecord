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
  const records = new Map((options.records||[]).map(record=>[record.recordId,copy(record)]));
  const overrides = new Map(); let active = false, clock = Date.parse('2026-09-17T00:00:00Z'), timerId = 0, session, renderer;
  let stereo = options.stereoStatus || {state:'unsupported',id:null,name:null};
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
    if (command === 'ko_list_records') return {records:[...records.values()].map(record=>({id:record.recordId,title:record.title,updatedAt:new Date(clock).toISOString(),rowCount:record.rows.length})),warnings:[]};
    if (command === 'ko_load_record') {if(!records.has(args.id))throw new Error('record missing');return copy(records.get(args.id));}
    if (command === 'get_audio_devices') return copy(inputDevices);
    if (command === 'ko_list_transcription_recovery') return [];
    if (command === 'ko_models') return [{id:'local-summary',provider:'local'}];
    if (command === 'is_recording') return active;
    if (command === 'is_import_in_progress_command') return false;
    if (command === 'api_get_transcript_config') return {provider:'localWhisper',model:'base'};
    if (command === 'api_save_transcript_config' || command === 'set_language_preference') return;
    if (command === 'ko_start_recording') {active = true; return;}
    if (command === 'ko_stop_recording') {active = false; return;}
    if (command === 'ko_validate_video') return 'https://www.youtube.com/watch?v=abc12345678';
    if (command === 'ko_generate') return args.stage === 'notes' ? '현재까지의 요약' : '';
    if (command === 'ko_close_video' || command === 'ko_exit_app') return;
    if (command === 'ko_save_snapshot') {const value=JSON.parse(args.content);snapshots.push(value);records.set(value.recordId,value); return 'snapshot.json';}
    if (command === 'ko_stereo_mix_status') {if (options.stereoStatusFails) throw new Error('unavailable'); return copy(stereo);}
    if (command === 'ko_enable_stereo_mix') {if (options.stereoEnableFails) throw new Error(options.stereoEnableFails); stereo = {state:'active',id:stereo.id,name:stereo.name}; return copy(stereo);}
    if (command === 'ko_export') return `saved.${args.kind}`;
    throw new Error(`Unexpected native call: ${command}`);
  };
  const modules = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename,'utf8'));
    if (!path.extname(filename)) filename += fs.existsSync(filename+'.ts') ? '.ts' : '.tsx';
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = {exports:{}}; modules.set(filename,module);
    const result = ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
    assert.equal((result.diagnostics || []).filter(d=>d.category === ts.DiagnosticCategory.Error).length,0);
    const requireModule = id => {
      if (id === '@tauri-apps/api/core') return {invoke,convertFileSrc:value=>value};
      if (id === '@tauri-apps/api/event') return {listen};
      if (id === '@tauri-apps/api/window') return {getCurrentWindow:()=>({onCloseRequested:handler=>listen('window-close',event=>handler(event.payload)),hide:async()=>{calls.push({command:'window-hide'});if(options.hideFails)throw new Error('hide failed');}})};
      if (id === '@/lib/whisper') return {WhisperAPI:{init:async()=>{},getAvailableModels:async()=>options.modelFails ? [] : [{name:'base',status:'Available'}],loadModel:async()=>{calls.push({command:'loadModel'});}}};
      if (id.endsWith('.css')) return {};
      if (id.startsWith('@/')) return load(path.join(root,'src',id.slice(2)));
      if (id.startsWith('.')) return load(path.join(path.dirname(filename),id));
      return require(id);
    };
    vm.runInNewContext(result.outputText,{module,exports:module.exports,require:requireModule,console,window,document,Date:ClockDate,Error,AbortController,TextEncoder,crypto:webcrypto,setTimeout,clearTimeout},{filename});
    return module.exports;
  }
  const {useMeetingSession} = load(path.join(root,'src/components/stream-record/useMeetingSession.ts'));
  const {TranscriptView} = load(path.join(root,'src/components/stream-record/TranscriptView.tsx'));
  const {RecordingView} = load(path.join(root,'src/components/stream-record/RecordingView.tsx'));
  const {DictationView} = load(path.join(root,'src/components/stream-record/DictationView.tsx'));
  const {YoutubeView} = load(path.join(root,'src/components/stream-record/YoutubeView.tsx'));
  const {AppShell} = load(path.join(root,'src/components/stream-record/AppShell.tsx'));
  function Surface() {
    session = useMeetingSession();
    return React.createElement(AppShell,{session},
      session.view === 'transcript' ? React.createElement(TranscriptView,{session,evidence:null,onEvidenceShown:()=>{}}) : session.view === 'recording' ? React.createElement(RecordingView,{session}) : session.view === 'dictation' ? React.createElement(DictationView,{session}) : session.view === 'youtube' ? React.createElement(YoutubeView,{session}) : React.createElement('div',{'data-view':session.view}));
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
  for(const recording of [false,true]) await test(`X hides to tray while ${recording?'recording':'idle'} without stopping or exiting`,()=>using({},async h=>{
    if(recording)await h.start();
    let prevented=false;
    await h.run(()=>h.emit('window-close',{preventDefault:()=>{prevented=true;}}));
    assert.equal(prevented,true);assert.equal(h.count('window-hide'),1);assert.equal(h.count('ko_stop_recording'),0);assert.equal(h.count('ko_exit_app'),0);
    assert.equal(h.session.mode,recording?'recording':'idle');assert.equal(h.session.exitOpen,false);
    if(recording){await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'트레이에서 계속 전사',is_partial:false}));assert.equal(h.session.rows[0].text,'트레이에서 계속 전사');}
  }));
  await test('Stereo Mix can be enabled from the app and becomes the selected PC sound device',()=>using({stereoStatus:{state:'disabled',id:'{id}',name:'Stereo Mix'}},async h=>{
    assert.equal(h.session.stereoMix.state,'disabled');
    await h.run(()=>h.session.enableStereoMix());
    assert.equal(h.count('ko_enable_stereo_mix'),1);assert.equal(h.session.stereoMix.state,'active');assert.equal(h.session.systemDevice,'Input:Stereo Mix');assert.equal(h.session.recordingKind,'pc');assert.match(h.session.notice,/스테레오 믹스를 켰습니다/);assert.equal(h.session.error,'');assert.equal(h.session.mode,'idle');
  }));
  await test('Stereo Mix enabling failure is reported, state is re-read, and nothing starts recording',()=>using({stereoStatus:{state:'disabled',id:'{id}',name:'Stereo Mix'},stereoEnableFails:'관리자 권한 확인이 취소되어 스테레오 믹스를 켜지 못했습니다.'},async h=>{
    await h.run(()=>h.session.enableStereoMix());
    assert.match(h.session.error,/취소/);assert.equal(h.session.stereoMix.state,'disabled');assert.equal(h.count('ko_start_recording'),0);assert.equal(h.session.mode,'idle');
    assert.equal(h.count('ko_stereo_mix_status')>=2,true);
  }));
  await test('Stereo Mix enabling is refused while a recording is active',()=>using({stereoStatus:{state:'disabled',id:'{id}',name:'Stereo Mix'}},async h=>{
    await h.start();await h.run(()=>h.session.enableStereoMix());
    assert.equal(h.count('ko_enable_stereo_mix'),0);assert.equal(h.session.mode,'recording');
  }));
  await test('A missing status command leaves the Stereo Mix panel hidden without breaking device refresh',()=>using({stereoStatusFails:true},async h=>{
    assert.equal(h.session.stereoMix,null);assert.equal(h.session.devices.length,3);
  }));
  await test('Hide failure retains the session and reports the error without quitting',()=>using({hideFails:true},async h=>{
    let prevented=false;await h.run(()=>h.emit('window-close',{preventDefault:()=>{prevented=true;}}));
    assert.equal(prevented,true);assert.match(h.session.notice,/hide failed/);assert.equal(h.count('ko_exit_app'),0);assert.equal(h.session.exitOpen,false);
  }));
  await test('Explicit tray quit still opens the safe exit dialog',()=>using({},async h=>{
    await h.run(()=>h.emit('ko-exit-requested',null));assert.equal(h.session.exitOpen,true);assert.equal(h.count('window-hide'),0);assert.equal(h.count('ko_exit_app'),0);
  }));
  await test('Real RecordingView preserves idle PC choice through every task view',()=>using({},async h=>{
    await h.run(()=>h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.value==='pc').props.onChange());
    assert.equal(h.renderer.root.findAllByType('select').find(node=>node.props['aria-describedby']==='input-help').props.value,'Stereo Mix');
    for (const view of ['dictation','youtube','transcript','minutes','ai','settings','recording']) await h.run(()=>h.session.navigate(view));
    assert.equal(h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.checked).props.value,'pc');
    assert.equal(h.renderer.root.findAllByType('select').find(node=>node.props['aria-describedby']==='input-help').props.value,'Stereo Mix'); assert.equal(h.session.mode,'idle'); assert.equal(h.count('ko_start_recording'),0);
  }));
  await test('Real RecordingView preserves active PC source after remount without restarting native capture',()=>using({},async h=>{
    await h.run(()=>h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.value==='pc').props.onChange());
    await h.run(()=>h.session.setConsent(true));
    await h.run(()=>h.renderer.root.findAllByType('button').find(node=>node.props['aria-describedby']==='start-help').props.onClick());
    assert.equal(h.session.mode,'recording'); assert.equal(h.calls.find(call=>call.command==='ko_start_recording').args.micName,'Stereo Mix');
    for (const view of ['dictation','youtube','transcript','minutes','ai','settings','recording']) await h.run(()=>h.session.navigate(view));
    assert.equal(h.renderer.root.findAllByType('input').find(node=>node.props.type==='radio' && node.props.checked).props.value,'pc');
    assert.equal(h.renderer.root.findAllByType('select').find(node=>node.props['aria-describedby']==='input-help').props.value,'Stereo Mix'); assert.equal(h.session.mode,'recording'); assert.equal(h.count('ko_start_recording'),1); assert.equal(h.count('ko_stop_recording'),0);
  }));
  await test('Recording screen types partial transcript then replaces it with the final segment',()=>using({},async h=>{
    await h.start();
    await h.run(()=>h.emit('transcript-update',{sequence_id:7,text:'회의를 시작하',is_partial:true,audio_start_time:0}));
    let live = h.renderer.root.findAll(node=>node.props['data-testid']==='live-transcript')[0];
    assert.ok(live); assert.ok(live.findAllByType('p').map(node=>node.children.join('')).join('\n').includes('회의를 시작하'));
    await h.run(()=>h.emit('transcript-update',{sequence_id:7,text:'회의를 시작하겠습니다.',is_partial:false,audio_start_time:0}));
    live = h.renderer.root.findAll(node=>node.props['data-testid']==='live-transcript')[0];
    const rendered = live.findAllByType('p').map(node=>node.children.join('')).join('\n');
    assert.ok(rendered.includes('회의를 시작하겠습니다.')); assert.ok(!rendered.includes('미확정'));
  }));
  await test('YouTube recording validates and embeds the video without opening a second native window',()=>using({},async h=>{
    h.overrides.set('ko_validate_video',async()=> 'https://www.youtube.com/watch?v=abc12345678');
    h.overrides.set('ko_open_video',async()=> 'https://www.youtube.com/watch?v=abc12345678');
    await h.run(()=>h.session.setConsent(true)); await h.run(()=>h.session.setVideoUrl('https://youtu.be/abc12345678'));
    await h.run(()=>h.session.startVideo());
    assert.equal(h.session.mode,'recording'); assert.equal(h.count('ko_open_video'),0);
    assert.equal(h.calls.find(call=>call.command==='ko_start_recording').args.micName,null);
    assert.equal(h.calls.find(call=>call.command==='ko_start_recording').args.systemName,'Speaker');
    assert.equal(h.session.videoEmbedUrl,'https://www.youtube-nocookie.com/embed/abc12345678');
    await h.run(()=>h.session.navigate('youtube'));
    assert.equal(h.renderer.root.findByType('iframe').props.src,'https://www.youtube-nocookie.com/embed/abc12345678');
  }));
  await test('A finalized live segment refreshes the current summary with the selected model',()=>using({},async h=>{
    h.overrides.set('ko_generate',async args=>args.stage==='notes'?'결정 사항: 다음 주에 검토한다.':'');
    await h.start();
    await h.run(()=>h.session.setLiveSummaryEnabled(true));
    await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'다음 주에 결과를 다시 검토하겠습니다.',is_partial:false,audio_start_time:0}));
    for(let i=0;i<50&&!h.session.liveSummary;i++)await h.run(()=>new Promise(resolve=>setTimeout(resolve,10)));
    assert.equal(h.calls.filter(call=>call.command==='ko_generate'&&call.args.stage==='notes').length,1);
    assert.equal(h.session.liveSummary,'결정 사항: 다음 주에 검토한다.');
  }));
  await test('Editing covered text discards an in-flight cumulative summary response',()=>using({},async h=>{
    const gate=deferred();h.overrides.set('ko_generate',()=>gate.promise);await h.start();await h.run(()=>h.session.setLiveSummaryEnabled(true));await h.run(()=>h.emit('transcript-update',{sequence_id:1,text:'이전 발언',is_partial:false}));
    for(let i=0;i<50&&!h.count('ko_generate');i++)await h.run(()=>new Promise(resolve=>setTimeout(resolve,10)));
    assert.equal(h.count('ko_generate'),1);await h.run(()=>h.session.setRows([{sequence_id:1,text:'수정한 원문',is_partial:false}]));await h.run(()=>gate.resolve('이전 발언의 요약'));await h.run(()=>h.session.setLiveSummaryEnabled(false));
    assert.equal(h.session.liveSummary,'');assert.ok(!h.snapshots.some(snapshot=>snapshot.liveSummary==='이전 발언의 요약'));
  }));
  await test('New AI corrections refresh live summary and reject a late summary of raw text',()=>using({snapshot:{version:1,title:'correction summary',rows:[{sequence_id:1,text:'일일 비하지 않습니다.',is_partial:false}],minutes:'',startedAt:null}},async h=>{
    const gate=deferred();let notes=0;h.overrides.set('ko_generate',args=>{
      if(args.stage==='correction')return JSON.stringify({corrections:JSON.parse(args.text).segments.map(part=>({id:part.id,text:'일희일비하지 않습니다.'}))});
      notes++;return notes===1?gate.promise:'일희일비하지 않기로 했습니다.';
    });
    await h.run(()=>h.session.setLiveSummaryEnabled(true));for(let i=0;i<50&&!notes;i++)await h.run(()=>new Promise(resolve=>setTimeout(resolve,10)));assert.equal(notes,1);
    await h.run(()=>h.session.setRows([{...h.session.rows[0],ai_correction:{version:1,source_text:'일일 비하지 않습니다.',model_key:'local:local-summary',glossary:'',text:'일희일비하지 않습니다.'}}]));
    await h.run(()=>gate.resolve('일일 비하지 않는다는 요약'));await h.advance(5000);
    for(let i=0;i<50&&h.session.liveSummaryRunning;i++)await h.run(()=>new Promise(resolve=>setTimeout(resolve,10)));
    assert.equal(h.session.liveSummary,'일희일비하지 않기로 했습니다.');assert.equal(notes,2);assert.ok(!h.snapshots.some(value=>value.liveSummary==='일일 비하지 않는다는 요약'));
    const last=h.calls.filter(call=>call.command==='ko_generate'&&call.args.stage==='notes').at(-1);assert.equal(JSON.parse(last.args.text).newUtterances[0].text,'일희일비하지 않습니다.');
    assert.equal(h.session.rows[0].text,'일일 비하지 않습니다.');
  }));
  await test('The correction hook refreshes an already completed live summary without editing raw rows',()=>using({snapshot:{version:1,title:'correction summary',rows:[{sequence_id:1,text:'일일 비하지 않습니다.',is_partial:false}],minutes:'',startedAt:null}},async h=>{
    h.overrides.set('ko_generate',async args=>args.stage==='correction'?JSON.stringify({corrections:JSON.parse(args.text).segments.map(part=>({id:part.id,text:'일희일비하지 않습니다.'}))}):JSON.parse(args.text).newUtterances.map(part=>part.text).join(' '));
    await h.run(()=>h.session.setLiveSummaryEnabled(true));for(let i=0;i<50&&!h.session.liveSummary;i++)await h.run(()=>new Promise(resolve=>setTimeout(resolve,10)));assert.equal(h.session.liveSummary,'일일 비하지 않습니다.');
    await h.run(()=>h.session.correction.setEnabled(true));await h.advance(5000);for(let i=0;i<50&&h.session.liveSummary!=='일희일비하지 않습니다.';i++)await h.run(()=>new Promise(resolve=>setTimeout(resolve,10)));
    assert.equal(h.session.liveSummary,'일희일비하지 않습니다.');assert.equal(h.session.rows[0].text,'일일 비하지 않습니다.');assert.equal(h.session.correction.completed,1);
  }));
  await test('Recovery import locks the session while archiving and preserves original on archive failure',()=>using({snapshot:{version:1,title:'existing',rows:[{text:'보존할 원문'}],minutes:'기존 회의록',startedAt:null}},async h=>{
    const gate=deferred();h.overrides.set('ko_export',()=>gate.promise);let applying;await h.run(()=>{applying=h.session.applyQueueRecovery([{text:'복구 구간'}],true);});assert.equal(h.session.mode,'recovering');await h.start();assert.equal(h.count('ko_start_recording'),0);await h.run(()=>gate.resolve('saved.json'));await h.run(()=>applying);assert.equal(h.session.rows[0].text,'복구 구간');assert.equal(h.session.minutes,'');assert.equal(h.session.mode,'idle');
  }));
  await test('Native enumeration retains real inputs and outputs without fabricating devices',()=>using({},async h=>{
    assert.deepEqual(copy(h.session.devices),inputDevices);
    assert.equal(h.session.systemDevice,'Output:Speaker');
    assert.equal(h.session.microphone,'Microphone');
    await h.run(()=>h.session.setMicrophone('Stereo Mix')); await h.run(h.session.refreshDevices);
    assert.equal(h.session.microphone,'Stereo Mix');
  }));
  await test('Every view transition preserves active recording and exactly one transcript subscription',()=>using({},async h=>{
    await h.start(); const counts = [...h.subscriptions.entries()];
    for (const [index,view] of ['recording','dictation','youtube','transcript','minutes','ai','settings','recording'].entries()) {
      await h.run(()=>h.session.navigate(view));
      await h.run(()=>h.emit('transcript-update',{sequence_id:index,text:`구간 ${index}`,is_partial:true}));
      await h.run(()=>h.emit('transcript-update',{sequence_id:index,text:`확정 ${index}`,is_partial:false}));
      assert.equal(h.session.view,view); assert.equal(h.session.mode,'recording'); assert.equal(h.session.rows.length,index+1);
      assert.equal(h.document.activeElement.tagName,'H1');
      assert.equal(h.listeners.get('transcript-update').size,1); assert.deepEqual([...h.subscriptions.entries()],counts);
    }
    assert.equal(h.count('ko_start_recording'),1); assert.equal(h.count('ko_stop_recording'),0);
    assert.deepEqual(copy(h.session.rows.map(row=>row.text)),['확정 0','확정 1','확정 2','확정 3','확정 4','확정 5','확정 6','확정 7']);
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
  await require('./record-history.cjs')({test,using,deferred});
  await require('./transcript-correction.cjs')({test,using,deferred});
  await require('./live-diarization-session.cjs')({test,using,deferred});
  const passed = results.filter(result=>result.status==='passed').length, failed = results.length-passed;
  const report = {passed,failed,executedAt:new Date().toISOString(),scope:'Offline React 18 renderer with real session hook, transcript editor, AppShell and helpers; mocked Tauri/browser boundary. StrictMode wrapper plus explicit teardown/remount; no native capture, network, model inference or WebView rendering.',results};
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true}); fs.writeFileSync(path.join(root,'test-results/ui-session.json'),JSON.stringify(report,null,2));
  console.log(`UI session tests: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(error=>{console.error(error); process.exitCode = 1;});

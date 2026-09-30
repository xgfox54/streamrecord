'use strict';
// Browser QA only. Native commands are simulated; never included in app source.
module.exports=function nativeFixture(scenario={}){
  const handlers=new Map(),callbacks=new Map();let callbackId=0,active=false,snapshot=scenario.snapshot||null;
  const calls=[];
  if(scenario.fastCorrectionClock){const interval=window.setInterval.bind(window);window.setInterval=(callback,delay,...args)=>interval(callback,delay===3000?10:delay,...args);}
  localStorage.setItem('stream-record.tray-notice','seen');
  window.__qa={calls,emit:(event,payload)=>{for(const id of handlers.get(event)||[])callbacks.get(id)?.({event,id,payload});}};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
    transformCallback:fn=>{callbacks.set(++callbackId,fn);return callbackId;},
    convertFileSrc:path=>path,
    invoke:async(command,args={})=>{
      calls.push({command,args});
      if(command==='plugin:event|listen'){const list=handlers.get(args.event)||[];list.push(args.handler);handlers.set(args.event,list);return args.handler;}
      if(command==='plugin:event|unlisten')return;
      if(command==='ko_load_snapshot')return snapshot;
      if(command==='ko_save_snapshot'){snapshot=JSON.parse(args.content);return 'QA/snapshot.json';}
      if(command==='get_audio_devices')return [{name:'테스트 마이크',device_type:'Input'},{name:'Stereo Mix (테스트)',device_type:'Input'}];
      if(command==='ko_models')return scenario.models||[];
      if(command==='ko_generate'){if(window.__qa.failCorrections)throw new Error('테스트 연결 오류');if(args.stage==='correction')return JSON.stringify({corrections:JSON.parse(args.text).segments.map(part=>({id:part.id,text:part.text.replaceAll('회의을','회의를').replaceAll('검토 하겠습니다','검토하겠습니다')}))});return '요약 테스트';}
      if(command==='is_recording')return active;
      if(command==='is_import_in_progress_command')return false;
      if(command==='api_get_transcript_config')return {provider:'localWhisper',model:'small-q5_1'};
      if(command==='whisper_get_available_models')return [{name:'small-q5_1',status:'Available'}];
      if(['whisper_init','whisper_load_model','set_language_preference','api_save_transcript_config'].includes(command))return;
      if(command==='ko_start_recording'){active=true;return;}
      if(command==='ko_stop_recording'){active=false;return;}
      if(command==='ko_export')return 'QA/exports/'+args.kind+'.txt';
      if(command==='ko_validate_video')return 'https://www.youtube.com/watch?v=LjwQhxDYsP8';
      if(command==='ko_get_proxy_endpoint')return {base:'http://127.0.0.1:10100/v1',hasApiKey:false};
      if(command==='ko_app_info')return {name:'Stream-Record',version:'QA candidate',platform:'windows',arch:'x64'};
      if(command==='whisper_get_models_directory')return 'QA/models';
      if(command==='whisper_get_current_model')return 'small-q5_1';
      if(command==='whisper_is_model_loaded')return true;
      if(command==='select_and_validate_audio_command')return null;
      throw new Error('Unhandled QA command: '+command);
    }};
};

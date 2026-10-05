'use strict';
// Browser QA only. Native commands are simulated; never included in app source.
module.exports=function nativeFixture(scenario={}){
  const handlers=new Map(),callbacks=new Map();let callbackId=0,active=false,snapshot=scenario.snapshot||null;
  const calls=[];const records=new Map((scenario.records||[]).map(record=>[record.recordId,record]));if(snapshot){snapshot={...snapshot,recordId:snapshot.recordId||'qa-initial'};records.set(snapshot.recordId,snapshot);}
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
      if(command==='ko_list_records')return {records:[...records.values()].map(record=>({id:record.recordId,title:record.title,updatedAt:'2026-10-01T00:00:00Z',rowCount:record.rows.length})),warnings:[]};
      if(command==='ko_load_record'){if(!records.has(args.id))throw new Error('record missing');return records.get(args.id);}
      if(command==='ko_save_snapshot'){if(window.__qa.failSave)throw new Error('테스트 저장 실패');snapshot=JSON.parse(args.content);records.set(snapshot.recordId,snapshot);return 'QA/snapshot.json';}
      if(command==='ko_default_playback_device')return '테스트 스피커';
      if(command==='get_audio_devices')return [{name:'테스트 마이크',device_type:'Input'},{name:'테스트 스피커',device_type:'Output'}];
      if(command==='ko_models')return scenario.models||[];
      if(command==='builtin_ai_list_models')return window.__qa.builtinModels||scenario.builtinModels||[];
      if(['builtin_ai_download_model','builtin_ai_cancel_download','builtin_ai_delete_model'].includes(command)){if(window.__qa.builtin)return window.__qa.builtin(command,args);return;}
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
      if(command==='ko_app_info')return {name:'Stream-Record',version:'0.6.26',platform:'windows',arch:'x64'};
      if(command==='whisper_get_models_directory')return 'QA/models';
      if(command==='whisper_get_current_model')return 'small-q5_1';
      if(command==='whisper_is_model_loaded')return true;
      if(command==='select_and_validate_audio_command')return null;
      throw new Error('Unhandled QA command: '+command);
    }};
};

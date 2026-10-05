import type {MeetingSession} from '../useMeetingSession';

type DisplayModel = {
 readonly id:string;
 readonly provider:string;
 readonly connectionId?:string;
 readonly connectionLabel?:string;
 readonly destination?:string;
};

export function connectionLabel(model:DisplayModel):string {
 if(model.connectionLabel)return model.connectionLabel;
 switch(model.provider){
  case 'local':return 'Ollama · 이 PC';
  case 'builtin':return '내장 요약 모델 · 이 PC';
  case 'chatgpt':return 'ChatGPT 계정';
  case 'subscription':return 'OpenCodex 연결';
  default:return '사용자 지정 연결';
 }
}

export function modelDestination(model:DisplayModel):string {
 if(model.destination)return model.destination;
 switch(model.provider){
  case 'builtin':return '이 PC의 내장 요약 엔진';
  case 'local':return '이 PC의 Ollama · 연결 관리에서 주소 확인';
  default:return '전송 주소를 아직 확인하지 못했습니다. AI 연결 관리에서 확인하세요.';
 }
}

export function correctionModelName(modelKey:string|undefined):string {
 const key=modelKey?.trim()??'';
 // Stored keys include provider, connection ID and a UUID revision; keep them for validation only.
 const connection=key.match(/^connection:[^:]+:(.+)$/);
 if(key.startsWith('connection:')&&!connection)return '모델 정보 없음';
 const model=connection?.[1]??key.replace(/^(?:local|builtin|chatgpt|subscription):/,'');
 const name=model.replace(/@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'').trim();
 return name||'모델 정보 없음';
}

export function ModelOptions({session:s}:{readonly session:MeetingSession}) {
 const groups=new Map<string,{readonly label:string;models:MeetingSession['models']}>();
 for(const model of s.models){
  const key=model.connectionId??model.provider;
  const group=groups.get(key);
  if(group)group.models.push(model);
  else {
   const label=connectionLabel(model);
   const repeated=s.models.some(item=>(item.connectionId??item.provider)!==key&&connectionLabel(item)===label);
   groups.set(key,{label:repeated?`${label} · ${key.slice(-8)}`:label,models:[model]});
  }
 }
 return <>{Array.from(groups,([key,group])=><optgroup key={key} label={group.label}>{group.models.map(model=><option key={s.modelKey(model)} value={s.modelKey(model)}>{model.id} · {group.label}</option>)}</optgroup>)}</>;
}

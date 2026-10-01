import {z} from 'zod';

export const connectionKind=z.enum(['opencodex','openclaw','openrouter','opencode','openai_compatible','openai_api','anthropic_api']);
export type ConnectionKind=z.infer<typeof connectionKind>;
export const profileSchema=z.object({
 id:z.string(),label:z.string(),kind:connectionKind,base:z.string(),enabled:z.boolean(),
 manualModelIds:z.array(z.string()),textOnlyConfirmed:z.boolean(),username:z.string(),
 revision:z.string(),hasApiKey:z.boolean(),
});
export type ConnectionProfile=z.infer<typeof profileSchema>;
export type ProfileInput=Omit<ConnectionProfile,'revision'|'hasApiKey'|'id'>&{
 readonly id?:string;
 readonly apiKey?:string|null;
};
export const catalogSchema=z.object({models:z.array(z.object({id:z.string(),provider:z.string(),connectionId:z.string(),connectionLabel:z.string(),destination:z.string(),revision:z.string()})),catalog:z.literal(true),inference:z.literal(false)});

export const connectionTemplates:readonly {readonly kind:ConnectionKind;readonly title:string;readonly description:string;readonly base:string}[]=[
 {kind:'opencodex',title:'OpenCodex 연결',description:'OpenCodex에 연결해 둔 모델을 사용합니다.',base:'http://127.0.0.1:10100/v1'},
 {kind:'openclaw',title:'OpenClaw 연결',description:'도구 실행을 차단한 전용 에이전트로 요약을 요청합니다.',base:'http://127.0.0.1:18789/v1'},
 {kind:'openrouter',title:'OpenRouter 연결',description:'여러 공급자 모델을 제공하는 클라우드 API 서비스입니다. API 사용료가 발생할 수 있습니다.',base:'https://openrouter.ai/api/v1'},
 {kind:'opencode',title:'OpenCode 연결',description:'실행 중인 OpenCode 서버에 연결합니다.',base:'http://127.0.0.1:4096'},
 {kind:'openai_compatible',title:'기타 OpenAI 호환 연결',description:'다른 중계 서버의 OpenAI 호환 API 주소를 직접 입력합니다.',base:''},
 {kind:'openai_api',title:'OpenAI API',description:'공식 API 키를 사용합니다. ChatGPT 구독과 별도로 과금됩니다.',base:'https://api.openai.com/v1'},
 {kind:'anthropic_api',title:'Anthropic API',description:'공식 API 키로 Claude 모델을 사용합니다. Claude 구독과 별도로 과금됩니다.',base:'https://api.anthropic.com/v1'},
];

export const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);

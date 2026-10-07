/** Stream-Record: prepare a Korean-capable local Whisper model before capture. */
import {invoke} from '@tauri-apps/api/core';
import {WhisperAPI, type ModelInfo} from '@/lib/whisper';
import {z} from 'zod';

export const DEFAULT_KOREAN_MODEL = 'small-q5_1';
export function isKoreanModel(name: string): boolean {
  return /^(tiny|base|small|medium|large(?:-v[123])?(?:-turbo)?)(?:-q[458]_[01])?$/.test(name);
}
export function chooseKoreanModel(models: readonly ModelInfo[], current?: string): string {
  const ready = models.filter(m => m.status === 'Available' && isKoreanModel(m.name));
  if (current && ready.some(m => m.name === current)) return current;
  const order = [DEFAULT_KOREAN_MODEL, 'small', 'base-q5_1', 'base', 'medium-q5_0', 'medium', 'large-v3-turbo-q5_0', 'large-v3-turbo', 'large-v3', 'tiny-q5_1', 'tiny'];
  return order.find(name => ready.some(m => m.name === name)) ?? ready[0]?.name ?? DEFAULT_KOREAN_MODEL;
}

let preparing: Promise<{provider: string; model: string}> | null = null;
export function ensureKoreanWhisper(notify: (message: string) => void): Promise<{provider: string; model: string}> {
  if (preparing) return preparing;
  preparing = prepare(notify).finally(() => { preparing = null; });
  return preparing;
}
async function prepare(notify: (message: string) => void): Promise<{provider: string; model: string}> {
  notify('한국어 음성 모델 확인 중');
  await WhisperAPI.init();
  const config = await invoke<{provider: string; model: string} | null>('api_get_transcript_config');
  let models = await WhisperAPI.getAvailableModels();
  let model = chooseKoreanModel(models, config?.provider === 'localWhisper' ? config.model : undefined);
  if (!models.some(m => m.name === model && m.status === 'Available')) {
    try {
      notify('설치파일에 포함된 한국어 모델을 확인·등록합니다. 인터넷 다운로드는 하지 않습니다.');
      const bundled = await invoke<string>('ko_prepare_bundled_whisper');
      if (bundled !== DEFAULT_KOREAN_MODEL) throw new Error('동봉 모델 식별자가 올바르지 않습니다.');
      models = await WhisperAPI.getAvailableModels();
      model = bundled;
      if (!models.some(m => m.name === model && m.status === 'Available')) throw new Error('동봉 모델 등록이 완료되지 않았습니다. 모델 포함 설치파일과 저장 공간을 확인하세요.');
    } catch (error) {
      throw new Error(`한국어 모델 준비 실패. 녹음은 시작하지 않았고 기존 자료는 보존됩니다. 자동 다운로드는 하지 않습니다. ${String(error)}`);
    }
  }
  notify(`한국어 모델 ${model} 불러오는 중`);
  await WhisperAPI.loadModel(model);
  await invoke('set_language_preference', {language: 'ko'});
  await invoke('api_save_transcript_config', {provider: 'localWhisper', model, apiKey: null});
  let acceleration='';
  try {
    const parsed=z.object({backend:z.string(),gpu_requested:z.boolean(),cpu_fallback:z.boolean()}).nullable().safeParse(await invoke<unknown>('whisper_get_acceleration_status'));
    if(parsed.success&&parsed.data)acceleration=parsed.data.gpu_requested?` · GPU 자동 선택 (${parsed.data.backend})`:parsed.data.cpu_fallback?' · GPU를 사용할 수 없어 CPU로 처리합니다.':' · CPU 처리';
  } catch(error) {
    console.warn('음성 인식 가속 상태 조회 실패',error instanceof Error?error.message:String(error));
  }
  notify(`한국어 음성 인식 준비 완료 · ${model}${acceleration}`);
  return {provider: 'localWhisper', model};
}

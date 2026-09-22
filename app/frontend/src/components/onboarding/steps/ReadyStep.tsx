import React, { useEffect, useState } from 'react';
import { Check, Mic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function ReadyStep() {
  const { goNext, completeOnboarding } = useOnboarding();
  const [isMac, setIsMac] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    checkPlatform();
  }, []);

  const handleContinue = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (isMac) {
        goNext();
        return;
      }
      await completeOnboarding();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingContainer
      title="준비 완료"
      description="한국어 음성 인식 모델은 설치본에 포함되어 있습니다. 추가로 내려받을 항목은 없습니다."
      step={3}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-8">
        <div className="w-full max-w-md space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <Mic className="mt-0.5 h-5 w-5 text-gray-500" />
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">한국어 음성 인식</h3>
              <p className="text-sm text-gray-600">설치본에 포함된 로컬 Whisper 모델을 사용합니다.</p>
            </div>
            <Check className="mt-0.5 h-5 w-5 text-green-600" />
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <Sparkles className="mt-0.5 h-5 w-5 text-gray-500" />
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">회의록 요약</h3>
              <p className="text-sm text-gray-600">
                요약 모델은 설치되어 있지 않습니다. AI 연결에서 로컬 모델을 내려받거나 사용 중인 계정을 연결하세요.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <p className="w-full max-w-md text-sm text-red-600">{error}</p>
        )}

        <div className="w-full max-w-xs">
          <Button
            onClick={handleContinue}
            disabled={busy}
            className="h-11 w-full bg-gray-900 text-white hover:bg-gray-800"
          >
            {busy ? '설정을 저장하는 중…' : '시작하기'}
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}

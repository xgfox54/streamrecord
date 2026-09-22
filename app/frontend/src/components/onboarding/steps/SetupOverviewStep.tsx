import React, { useEffect, useState } from 'react';
import { Check, Mic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function SetupOverviewStep() {
  const { goNext } = useOnboarding();
  const [isMac, setIsMac] = useState(false);

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

  return (
    <OnboardingContainer
      title="설치 구성 안내"
      description="한국어 음성 인식 모델은 설치본에 들어 있고, 요약 모델은 나중에 직접 고를 수 있습니다."
      step={2}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-10">
        <div className="w-full max-w-md space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <Mic className="mt-0.5 h-5 w-5 text-gray-500" />
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">1. 한국어 음성 인식</h3>
              <p className="text-sm text-gray-600">설치본에 포함되어 있어 추가로 내려받을 필요가 없습니다.</p>
            </div>
            <Check className="mt-0.5 h-5 w-5 text-green-600" />
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <Sparkles className="mt-0.5 h-5 w-5 text-gray-500" />
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">2. 회의록 요약 (선택)</h3>
              <p className="text-sm text-gray-600">
                처음에는 요약 모델이 없습니다. 설치 후 AI 연결에서 로컬 요약 모델을 내려받거나 사용 중인 계정·엔드포인트를 연결하세요.
              </p>
            </div>
          </div>
        </div>

        <div className="w-full max-w-xs">
          <Button
            onClick={() => goNext()}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white"
          >
            다음
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}

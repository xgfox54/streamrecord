'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';

export default function Upstream() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings');
  }, [router]);
  return <div style={{padding: 24}}>고급 음성 모델 설정으로 이동하는 중…</div>;
}

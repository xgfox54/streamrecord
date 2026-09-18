'use client';

import { useEffect } from 'react';
import { startKoreanLocale } from '@/lib/ko-locale';

export default function KoreanLocalizer() {
  useEffect(() => startKoreanLocale(), []);
  return null;
}

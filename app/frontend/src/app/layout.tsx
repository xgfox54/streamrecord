'use client';

import './globals.css';
import {usePathname} from 'next/navigation';
import {useEffect,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
const UpstreamLayout = dynamic(() => import('@/components/UpstreamLayout').then(module => module.UpstreamLayout));

export default function RootLayout({children}: {readonly children: ReactNode}) {
  const pathname = usePathname();
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      void import("react-grab");
    }
  }, []);
  return <html lang="ko" data-jeju-profile="public"><head><title>Stream-Record</title><meta name="description" content="한국어 로컬 녹음과 받아쓰기, 근거를 확인하는 회의록" /></head><body className="font-sans antialiased">
    {pathname === '/' ? children : <UpstreamLayout>{children}</UpstreamLayout>}
  </body></html>;
}

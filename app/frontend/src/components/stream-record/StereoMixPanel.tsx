'use client';
import {Volume2} from 'lucide-react';
import type {MeetingSession} from './useMeetingSession';
import {Spinner} from './TranscriptActivity';
import styles from './activity.module.css';
const messages={
 active:'스테레오 믹스가 켜져 있습니다. 위 목록에서 선택하면 PC에서 재생되는 모든 소리를 녹음합니다.',
 disabled:'스테레오 믹스가 꺼져 있습니다. 아래 버튼으로 켜면 Windows가 PC 소리를 녹음 장치로 제공합니다. 관리자 권한 확인 창이 나오면 예를 눌러 주세요.',
 unplugged:'스테레오 믹스 장치가 연결되어 있지 않습니다. 오디오 장치를 확인한 뒤 소리 장치 새로고침을 눌러 주세요.',
 unsupported:'이 PC의 소리 드라이버는 스테레오 믹스를 제공하지 않습니다. 위 목록의 스피커·헤드폰으로도 PC 소리를 녹음할 수 있습니다.',
} as const;
export function StereoMixPanel({session:s}:{readonly session:MeetingSession}){
 const status=s.stereoMix;
 if(!status||!(status.state in messages))return null;
 return <div className={styles.stereoMix} data-state={status.state} data-testid="stereo-mix-panel"><Volume2 size={18} aria-hidden="true"/><p id="stereo-mix-help">{messages[status.state]}</p>{status.state==='disabled'&&<button aria-describedby="stereo-mix-help" disabled={s.busy||s.stereoMixBusy} onClick={()=>void s.enableStereoMix()}>{s.stereoMixBusy?<><Spinner/>켜는 중…</>:'스테레오 믹스 켜기'}</button>}</div>;
}

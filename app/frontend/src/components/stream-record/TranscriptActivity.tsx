'use client';
import styles from './activity.module.css';
export function Spinner(){return <span className={styles.spinner} aria-hidden="true"/>;}
function Dots(){return <span className={styles.dots} aria-hidden="true"><span/><span/><span/></span>;}
export function TranscribingIndicator({stopping=false}:{readonly stopping?:boolean}){
 return <p className={styles.typing} role="status" data-testid="transcribing-indicator"><Dots/><span>{stopping?'마지막 문장을 정리하는 중':'실시간 전사 중'}</span></p>;
}
export function WaitingPanel({stopping=false}:{readonly stopping?:boolean}){
 return <div className={styles.waiting} role="status" data-testid="transcribing-waiting"><Dots/><p><strong>{stopping?'마지막 문장을 정리하는 중':'소리를 듣고 있습니다'}</strong><span>{stopping?'잠시 후 녹음이 저장됩니다.':'첫 문장이 인식되면 여기에 표시됩니다.'}</span></p></div>;
}
export function LoadingPanel(){
 return <div className={styles.loading} role="status" data-testid="start-loading"><Spinner/><p><strong>녹음을 준비하고 있습니다</strong><span>한국어 음성 모델과 소리 장치를 확인하는 중입니다. 처음에는 몇 초 걸릴 수 있습니다.</span></p><span className={styles.bar} aria-hidden="true"/></div>;
}
export function LoadingLine(){return <p className={styles.typing} role="status" data-testid="start-loading-line"><Spinner/><span>녹음을 준비하고 있습니다</span></p>;}

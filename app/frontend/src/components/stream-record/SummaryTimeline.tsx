import {summaryBlocks} from './summary-display';
import styles from './summary-timeline.module.css';
export function SummaryTimeline({text,fallbackTime=null}:{readonly text:string;readonly fallbackTime?:string|null}){
 return <div className={styles.timeline}>{summaryBlocks(text,fallbackTime).map((block,index)=><article key={index} className={styles.block}>{block.time&&<time>{block.time}</time>}<p>{block.sentences.map((sentence,part)=><span key={part} className={sentence.needsReview?styles.review:undefined} aria-label={sentence.needsReview?'사용자 확인이 필요한 내용':undefined}>{sentence.text}{part<block.sentences.length-1?' ':''}</span>)}</p></article>)}</div>;
}

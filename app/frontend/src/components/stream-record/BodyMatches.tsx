import type {Hit} from './useBodySearch';
import styles from './studio.module.css';

type Props = {hits:readonly Hit[];disabled:boolean;onSelect:(hit:Hit)=>Promise<void>};
export function BodyMatches({hits,disabled,onSelect}:Props){
  if(!hits.length)return null;
  return <div className={styles.searchHits}>
    <details open={hits.length===1}>
      <summary>본문에서 일치한 구간 {hits.length}개</summary>
      <ul>{hits.map(hit=><li key={hit.index}>
        <button disabled={disabled} onClick={()=>void onSelect(hit)}>
          <time>{hit.time}</time> · {hit.playable?'원음 재생':'문장 보기'} · {hit.excerpt}
        </button>
      </li>)}</ul>
    </details>
  </div>;
}

'use client';
import {memo, useEffect, useMemo, useRef} from 'react';
import Markdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {Element, ElementContent} from 'hast';
import {sourceLabel} from '../meeting-ko/core';
import styles from './minutes.module.css';

const sourcePattern=/^#source-(S\d{6}(?:p\d+)?)$/;
const gfm=[remarkGfm];
function plainText(node:Element|ElementContent):string{
  if(node.type==='text')return node.value;
  return 'children' in node?node.children.map(plainText).join(''):'';
}
function elements(node:Element|undefined,tag:string):Element[]{
  return node?.children.filter((child):child is Element=>child.type==='element'&&child.tagName===tag)??[];
}

export const MinutesDocument=memo(function MinutesDocument({text,onEvidence}:{text:string;onEvidence:(id:string)=>void}){
  const evidenceHandler=useRef(onEvidence);
  useEffect(()=>{evidenceHandler.current=onEvidence;},[onEvidence]);
  const components=useMemo<Components>(()=>{
    const citation=(id:string)=><button type="button" className={styles.citation} onClick={()=>evidenceHandler.current(id)} aria-label={`${sourceLabel(id)} 원문 보기`}>{sourceLabel(id)}</button>;
    return {
      h1:({children})=><h2 className={styles.title}>{children}</h2>,
      h2:({children})=><h3 className={styles.section}>{children}</h3>,
      h3:({children})=><h4 className={styles.topic}>{children}</h4>,
      h4:({children})=><h5 className={styles.topic}>{children}</h5>,
      a:({href,children})=>{const id=href?.match(sourcePattern)?.[1];return id?citation(id):<span>{children}</span>;},
      p:({node,children})=>/^\[\d{2,}:\d{2}:\d{2}~\]$/.test(node?plainText(node):'')?<p className={styles.time}>{children}</p>:<p>{children}</p>,
      blockquote:({node,children})=>/^근거 원문 ·/.test(node?plainText(node).trim():'')?<details className={styles.quote}><summary>근거 원문 보기</summary><blockquote>{children}</blockquote></details>:<blockquote>{children}</blockquote>,
      table:({node,children})=>{
        const headers=elements(elements(elements(node,'thead')[0],'tr')[0],'th').map(plainText);
        if(headers.join('|')!=='내용|담당자|기한|근거 구간|원문 인용')return <div className={styles.tableWrap}><table>{children}</table></div>;
        const rows=elements(elements(node,'tbody')[0],'tr');
        return <ul className={styles.facts}>{rows.map((row,index)=>{
          const cells=elements(row,'td').map(plainText);
          const [body,owner,due,source,quote]=cells;
          const id=source?.match(/\bS\d{6}(?:p\d+)?\b/)?.[0];
          const time=source?.replace(/\bS\d{6}(?:p\d+)?\b/,'').replace(/^\s*·\s*/,'');
          const metadata=[owner&&owner!=='[확인 필요]'?`담당자: ${owner}`:'',due&&due!=='[확인 필요]'?`기한: ${due}`:''].filter(Boolean);
          return <li key={index}><p>{body}</p>{metadata.length>0&&<p className={styles.metadata}>{metadata.join(' · ')}</p>}<p className={styles.metadata}>근거: {id?citation(id):source}{id&&time&&` · ${time}`}</p><details className={styles.quote}><summary>근거 원문 보기</summary><blockquote>{quote}</blockquote></details></li>;
        })}</ul>;
      },
    };
  },[]);
  const content=useMemo(()=><Markdown remarkPlugins={gfm} components={components} skipHtml disallowedElements={['img','input']} urlTransform={url=>sourcePattern.test(url)?url:''}>{text}</Markdown>,[text,components]);
  return <article className={styles.document} aria-label="회의록 문서" data-testid="minutes-document">{content}</article>;
});

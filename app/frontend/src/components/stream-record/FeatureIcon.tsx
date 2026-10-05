import type {ReactNode} from 'react';
import styles from './feature-icon.module.css';

type FeatureKind = 'dictation' | 'minutes' | 'summary';
type FeatureIconProps = {
  readonly kind: FeatureKind;
  readonly size?: 'tab' | 'heading' | 'empty';
};

const glyphs: Readonly<Record<FeatureKind, ReactNode>> = {
  dictation: <>
    <path d="M6 4h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-6l-4 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"/>
    <g fill="currentColor" stroke="none"><circle cx="8" cy="11.5" r="1"/><circle cx="12" cy="11.5" r="1"/><circle cx="16" cy="11.5" r="1"/></g>
  </>,
  minutes: <>
    <path d="M14 2H5v20h14V7l-5-5Z"/><path d="M14 2v5h5M8 11h8M8 15h8M8 18h5"/>
  </>,
  summary: <g fill="currentColor" stroke="none">
    <path d="M11 1c1.5 6.9 3.1 8.5 10 10-6.9 1.5-8.5 3.1-10 10-1.5-6.9-3.1-8.5-10-10 6.9-1.5 8.5-3.1 10-10ZM21 1c.4 1.7.8 2.1 2.5 2.5-1.7.4-2.1.8-2.5 2.5-.4-1.7-.8-2.1-2.5-2.5 1.7-.4 2.1-.8 2.5-2.5ZM3 18c.4 1.7.8 2.1 2.5 2.5-1.7.4-2.1.8-2.5 2.5-.4-1.7-.8-2.1-2.5-2.5 1.7-.4 2.1-.8 2.5-2.5Z"/>
  </g>,
};

export function FeatureIcon({kind, size = 'heading'}: FeatureIconProps) {
  return <span className={styles.icon} data-feature-icon={kind} data-size={size} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">{glyphs[kind]}</svg>
  </span>;
}

import {FileText,MessageSquare,Sparkles} from 'lucide-react';
import styles from './feature-icon.module.css';
type FeatureKind='dictation'|'minutes'|'summary';
const icons={dictation:MessageSquare,minutes:FileText,summary:Sparkles};
export function FeatureIcon({kind,size='heading'}:{readonly kind:FeatureKind;readonly size?:'tab'|'heading'|'empty'}){const Icon=icons[kind];return <span className={styles.icon} data-feature-icon={kind} data-size={size} aria-hidden="true"><Icon strokeWidth={1.6}/></span>;}

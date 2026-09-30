'use client';
import type {MeetingSession} from './useMeetingSession';
import {LiveSummaryPanel} from './LiveSummaryPanel';
import {LiveTranscriptPanel} from './LiveTranscriptPanel';
import {RecordingPreparation} from './RecordingPreparation';
import {SessionProgress} from './SessionProgress';
import {WorkflowSteps} from './WorkflowSteps';
import styles from './guidance.module.css';
export function RecordingView({session:s}:{readonly session:MeetingSession}) {
  return <div className={styles.recordingPage}>
    <WorkflowSteps session={s}/><SessionProgress session={s}/>
    <div className={styles.recordingColumns}>
      <RecordingPreparation session={s}/>
      <div className={styles.liveColumn}><LiveTranscriptPanel session={s}/><LiveSummaryPanel session={s}/></div>
    </div>
  </div>;
}

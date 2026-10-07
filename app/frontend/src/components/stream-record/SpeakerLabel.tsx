import {participantName,speakerNote,speakerNumbers} from '../meeting-ko/speakers';
import type {TranscriptRow} from '../meeting-ko/core';
import layout from './dictation.module.css';
/** Each participant gets a colored dot so speakers are easy to tell apart; the name stays in text for screen readers. */
export function SpeakerLabel({row}:{readonly row:TranscriptRow}){
 const ids=speakerNumbers(row);if(!ids.length)return null;
 return <span className={layout.speakers}>{ids.map(id=><span key={id} className={layout.speaker} data-speaker={id}><span className={layout.speakerDot} aria-hidden="true"/>{participantName(id)}</span>)}<span>{speakerNote(row)}</span></span>;
}

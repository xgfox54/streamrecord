import {speakerLabel} from '../meeting-ko/speakers';
import type {TranscriptRow} from '../meeting-ko/core';
export function SpeakerLabel({row}:{readonly row:TranscriptRow}){const label=speakerLabel(row);return label?<span>{label}</span>:null;}

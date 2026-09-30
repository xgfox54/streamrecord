import type {TranscriptRow} from './core';

/** Review hints only: equal text at distinct times can be a real repeated utterance. */
export function repeatedPassages(rows: readonly TranscriptRow[]): ReadonlySet<number> {
  const candidates = new Set<number>();
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (!previous || row.is_partial || previous.is_partial) return;
    const text = row.text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    const start = row.audio_start_time ?? row.chunk_start_time;
    const priorStart = previous.audio_start_time ?? previous.chunk_start_time;
    if (text.length < 16 || typeof start !== 'number' || typeof priorStart !== 'number') return;
    if (start > priorStart && start - priorStart <= 15 &&
        text === previous.text.normalize('NFC').replace(/\s+/gu, ' ').trim()) candidates.add(index);
  });
  return candidates;
}

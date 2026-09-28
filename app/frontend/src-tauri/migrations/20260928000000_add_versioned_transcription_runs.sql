ALTER TABLE transcripts ADD COLUMN raw_engine_output TEXT;
ALTER TABLE transcripts ADD COLUMN raw_engine_output_status TEXT NOT NULL DEFAULT 'raw_unavailable_legacy';
ALTER TABLE transcripts ADD COLUMN score_kind TEXT NOT NULL DEFAULT 'unavailable';
ALTER TABLE transcripts ADD COLUMN score_value REAL;
ALTER TABLE transcripts ADD COLUMN score_engine TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE transcripts ADD COLUMN score_calibration TEXT NOT NULL DEFAULT 'legacy_unavailable';
ALTER TABLE transcripts ADD COLUMN spans_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS transcription_runs (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    engine TEXT NOT NULL,
    model TEXT,
    language TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcription_run_segments (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    sequence_id INTEGER NOT NULL,
    raw_engine_output TEXT,
    raw_engine_output_status TEXT NOT NULL DEFAULT 'captured',
    transcript TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    audio_start_time REAL,
    audio_end_time REAL,
    duration REAL,
    score_kind TEXT NOT NULL,
    score_value REAL,
    score_engine TEXT NOT NULL,
    score_calibration TEXT NOT NULL,
    spans_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (run_id) REFERENCES transcription_runs(id) ON DELETE CASCADE,
    UNIQUE (run_id, sequence_id)
);

CREATE INDEX IF NOT EXISTS idx_transcription_runs_meeting_created
ON transcription_runs(meeting_id, created_at);

CREATE INDEX IF NOT EXISTS idx_transcription_run_segments_run_sequence
ON transcription_run_segments(run_id, sequence_id);

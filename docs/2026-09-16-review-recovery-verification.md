# Stream-Record: STT hints, audio review and resumable transcription

## Changes applied to the authoritative app/ source

- Corrected completed Whisper windows under 15 seconds being returned as partial. A completed full-window decode is now final regardless of duration. This prevents the bounded 12-second live path from leaving every transcript unconfirmed.
- Added bounded Korean glossary hints to live Whisper transcription. Prior text is passed only for the immediately preceding completed audio window, with a short allowed gap. A generation token prevents a late worker from carrying text into a new meeting.
- Added explicit prompt support to the transcription provider trait and Whisper provider. Other providers retain their old behavior.
- Added native authorization of exactly the audio files selected through the file picker or successfully saved by this app. Playback adds only an exact file to the Tauri asset scope; it does not add a wildcard for the user folder.
- Added original-audio playback with transcript-range seek controls. Unknown or invalid timestamps are not converted to a guessed offset. Without an explicit end timestamp, playback previews up to 12 seconds; it is not word-level alignment.
- Added a separate saved-audio transcription/continue workflow. It processes at most 24 seconds per request using the loaded local Korean Whisper model and ffmpeg with only file/pipe input protocols. This workflow does not download models except through the existing explicit Korean model preparation step.
- Recovery checkpoints are keyed by original audio SHA-256, duration, model name, glossary and recovery/prompt version. Completed silent windows are checkpointed without inventing speech. Invalid/incomplete windows are reprocessed, not treated as completed. A persistence failure prevents submission of the next window.
- Recovery results replace the displayed transcript only after the full file succeeds and the previous transcript/notes have been exported to a separate JSON bundle. The original recording and raw previous transcript are not edited in place.
- Added recovery checkpoint and audio identity fields to the backward-compatible version-1 workspace snapshot.
- Fixed the verification script's dependency on inherited USERPROFILE/APPDATA/CARGO_HOME/SystemRoot and related process environment values. It resolves standard Windows folders instead of failing on missing variables.

## Verification actually executed in this work session

- `npm run test:stream-record`: PASS, 40 tests, zero failures, 2026-09-16T12:07:16.134Z. This is an offline mocked regression suite, not real audio inference.
- `npm run typecheck`: PASS, exit code 0, after the audio review and recovery UI changes.
- The previously approved finalization job e9119dd1-a55f-42d9-911b-e2d15c037b8b actually executed but exited 1 before tests/rename: missing USERPROFILE caused Join-Path to fail. It must not be described as a successful compilation or rename.
- The corrected finalization script has not yet produced a successful result at the time this report was written. Native `cargo check` and filtered Rust unit tests require a new exact-command execution receipt.

## Verification boundaries and usage

- The original source folder was still `meetily-korean` when this report was written. Check `app/frontend/test-results/finalization.json` for the later actual rename/compile outcome; do not infer rename success from this report's title.
- No new EXE was built or installed during the checks listed above.
- No real microphone, Stereo Mix audio, Whisper model inference, 3-hour recording, or playback-device verification was performed.
- After restarting the app, reselect the original audio through the native file picker. A stored path is not sufficient to grant access. A stored SHA-256 mismatch rejects the association with the existing transcript.
- Live glossary hints and this new 24-second recovery path are supported; the old general file-import engine was not rewritten to add glossary hints.
- This implements resume for the new saved-audio recovery workflow, not automatic crash recovery of an interrupted live recording's unmerged audio checkpoint files.
- Fixed-window boundary recognition accuracy still needs real Korean audio A/B testing. These changes do not guarantee zero STT errors.
- Model catalog/integrity changes must also bump the recovery version to invalidate old model-name-based checkpoints.
- HLS direct input, automatic speaker identity, HWPX export, and automatic live audio checkpoint merging remain separate future work.

## New files

- app/frontend/src-tauri/src/whisper_engine/stt_context.rs
- app/frontend/src-tauri/src/review_audio.rs
- app/frontend/src/components/meeting-ko/review-core.ts

Existing files changed include KoreanWorkspace.tsx, transcription provider/worker code, whisper_engine.rs, meeting_ko.rs, lib.rs, import.rs, recording_saver.rs, tauri.conf.json, tests/stream-record.cjs, and tools/finalize-stream-record.ps1.

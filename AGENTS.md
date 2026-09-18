# Stream-Record development rules

Stream-Record is an independent project. Meetily and ai-live-transcribe are references, not authoritative sources to reapply. The user requested the root folder name Stream-Record; verify the actual filesystem rename separately.

## Source ownership
- Edit app/ directly. It is the authoritative application source.
- overlay/, apply.mjs and UPSTREAM_COMMIT.txt are historical reference. Do not apply an overlay over app/, force an upstream commit, reset user modifications, or require an upstream remote to build.
- Keep original MIT copyright/license notices. Any later copied Apache-2.0 code requires appropriate source/change/NOTICE tracking; current new modules are independently implemented.
- Keep existing application identifier and model/data paths until a separately tested migration is explicitly requested. Do not delete recordings, model files or user settings.

## Product defaults
- Korean (ko) and multilingual local Whisper by default. Reuse the selected installed multilingual model; prepare small-q5_1 only if no suitable installed model is available.
- Verify model availability after downloading, including cancellation. Do not start recording before preparation succeeds.
- Input selection includes actual Input devices, including Stereo Mix. Never synthesize a nonexistent device or silently substitute a microphone.
- Local and opt-in proxy summary providers are listed independently. A proxy listing must not hide local models or silently become the default.
- Preserve original transcripts. User corrections live in reviewed_text. Quotes and source IDs must validate before accepting structured notes.
- Checkpoint intermediate summaries. Changes to text, model, glossary or prompt version invalidate reuse.

## Verification
- From app/frontend: npm run test:stream-record; npm run typecheck.
- Root setup.mjs check/build also executes legacy regression tests and the new regression suite. It must not clone/check out upstream or reapply overlays.
- Report offline mocked tests, TypeScript checks, Rust compilation, packaged EXE, real capture, model inference and long-duration testing separately. Do not claim an installed app is updated merely because source files changed.
- Arbitrary shell, folder rename, external downloads, GUI operation and distribution obey the local connector approval requirements. Never bypass approval by concealing an operation in a test/build script.

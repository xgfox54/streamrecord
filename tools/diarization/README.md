# Local Nemotron 3 diarization

Stream-Record keeps Whisper transcription and runs this independent native engine on the complete saved recording. The engine reads local audio only. It does not send audio to a server, infer people from transcript text, or require Python, CUDA, OpenCodex, or a model download at first run when the runtime resource is packaged.

## Reproduce the Windows bundle

Prerequisites: Visual Studio 2022 C++ Build Tools, CMake >=3.26 and Windows tar. Run in PowerShell:

```powershell
./tools/diarization/build-native.ps1 -WorkDirectory C:/StreamRecordBuild/nemotron
```

This downloads pinned source archives and the public NVIDIA Q8 model, builds a CPU/AVX2 native runtime, verifies the model SHA256, collects runtime DLLs and licenses, and writes `outputs/diarization-native/runtime/manifest.json`. It installs no system components or drivers. Copy this complete directory as the Tauri resource `bundled-diarization` including `licenses/`. Do not bundle only the EXE. The native source is unmodified; CPU uses upstream stock ggml with `/utf-8` for Korean Windows compilers. Only ASR runtime dependencies needed by diarization are compiled; ASR CLI, HTTP server, microphone capture, TTS, NMT, KenLM and Flashlight are disabled.

- Engine: NVIDIA/NeMo-Speech.cpp `4c101bc7113f49101a3e11d2c994c519f41939f6`, Apache-2.0.
- ggml: `c03b4e2bcece5134827881af90242086daf75be5`, MIT.
- SentencePiece: `v0.2.0`, Apache-2.0.
- Model: nvidia/Nemotron-3-Diarization `f667ed73aee57d40cc39428eb768b4fd87a0a29e`, OpenMDW-1.1.
- Model artifact: `Nemotron-3-Diarization.q8_0.gguf`, 107012128 bytes, SHA256 `08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1`.
- Bundled Microsoft VC143/OpenMP redistributable DLLs come from the installed Visual Studio redistribution directory. Their terms are separate from the native engine/model licenses.

## IPC and alignment

`ko_run_diarization({path, expectedSha256})` accepts only audio authorized by the app's existing native file picker/recording registry. It hashes and validates the source, refuses an unmatched source SHA256, obtains the shared import and recording-transition locks, normalizes to an isolated temporary mono16k PCM WAV, and runs one complete-recording native session. Source registry/hash are checked again before returning. Cancellation and failure never replace source audio or transcript text.

Response:

```json
{"audioSha256":"...","durationSeconds":97.6,"modelId":"nvidia/Nemotron-3-Diarization","modelRevision":"f667ed73aee57d40cc39428eb768b4fd87a0a29e","engineRevision":"4c101bc7113f49101a3e11d2c994c519f41939f6","segments":[{"start":0.121,"end":9.389,"speaker":1}]}
```

Times are seconds from the beginning of **the exact complete original audio**, with no silence removal. Speaker numbers1..8 are arrival-order generic channels, not personal identity. Overlapping speech remains overlapping intervals. Attach intervals only to rows for the same audio SHA. Keep source text and corrections independent. If several speaker intervals overlap a transcript row, retain multiple speakers rather than assign an arbitrary winner. Source audio replacement invalidates all previous diarization.

`ko_cancel_diarization()` cancels the active job; subprocesses are killed on future drop. One job at a time; overall limit2hours, conversion limit10minutes, audio metadata limit24hours. It reports unavailable/mismatched model explicitly. No automatic model download or fallback to guessed speakers.

## Validation

```powershell
cargo test --manifest-path tools/diarization/Cargo.toml
cargo clippy --manifest-path tools/diarization/Cargo.toml --all-targets -- -D warnings
cargo run --manifest-path tools/diarization/Cargo.toml --example verify -- <runtime-directory> <mono-wav-path> <seconds>
cargo run --manifest-path tools/diarization/Cargo.toml --example cancel -- <runtime-directory> <mono-wav-path> <seconds>
```

2026-10-01: the real 97.60-second public Hugging Face example produced 25 intervals across 7 speaker channels. The final Rust adapter and final bundle elapsed 14.889 seconds on CPU. An extended 292.8-second version of the same public fixture was used for cancellation: the native child was observed running, cancellation returned at 12.171 seconds after a 12-second request, and no native child remained. Earlier 8-second checks cancelled during model integrity hashing, before the native child started; they do not prove subprocess cancellation. Four contract tests passed, strict Clippy passed. These results demonstrate native execution and timestamp output, not measured diarization accuracy: no reference RTTM/DER evaluation was performed. Evidence is in `outputs/diarization-native/`.

**Scope:** this delivers saved-audio/after-recording diarization. `v3-offline` is a bounded-cache streaming model preset internally, but the app adapter currently waits for the complete saved recording and returns one final result. Do not label this as live speaker updates during recording. A future persistent PCM streaming bridge must carry one speaker cache across all chunks; independent chunk jobs must not be used because they reset speaker identities.

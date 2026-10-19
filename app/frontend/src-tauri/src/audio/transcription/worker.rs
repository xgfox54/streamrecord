// audio/transcription/worker.rs
//
// Parallel transcription worker pool and chunk processing logic.

use super::accounting::{ChunkStatus, TranscriptionAccounting};
use super::engine::TranscriptionEngine;
use super::provider::{TranscriptResult, TranscriptScore, TranscriptSpan, TranscriptionError};
use crate::audio::AudioChunk;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

// Sequence counter for transcript updates
static SEQUENCE_COUNTER: AtomicU64 = AtomicU64::new(0);

// Speech detection flag - reset per recording session
static SPEECH_DETECTED_EMITTED: AtomicBool = AtomicBool::new(false);

/// Reset the speech detected flag for a new recording session
pub fn reset_speech_detected_flag() {
    SPEECH_DETECTED_EMITTED.store(false, Ordering::SeqCst);
    info!(
        "🔍 SPEECH_DETECTED_EMITTED reset to: {}",
        SPEECH_DETECTED_EMITTED.load(Ordering::SeqCst)
    );
}

/// Returns true if the transcript text is non-trivial and should be emitted.
/// Filters empty/whitespace-only text; no confidence gating is applied.
fn should_emit_transcript(text: &str) -> bool {
    !text.trim().is_empty()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptUpdate {
    pub raw_engine_output: String,
    #[serde(default)]
    pub raw_engine_output_status: super::RawEngineOutputStatus,
    pub text: String,
    pub timestamp: String, // Wall-clock time for reference (e.g., "14:30:05")
    pub source: String,
    pub sequence_id: u64,
    pub chunk_start_time: f64, // Legacy field, kept for compatibility
    pub is_partial: bool,
    pub confidence: Option<f32>,
    pub score: TranscriptScore,
    pub spans: Vec<TranscriptSpan>,
    #[serde(default)]
    pub result_committed: bool,
    // NEW: Recording-relative timestamps for playback sync
    pub audio_start_time: f64, // Seconds from recording start (e.g., 125.3)
    pub audio_end_time: f64,   // Seconds from recording start (e.g., 128.6)
    pub duration: f64,         // Segment duration in seconds (e.g., 3.3)
}

// NOTE: get_transcript_history and get_recording_meeting_name functions
// have been moved to recording_commands.rs where they have access to RECORDING_MANAGER

pub fn start_transcription_task<R: Runtime>(
    app: AppHandle<R>,
    transcription_receiver: super::queue::DiskQueueReceiver,
) -> tokio::task::JoinHandle<()> {
    let cancellation = crate::audio::recording_cancellation::current();
    let workers = crate::audio::recording_cancellation::workers();
    tokio::spawn(async move {
        info!("🚀 Starting disk-backed transcription task");

        // Initialize transcription engine (Whisper or Parakeet based on config)
        let transcription_engine = match super::engine::get_or_init_transcription_engine(&app).await
        {
            Ok(engine) => engine,
            Err(e) => {
                error!("Failed to initialize transcription engine: {}", e);
                let _ = app.emit("transcription-error", serde_json::json!({
                    "error": e,
                    "userMessage": "Recording failed: Unable to initialize speech recognition. Please check your model settings.",
                    "actionable": true,
                    "phase": "active"
                }));
                return;
            }
        };

        if cancellation.is_cancelled() { return; }

        // Create parallel workers for faster processing while preserving ALL chunks
        const NUM_WORKERS: usize = 1; // Serial processing ensures transcripts emit in chronological order
        let (work_sender, work_receiver) =
            tokio::sync::mpsc::channel::<super::queue::DiskQueueItem>(1);
        let work_receiver = Arc::new(tokio::sync::Mutex::new(work_receiver));

        let accounting = Arc::new(TranscriptionAccounting::default());

        info!(
            "📊 Starting {} transcription worker{} (serial mode for ordered emission)",
            NUM_WORKERS,
            if NUM_WORKERS == 1 { "" } else { "s" }
        );

        // Spawn worker tasks
        let mut worker_handles = tokio::task::JoinSet::new();
        for worker_id in 0..NUM_WORKERS {
            let engine_clone = match &transcription_engine {
                TranscriptionEngine::Whisper(e) => TranscriptionEngine::Whisper(e.clone()),
                TranscriptionEngine::Parakeet(e) => TranscriptionEngine::Parakeet(e.clone()),
                TranscriptionEngine::Provider(p) => TranscriptionEngine::Provider(p.clone()),
            };
            let app_clone = app.clone();
            let work_receiver_clone = work_receiver.clone();
            let accounting_clone = accounting.clone();
            let worker_cancellation = cancellation.clone();

            worker_handles.spawn(workers.track_future(async move {
                info!("👷 Worker {} started", worker_id);

                // PRE-VALIDATE model state to avoid repeated async calls per chunk
                let initial_model_loaded = engine_clone.is_model_loaded().await;
                let current_model = engine_clone
                    .get_current_model()
                    .await
                    .unwrap_or_else(|| "unknown".to_string());

                let engine_name = engine_clone.provider_name();

                if initial_model_loaded {
                    info!(
                        "✅ Worker {} pre-validation: {} model '{}' is loaded and ready",
                        worker_id, engine_name, current_model
                    );
                } else {
                    warn!(
                        "⚠️ Worker {} pre-validation: {} model not loaded - chunks may be skipped",
                        worker_id, engine_name
                    );
                }

                loop {
                    if worker_cancellation.is_cancelled() { break; }
                    // Try to get a chunk to process
                    let chunk = {
                        let mut receiver = work_receiver_clone.lock().await;
                        receiver.recv().await
                    };

                    match chunk {
                        Some(mut queue_item) => {
                            let chunk = queue_item.take_chunk();
                            let chunk_id = chunk.chunk_id;
                            accounting_clone.start();
                            let should_log_this_chunk = chunk.chunk_id % 10 == 0;
                            if should_log_this_chunk {
                                info!(
                                    "👷 Worker {} processing chunk {} with {} samples",
                                    worker_id,
                                    chunk.chunk_id,
                                    chunk.data.len()
                                );
                            }
                            if !engine_clone.is_model_loaded().await {
                                warn!(
                                    "Worker {} deferred chunk {} because the model is not loaded",
                                    worker_id, chunk_id
                                );
                                if let Err(error) = queue_item.retain("deferred").await {
                                    error!(
                                        "Worker {} could not retain deferred chunk {}: {}",
                                        worker_id, chunk_id, error
                                    );
                                }
                                accounting_clone.finish(ChunkStatus::Deferred, false);
                                continue;
                            }
                            let chunk_timestamp = chunk.timestamp;
                            let chunk_duration = chunk.data.len() as f64 / chunk.sample_rate as f64;
                            let result = transcribe_chunk_with_cancellation(
                                &engine_clone,
                                chunk,
                                &app_clone,
                                Some(worker_cancellation.clone()),
                            )
                            .await;
                            if worker_cancellation.is_cancelled() {
                                if let Err(error) = queue_item.retain("cancelled").await {
                                    warn!("Could not retain cancelled chunk: {error}");
                                }
                                accounting_clone.finish(ChunkStatus::Cancelled, false);
                                break;
                            }
                            let (mut status, committed) = match result {
                                Ok(result) if !should_emit_transcript(&result.text) => {
                                    (ChunkStatus::NoSpeech, false)
                                }
                                Ok(result) => {
                                    if !SPEECH_DETECTED_EMITTED.swap(true, Ordering::SeqCst) {
                                        let _ = app_clone.emit(
                                            "speech-detected",
                                            serde_json::json!({
                                                "message": "Speech activity detected"
                                            }),
                                        );
                                    }
                                    let mut update = TranscriptUpdate {
                                        raw_engine_output: result.raw_text,
                                        raw_engine_output_status:
                                            super::RawEngineOutputStatus::Captured,
                                        text: result.text,
                                        timestamp: format_current_timestamp(),
                                        source: "Audio".to_string(),
                                        sequence_id: SEQUENCE_COUNTER
                                            .fetch_add(1, Ordering::SeqCst),
                                        chunk_start_time: chunk_timestamp,
                                        is_partial: result.is_partial,
                                        confidence: None,
                                        score: result.score,
                                        spans: result.spans,
                                        result_committed: false,
                                        audio_start_time: chunk_timestamp,
                                        audio_end_time: chunk_timestamp + chunk_duration,
                                        duration: chunk_duration,
                                    };
                                    let persisted = match queue_item.save_result(&update).await {
                                        Ok(()) => crate::audio::recording_commands::commit_transcript_update(&update),
                                        Err(error) => Err(error.to_string()),
                                    };
                                    match persisted {
                                        Ok(()) => {
                                            update.result_committed = true;
                                            if let Err(error) =
                                                app_clone.emit("transcript-update", &update)
                                            {
                                                warn!("Worker {} could not emit committed chunk {}: {}", worker_id, chunk_id, error);
                                            }
                                            (ChunkStatus::Succeeded, true)
                                        }
                                        Err(error) => {
                                            error!(
                                                "Worker {} could not commit chunk {}: {}",
                                                worker_id, chunk_id, error
                                            );
                                            let _ = app_clone.emit("transcription-error", serde_json::json!({
                                                "error": "transcript_commit_failed",
                                                "userMessage": "Transcription was produced but could not be saved.",
                                                "actionable": true,
                                                "phase": "saving",
                                                "chunk_id": chunk_id
                                            }));
                                            (ChunkStatus::Failed, false)
                                        }
                                    }
                                }
                                Err(error) => match error {
                                    TranscriptionError::AudioTooShort { .. } => {
                                        (ChunkStatus::NoSpeech, false)
                                    }
                                    TranscriptionError::ModelNotLoaded => {
                                        (ChunkStatus::Deferred, false)
                                    }
                                    _ => {
                                        warn!(
                                            "Worker {} failed chunk {}: {}",
                                            worker_id, chunk_id, error
                                        );
                                        let _ = app_clone
                                            .emit("transcription-warning", error.to_string());
                                        (ChunkStatus::Failed, false)
                                    }
                                },
                            };
                            let queue_result = match status {
                                ChunkStatus::Succeeded | ChunkStatus::NoSpeech => {
                                    queue_item.commit().await.map(|_| None)
                                }
                                ChunkStatus::Failed => {
                                    queue_item.retain("failed").await.map(|path| Some(path))
                                }
                                ChunkStatus::Cancelled => {
                                    queue_item.retain("cancelled").await.map(|path| Some(path))
                                }
                                ChunkStatus::Deferred => {
                                    queue_item.retain("deferred").await.map(|path| Some(path))
                                }
                            };
                            match queue_result {
                                Ok(Some(path)) => warn!(
                                    "Worker {} retained chunk {} for recovery at {}",
                                    worker_id,
                                    chunk_id,
                                    path.display()
                                ),
                                Ok(None) => {}
                                Err(error) => {
                                    error!(
                                        "Worker {} could not finalize disk queue item {}: {}",
                                        worker_id, chunk_id, error
                                    );
                                    status = ChunkStatus::Failed;
                                }
                            }
                            accounting_clone.finish(status, committed);
                            let counts = accounting_clone.snapshot();
                            let terminal = counts.terminal();
                            if terminal % 5 == 0 || should_log_this_chunk {
                                info!(
                                    "Worker {}: terminal chunks {}/{}; succeeded={}, no_speech={}, failed={}, deferred={}",
                                    worker_id,
                                    terminal,
                                    counts.total,
                                    counts.succeeded,
                                    counts.no_speech,
                                    counts.failed,
                                    counts.deferred
                                );
                            }
                            let progress_percentage = if counts.total > 0 {
                                (terminal as f64 / counts.total as f64 * 100.0) as u32
                            } else {
                                100
                            };
                            let _ = app_clone.emit("transcription-progress", serde_json::json!({
                                "worker_id": worker_id,
                                "chunks_completed": terminal,
                                "chunks_queued": counts.total,
                                "progress_percentage": progress_percentage,
                                "counts": counts,
                                "message": format!("Worker {} processing... ({}/{})", worker_id, terminal, counts.total)
                            }));
                        }
                        None => break,
                    }
                }

                info!("👷 Worker {} completed", worker_id);
            }));

        }

        let mut receiver = transcription_receiver;
        loop {
            match receiver.recv().await {
                Ok(Some(queue_item)) => {
                    let chunk_id = queue_item.chunk_id();
                    accounting.queue();
                    let queued = accounting.snapshot().total;
                    info!(
                        "📥 Dispatching disk-backed chunk {} to workers (total queued: {})",
                        chunk_id, queued
                    );
                    if let Err(error) = work_sender.send(queue_item).await {
                        accounting.start();
                        accounting.finish(ChunkStatus::Deferred, false);
                        let item = error.0;
                        if let Err(retain_error) = item.retain("deferred").await {
                            error!(
                                "Failed to retain undispatched chunk {}: {}",
                                chunk_id, retain_error
                            );
                        }
                        error!("Failed to dispatch transcription chunk {}", chunk_id);
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    error!(
                        "Failed to read the disk-backed transcription queue: {}",
                        error
                    );
                    let _ = app.emit("transcription-error", serde_json::json!({
                        "error": "transcription_queue_read_failed",
                        "userMessage": "A saved transcription chunk could not be read. The original audio remains available for recovery.",
                        "actionable": true,
                        "phase": "queue"
                    }));
                    break;
                }
            }
        }

        drop(work_sender);

        let total_chunks_queued = accounting.snapshot().total;
        info!("📭 Input finished with {} total chunks queued. Waiting for all {} workers to complete...",
              total_chunks_queued, NUM_WORKERS);

        // Emit final chunk count to frontend
        let _ = app.emit("transcription-queue-complete", serde_json::json!({
            "total_chunks": total_chunks_queued,
            "message": format!("{} chunks queued for processing - waiting for completion", total_chunks_queued)
        }));

        while let Some(result) = worker_handles.join_next().await {
            if let Err(error) = result { error!("Transcription worker failed: {error}"); }
        }

        let counts = accounting.snapshot();
        let outcome = counts.completion_state();
        if outcome == "complete" {
            info!(
                "Transcription completed with {} explained chunks",
                counts.total
            );
        } else {
            warn!("Transcription ended as {}: {:?}", outcome, counts);
            let _ = app.emit(
                "transcript-chunk-issues-detected",
                serde_json::json!({
                    "outcome": outcome,
                    "counts": counts,
                    "message": "Some audio chunks require review or retry"
                }),
            );
        }
        let _ = app.emit(
            "transcription-complete",
            serde_json::json!({
                "outcome": outcome,
                "counts": counts
            }),
        );
    })
}

pub(super) async fn transcribe_chunk_with_provider<R: Runtime>(
    engine: &TranscriptionEngine,
    chunk: AudioChunk,
    app: &AppHandle<R>,
) -> std::result::Result<TranscriptResult, TranscriptionError> {
    transcribe_chunk_with_cancellation(engine, chunk, app, None).await
}

async fn transcribe_chunk_with_cancellation<R: Runtime>(
    engine: &TranscriptionEngine,
    chunk: AudioChunk,
    app: &AppHandle<R>,
    cancellation: Option<tokio_util::sync::CancellationToken>,
) -> std::result::Result<TranscriptResult, TranscriptionError> {
    let chunk_id = chunk.chunk_id;
    // Convert to 16kHz mono for transcription
    let transcription_data = if chunk.sample_rate != 16000 {
        crate::audio::audio_processing::resample_audio(&chunk.data, chunk.sample_rate, 16000)
    } else {
        chunk.data
    };

    // Skip VAD processing here since the pipeline already extracted speech using VAD
    let speech_samples = transcription_data;

    // Check for empty samples - improved error handling
    if speech_samples.is_empty() {
        warn!(
            "Audio chunk {} is empty, skipping transcription",
            chunk.chunk_id
        );
        return Err(TranscriptionError::AudioTooShort {
            samples: 0,
            minimum: 1600, // 100ms at 16kHz
        });
    }

    // Calculate energy for logging/monitoring only
    let energy: f32 =
        speech_samples.iter().map(|&x| x * x).sum::<f32>() / speech_samples.len() as f32;
    info!(
        "Processing speech audio chunk {} with {} samples (energy: {:.6})",
        chunk.chunk_id,
        speech_samples.len(),
        energy
    );

    match engine {
        TranscriptionEngine::Whisper(whisper_engine) => {
            let language = crate::get_language_preference_internal();
            match whisper_engine
                .transcribe_audio_with_prompt_cancellable(speech_samples, language, None, cancellation)
                .await
            {
                Ok(result) => {
                    info!(
                        "Whisper completed chunk {} with {} spans and score kind {:?}",
                        chunk_id,
                        result.spans.len(),
                        result.score.kind
                    );
                    Ok(result)
                }
                Err(e) => {
                    error!("Whisper transcription failed for chunk {}: {}", chunk_id, e);

                    let transcription_error = TranscriptionError::EngineFailed(e.to_string());
                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": transcription_error.to_string(),
                            "userMessage": format!("Transcription failed: {}", transcription_error),
                            "actionable": false,
                            "phase": "active"
                        }),
                    );

                    Err(transcription_error)
                }
            }
        }
        TranscriptionEngine::Parakeet(parakeet_engine) => {
            let input_samples = speech_samples.len() as u64;
            match parakeet_engine.transcribe_audio(speech_samples).await {
                Ok(raw_text) => {
                    let text = raw_text.trim().to_string();
                    let spans = if text.is_empty() {
                        Vec::new()
                    } else {
                        vec![TranscriptSpan {
                            text: text.clone(),
                            start_sample: 0,
                            end_sample: input_samples,
                            timebase_hz: 16_000,
                        }]
                    };
                    info!(
                        "Parakeet completed chunk {} with {} spans",
                        chunk_id,
                        spans.len()
                    );
                    Ok(TranscriptResult {
                        raw_text,
                        text,
                        score: TranscriptScore::unavailable("parakeet"),
                        is_partial: false,
                        spans,
                    })
                }
                Err(e) => {
                    error!(
                        "Parakeet transcription failed for chunk {}: {}",
                        chunk_id, e
                    );

                    let transcription_error = TranscriptionError::EngineFailed(e.to_string());
                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": transcription_error.to_string(),
                            "userMessage": format!("Transcription failed: {}", transcription_error),
                            "actionable": false,
                            "phase": "active"
                        }),
                    );

                    Err(transcription_error)
                }
            }
        }
        TranscriptionEngine::Provider(provider) => {
            let language = crate::get_language_preference_internal();
            match provider
                .transcribe(speech_samples, language)
                .await
            {
                Ok(result) => {
                    info!(
                        "{} completed chunk {} with {} spans and score kind {:?}",
                        provider.provider_name(),
                        chunk_id,
                        result.spans.len(),
                        result.score.kind
                    );
                    Ok(result)
                }
                Err(e) => {
                    error!(
                        "{} transcription failed for chunk {}: {}",
                        provider.provider_name(),
                        chunk_id,
                        e
                    );

                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": e.to_string(),
                            "userMessage": format!("Transcription failed: {}", e),
                            "actionable": false,
                            "phase": "active"
                        }),
                    );

                    Err(e)
                }
            }
        }
    }
}

/// Format current timestamp (wall-clock time)
fn format_current_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();

    let hours = (now.as_secs() / 3600) % 24;
    let minutes = (now.as_secs() / 60) % 60;
    let seconds = now.as_secs() % 60;

    format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
}

/// Format recording-relative time as [MM:SS]
#[allow(dead_code)]
fn format_recording_time(seconds: f64) -> String {
    let total_seconds = seconds.floor() as u64;
    let minutes = total_seconds / 60;
    let secs = total_seconds % 60;

    format!("[{:02}:{:02}]", minutes, secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_short_acknowledgements() {
        assert!(should_emit_transcript("Yes"));
        assert!(should_emit_transcript("ok"));
    }

    #[test]
    fn drops_empty_and_whitespace_only() {
        assert!(!should_emit_transcript(""));
        assert!(!should_emit_transcript("   "));
    }
}

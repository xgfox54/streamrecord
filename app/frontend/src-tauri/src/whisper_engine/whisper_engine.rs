// Commit name to recover the serial whisper engine processing for smaller meetings [Slower processing but dooes not fail] - "before parallel processing implementation"

use super::acceleration::{whisper_context_acceleration_for, WhisperCompiledBackend};
use crate::audio::transcription::{TranscriptResult, TranscriptScore, TranscriptSpan};
use crate::config::WHISPER_MODEL_CATALOG;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use crate::review_paths::async_fs as fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::{watch, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading {
        progress: u8,
    },
    Error(String),
    Corrupted {
        file_size: u64,
        expected_min_size: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub accuracy: String,
    pub speed: String,
    pub status: ModelStatus,
    pub description: String,
}

struct ActiveDownload {
    cancellation: CancellationToken,
    completion: watch::Sender<bool>,
}

#[cfg(test)]
struct DownloadStateTestHook {
    cancellation_first_lock_acquired: tokio::sync::Notify,
    continue_cancellation: tokio::sync::Notify,
    discovery_active_lock_acquired: tokio::sync::Notify,
    continue_discovery: tokio::sync::Notify,
}

#[derive(Debug, thiserror::Error)]
#[error("Download cancelled by user")]
pub(crate) struct DownloadCancelled;

pub(crate) fn is_download_cancelled(error: &anyhow::Error) -> bool {
    error.downcast_ref::<DownloadCancelled>().is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CancelDownloadOutcome {
    Cancelled,
    Pending,
}

const CANCEL_DOWNLOAD_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

pub struct WhisperEngine {
    models_dir: PathBuf,
    current_context: Arc<RwLock<Option<WhisperContext>>>,
    current_model: Arc<RwLock<Option<String>>>,
    available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    // State tracking for smart logging
    last_transcription_was_short: Arc<RwLock<bool>>,
    short_audio_warning_logged: Arc<RwLock<bool>>,
    // Performance optimization: reduce logging frequency
    transcription_count: Arc<RwLock<u64>>,
    // A model remains active until its owning worker has completed cleanup.
    active_downloads: Arc<Mutex<HashMap<String, Arc<ActiveDownload>>>>,
    #[cfg(test)]
    download_state_test_hook: std::sync::Mutex<Option<Arc<DownloadStateTestHook>>>,
}

impl WhisperEngine {
    /// Detect available GPU acceleration capabilities
    fn detect_gpu_acceleration() -> bool {
        match WhisperCompiledBackend::current() {
            WhisperCompiledBackend::Metal => {
                log::info!("macOS detected - attempting to enable Metal GPU acceleration");
                true
            }
            WhisperCompiledBackend::Cuda => {
                log::info!("CUDA feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::Vulkan => {
                log::info!("Vulkan feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::HipBlas => {
                log::info!("HIP BLAS feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::Cpu => {
                log::info!("No GPU acceleration features detected - using CPU processing");
                false
            }
        }
    }

    pub fn new() -> Result<Self> {
        Self::new_with_models_dir(None)
    }

    /// Create a new WhisperEngine with optional custom models directory
    /// If models_dir is None, uses default location (app data dir for production, local for dev)
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        let models_dir = crate::review_paths::model_directory(models_dir, "whisper")?;
        // PERFORMANCE: Suppress verbose whisper.cpp and Metal logs
        // These C library logs bypass Rust logging and clutter output
        // Set environment variables to reduce C library verbosity
        std::env::set_var("GGML_METAL_LOG_LEVEL", "1"); // 0=off, 1=error, 2=warn, 3=info
        std::env::set_var("WHISPER_LOG_LEVEL", "1"); // Reduce whisper.cpp verbosity

        let models_dir = if let Some(dir) = models_dir {
            // Use provided directory (for production with app_data_dir)
            dir
        } else {
            // Fallback: determine based on debug/release mode
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            // Development: Use frontend/models or backend directories
            // Production: Use system directories (should be overridden by caller)
            if cfg!(debug_assertions) {
                // Development mode - try frontend and backend directories
                if current_dir.join("models").exists() {
                    current_dir.join("models")
                } else if current_dir.join("../models").exists() {
                    current_dir.join("../models")
                } else if current_dir
                    .join("backend/whisper-server-package/models")
                    .exists()
                {
                    current_dir.join("backend/whisper-server-package/models")
                } else if current_dir
                    .join("../backend/whisper-server-package/models")
                    .exists()
                {
                    current_dir.join("../backend/whisper-server-package/models")
                } else {
                    // Create models directory in current directory for development
                    current_dir.join("models")
                }
            } else {
                // Production mode fallback (shouldn't reach here, caller should provide path)
                log::warn!("WhisperEngine: No models directory provided, using fallback path");
                crate::review_paths::data_dir()
                    .or_else(|| crate::review_paths::home_dir())
                    .ok_or_else(|| anyhow!("Could not find system data directory"))?
                    .join("Meetily")
                    .join("models")
            }
        };

        log::info!(
            "WhisperEngine using models directory: {}",
            models_dir.display()
        );
        log::info!("Debug mode: {}", cfg!(debug_assertions));

        // Log acceleration capabilities
        let gpu_support = Self::detect_gpu_acceleration();
        log::info!(
            "Hardware acceleration support: {}",
            if gpu_support { "enabled" } else { "disabled" }
        );

        #[cfg(feature = "metal")]
        log::info!("Apple Metal GPU support: enabled");

        #[cfg(feature = "openblas")]
        log::info!("OpenBLAS CPU optimization: enabled");

        #[cfg(feature = "coreml")]
        log::info!("Apple CoreML support: enabled");

        #[cfg(feature = "cuda")]
        log::info!("NVIDIA CUDA support: enabled");

        #[cfg(feature = "vulkan")]
        log::info!("Vulkan GPU support: enabled");

        #[cfg(feature = "openmp")]
        log::info!("OpenMP parallel processing: enabled");

        let engine = Self {
            models_dir,
            current_context: Arc::new(RwLock::new(None)),
            current_model: Arc::new(RwLock::new(None)),
            available_models: Arc::new(RwLock::new(HashMap::new())),
            // Initialize state tracking
            last_transcription_was_short: Arc::new(RwLock::new(false)),
            short_audio_warning_logged: Arc::new(RwLock::new(false)),
            // Performance optimization: reduce logging frequency
            transcription_count: Arc::new(RwLock::new(0)),
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
            #[cfg(test)]
            download_state_test_hook: std::sync::Mutex::new(None),
        };

        Ok(engine)
    }

    #[cfg(test)]
    fn test_hook(&self) -> Option<Arc<DownloadStateTestHook>> {
        self.download_state_test_hook
            .lock()
            .expect("download state test hook mutex should not be poisoned")
            .clone()
    }

    pub async fn discover_models(&self) -> Result<Vec<ModelInfo>> {
        let models_dir = &self.models_dir;
        let mut models = Vec::new();
        // Use centralized model catalog from config.rs
        let model_configs = WHISPER_MODEL_CATALOG;

        for &(name, filename, size_mb, accuracy, speed, description) in model_configs {
            let model_path = models_dir.join(filename);
            let status = if model_path.exists() {
                // Check if file size is reasonable (at least 1MB for a valid model)
                match crate::review_paths::fs::metadata(&model_path) {
                    Ok(metadata) => {
                        let file_size_bytes = metadata.len();
                        let file_size_mb = file_size_bytes / (1024 * 1024);
                        let expected_min_size_mb = (size_mb as f64 * 0.9) as u64; // Allow 90% of expected size as minimum for more accurate corruption detection

                        if file_size_mb >= expected_min_size_mb && file_size_mb > 1 {
                            // File size looks good, but let's also check if it's a valid GGML file
                            match self.validate_model_file(&model_path).await {
                                Ok(_) => ModelStatus::Available,
                                Err(_) => {
                                    log::warn!("Model file {} has correct size but appears corrupted (failed validation)",
                                             filename);
                                    ModelStatus::Corrupted {
                                        file_size: file_size_bytes,
                                        expected_min_size: (expected_min_size_mb * 1024 * 1024)
                                            as u64,
                                    }
                                }
                            }
                        } else if file_size_mb > 0 {
                            log::warn!(
                                "Model file {} exists but is corrupted ({} MB, expected ~{} MB)",
                                filename,
                                file_size_mb,
                                size_mb
                            );
                            ModelStatus::Corrupted {
                                file_size: file_size_bytes,
                                expected_min_size: (expected_min_size_mb * 1024 * 1024) as u64,
                            }
                        } else {
                            ModelStatus::Missing
                        }
                    }
                    Err(_) => ModelStatus::Missing,
                }
            } else {
                ModelStatus::Missing
            };

            let model_info = ModelInfo {
                name: name.to_string(),
                path: model_path,
                size_mb: size_mb as u32,
                accuracy: accuracy.to_string(),
                speed: speed.to_string(),
                status,
                description: description.to_string(),
            };

            models.push(model_info);
        }

        let active_downloads = self.active_downloads.lock().await;
        #[cfg(test)]
        if let Some(hook) = self.test_hook() {
            hook.discovery_active_lock_acquired.notify_one();
            hook.continue_discovery.notified().await;
        }
        let mut available_models = self.available_models.write().await;
        for model in &mut models {
            if active_downloads.contains_key(&model.name) {
                let progress = available_models
                    .get(&model.name)
                    .and_then(|cached| match cached.status {
                        ModelStatus::Downloading { progress } => Some(progress),
                        _ => None,
                    })
                    .unwrap_or(0);
                model.status = ModelStatus::Downloading { progress };
            }
        }
        available_models.clear();
        for model in &models {
            available_models.insert(model.name.clone(), model.clone());
        }

        Ok(models)
    }

    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let models = self.available_models.read().await;
        let model_info = models
            .get(model_name)
            .cloned()
            .ok_or_else(|| anyhow!("Model {} not found", model_name))?;
        drop(models);

        match model_info.status {
            ModelStatus::Available => {
                // FIX 5: Check if this model is already loaded
                let current_model = self.current_model.read().await.clone();
                if let Some(ref current_model) = current_model {
                    if current_model == model_name {
                        log::info!("Model {} is already loaded, skipping reload", model_name);
                        return Ok(());
                    }

                    // FIX 5: Unload current model before loading new one
                    log::info!(
                        "Unloading current model '{}' before loading '{}'",
                        current_model,
                        model_name
                    );
                }

                // Verify before entering native code or unloading a working model.
                super::model_integrity::verify_file(model_name, &model_info.path).await?;
                if current_model.is_some() {
                    self.unload_model().await;
                }
                log::info!("Loading model: {}", model_name);

                // PERFORMANCE OPTIMIZATION: Use comprehensive hardware profile for optimal GPU configuration
                let hardware_profile = crate::audio::HardwareProfile::detect();
                let adaptive_config = hardware_profile.get_whisper_config();
                let acceleration = whisper_context_acceleration_for(
                    WhisperCompiledBackend::current(),
                    hardware_profile.gpu_type,
                    hardware_profile.performance_tier,
                );

                if matches!(acceleration.compiled_backend, WhisperCompiledBackend::Cuda)
                    && !matches!(
                        acceleration.runtime_detected_gpu,
                        crate::audio::GpuType::Cuda
                    )
                {
                    return Err(anyhow!(
                        "CUDA build requires a working NVIDIA CUDA device; CPU fallback is disabled"
                    ));
                }

                let context_param = WhisperContextParameters {
                    use_gpu: acceleration.use_gpu,
                    gpu_device: acceleration.gpu_device,
                    flash_attn: acceleration.flash_attn,
                    ..Default::default()
                };

                log::info!(
                    "Whisper acceleration decision: compiled_backend={} runtime_detected_gpu={:?} use_gpu={} flash_attn={} gpu_device={}",
                    acceleration.compiled_backend.as_str(),
                    acceleration.runtime_detected_gpu,
                    acceleration.use_gpu,
                    acceleration.flash_attn,
                    acceleration.gpu_device,
                );
                log::info!(
                    "Whisper native system info: {}",
                    whisper_rs::print_system_info()
                );

                // PERFORMANCE: Suppress verbose C library logs during model loading
                // This hides the excessive Metal/GGML initialization logs in release builds
                let ctx = {
                    // let _suppressor = crate::whisper_engine::StderrSuppressor::new();

                    // Load whisper context with hardware-optimized parameters
                    WhisperContext::new_with_params(
                        &model_info.path.to_string_lossy(),
                        context_param,
                    )
                    .map_err(|e| anyhow!("Failed to load model {}: {}", model_name, e))?
                    // Suppressor dropped here, stderr restored
                };

                // Update current context and model
                *self.current_context.write().await = Some(ctx);
                *self.current_model.write().await = Some(model_name.to_string());

                // Enhanced acceleration status reporting
                let acceleration_status = acceleration.status_label();

                log::info!("Successfully loaded model: {} with {} (Performance Tier: {:?}, Beam Size: {}, Threads: {:?})",
                          model_name, acceleration_status, hardware_profile.performance_tier,
                          adaptive_config.beam_size, adaptive_config.max_threads);
                Ok(())
            }
            ModelStatus::Missing => Err(anyhow!("Model {} is not downloaded", model_name)),
            ModelStatus::Downloading { .. } => {
                Err(anyhow!("Model {} is currently downloading", model_name))
            }
            ModelStatus::Error(ref err) => Err(anyhow!("Model {} has error: {}", model_name, err)),
            ModelStatus::Corrupted { .. } => Err(anyhow!(
                "Model {} is corrupted and cannot be loaded",
                model_name
            )),
        }
    }

    pub async fn unload_model(&self) -> bool {
        let mut ctx_guard = self.current_context.write().await;
        let unloaded = ctx_guard.take().is_some();
        if unloaded {
            log::info!("📉Whisper model unloaded");
        }

        let mut model_name_guard = self.current_model.write().await;
        model_name_guard.take();

        unloaded
    }

    pub async fn get_current_model(&self) -> Option<String> {
        self.current_model.read().await.clone()
    }

    pub async fn is_model_loaded(&self) -> bool {
        self.current_context.read().await.is_some()
    }

    /// Transcribe audio with streaming support for partial results and adaptive quality
    pub async fn transcribe_audio_with_result(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult> {
        self.transcribe_audio_with_prompt(audio_data, language, None)
            .await
    }

    /// Decode one complete audio window. The prompt is an explicit hint, not
    /// global decoder history; callers own its meeting and sequence boundaries.
    pub async fn transcribe_audio_with_prompt(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
        prompt: Option<String>,
    ) -> Result<TranscriptResult> {
        let ctx_lock = self.current_context.read().await;
        let ctx = ctx_lock
            .as_ref()
            .ok_or_else(|| anyhow!("No model loaded. Please load a model first."))?;

        // Get adaptive configuration based on hardware
        let hardware_profile = crate::audio::HardwareProfile::detect();
        let adaptive_config = hardware_profile.get_whisper_config();

        // ADAPTIVE parameters - optimized for current hardware
        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: adaptive_config.beam_size as i32,
            patience: 1.0,
        });

        // Configure with adaptive settings
        // If language is "auto" or None, use automatic language detection (pass None)
        // If language is "auto-translate", enable translation to English
        // Otherwise, use the specified language code
        let (language_code, should_translate) = match language.as_deref() {
            Some("auto") | None => (None, false),
            Some("auto-translate") => (None, true),
            Some(lang) => (Some(lang), false),
        };
        params.set_language(language_code);
        params.set_translate(should_translate);

        let prompt = prompt.map(|p| {
            p.chars()
                .filter(|c| !c.is_control())
                .take(600)
                .collect::<String>()
        });
        if let Some(ref text) = prompt {
            if !text.is_empty() {
                params.set_initial_prompt(text);
            }
        }

        // CRITICAL: Disable timestamp tokens to prevent whisper.cpp chunking heuristics
        // The "single timestamp ending - skip entire chunk" optimization incorrectly discards
        // complete, valid transcriptions. Disabling timestamps forces whisper to return ALL text.
        params.set_no_timestamps(true); // Prevent timestamp-based segment skipping
        params.set_token_timestamps(true); // Keep for any timestamp-aware features

        // PERFORMANCE: Disable ALL whisper.cpp internal printing
        // This reduces C library log spam significantly
        params.set_print_special(false); // Don't print special tokens
        params.set_print_progress(false); // Don't print progress
        params.set_print_realtime(false); // Don't print realtime info
        params.set_print_timestamps(false); // Don't print timestamps

        // Additional suppression to reduce C library verbosity
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);
        params.set_temperature(adaptive_config.temperature);
        params.set_max_initial_ts(1.0);
        params.set_entropy_thold(2.4);
        params.set_logprob_thold(-1.0);
        // BALANCED FIX: Lowered from 0.75 to 0.55 to allow quiet speech detection
        // Previous value was too aggressive and rejected valid quiet speech
        // 0.55 is balanced - prevents hallucinations while preserving quiet speech
        params.set_no_speech_thold(0.55);
        params.set_max_len(200);
        params.set_split_on_word(true);
        params.set_single_segment(false);

        // Set thread count based on hardware (if supported by whisper.cpp)
        if let Some(_max_threads) = adaptive_config.max_threads {
            // Note: whisper.cpp may or may not expose thread control through params
            // Removed debug log to reduce I/O overhead in transcription hot path
        }

        // full() decodes the entire supplied window. Short windows are final
        // too; marking <15s as partial stranded every bounded live segment.
        let is_partial = false;

        // PERFORMANCE: Suppress verbose C library logs during transcription
        // This hides whisper_full_with_state debug logs and beam search details
        let (num_segments, state) = {
            // let _suppressor = crate::whisper_engine::StderrSuppressor::new();

            let mut state = ctx.create_state()?;
            state.full(params, &audio_data)?;
            let num_segments = state.full_n_segments();

            (num_segments, state)
            // Suppressor dropped here, stderr restored
        };
        let input_samples = audio_data.len() as u64;
        let mut raw_text = String::new();
        let mut display_text = String::new();
        let mut spans = Vec::new();
        let mut token_probability_sum = 0.0f64;
        let mut token_probability_count = 0u64;

        let num_segments = num_segments?;
        for i in 0..num_segments {
            let segment_text = match state.full_get_segment_text_lossy(i) {
                Ok(text) => text,
                Err(_) => continue,
            };

            raw_text.push_str(&segment_text);
            let normalized_segment = segment_text.trim();
            if !normalized_segment.is_empty() {
                if !display_text.is_empty() {
                    display_text.push(' ');
                }
                display_text.push_str(normalized_segment);

                let start_centiseconds = state.full_get_segment_t0(i).unwrap_or(0).max(0) as u64;
                let end_centiseconds = state.full_get_segment_t1(i).unwrap_or(0).max(0) as u64;
                let start_sample = start_centiseconds.saturating_mul(160).min(input_samples);
                let end_sample = end_centiseconds
                    .saturating_mul(160)
                    .min(input_samples)
                    .max(start_sample);
                spans.push(TranscriptSpan {
                    text: normalized_segment.to_string(),
                    start_sample,
                    end_sample,
                    timebase_hz: 16_000,
                });
            }

            let token_count = state.full_n_tokens(i).unwrap_or(0).max(0);
            for token_index in 0..token_count {
                if let Ok(probability) = state.full_get_token_prob(i, token_index) {
                    if probability.is_finite() && (0.0..=1.0).contains(&probability) {
                        token_probability_sum += probability as f64;
                        token_probability_count += 1;
                    }
                }
            }
        }

        let mean_token_probability = (token_probability_count > 0)
            .then(|| (token_probability_sum / token_probability_count as f64) as f32);

        Ok(TranscriptResult {
            raw_text,
            text: display_text,
            score: TranscriptScore::mean_token_probability("whisper_cpp", mean_token_probability),
            is_partial,
            spans,
        })
    }

    pub async fn transcribe_audio(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
    ) -> Result<String> {
        let ctx_lock = self.current_context.read().await;
        let ctx = ctx_lock
            .as_ref()
            .ok_or_else(|| anyhow!("No model loaded. Please load a model first."))?;

        // Get adaptive configuration based on hardware
        let hardware_profile = crate::audio::HardwareProfile::detect();
        let adaptive_config = hardware_profile.get_whisper_config();

        // ADAPTIVE parameters - optimized for current hardware
        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: adaptive_config.beam_size as i32,
            patience: 1.0,
        });

        // Configure for good quality
        // If language is "auto" or None, use automatic language detection (pass None)
        // If language is "auto-translate", enable translation to English
        // Otherwise, use the specified language code
        let (language_code, should_translate) = match language.as_deref() {
            Some("auto") | None => (None, false),
            Some("auto-translate") => (None, true),
            Some(lang) => (Some(lang), false),
        };
        params.set_language(language_code);
        params.set_translate(should_translate);

        // CRITICAL: Disable timestamp tokens to prevent whisper.cpp chunking heuristics
        // The "single timestamp ending - skip entire chunk" optimization incorrectly discards
        // complete, valid transcriptions. Disabling timestamps forces whisper to return ALL text.
        params.set_no_timestamps(true); // Prevent timestamp-based segment skipping
        params.set_token_timestamps(true); // Keep for any timestamp-aware features

        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        // BALANCED settings - good quality with reasonable speed
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);
        params.set_temperature(0.3); // Lower than 0.4 for consistency, higher than 0.0 for quality
        params.set_max_initial_ts(1.0);
        params.set_entropy_thold(2.4);
        params.set_logprob_thold(-1.0);
        // BALANCED FIX: Lowered from 0.75 to 0.55 to allow quiet speech detection
        // Previous value was too aggressive and rejected valid quiet speech
        // 0.55 is balanced - prevents hallucinations while preserving quiet speech
        params.set_no_speech_thold(0.55);

        // Reasonable length limits
        params.set_max_len(200); // Reasonable length
        params.set_split_on_word(true);
        params.set_single_segment(false); // Allow multiple segments for better accuracy

        // Note: compression_ratio_threshold would be ideal but not available in current whisper-rs
        // This would help detect repetitive outputs: params.set_compression_ratio_threshold(2.4);

        // Duration-based optimization is handled by beam search parameters
        let duration_seconds = audio_data.len() as f64 / 16000.0; // Assuming 16kHz
        let is_short_audio = duration_seconds < 1.0;

        // Smart logging based on audio duration and previous states
        let mut should_log_transcription = true;
        let mut should_log_short_warning = false;

        if is_short_audio {
            let last_was_short = *self.last_transcription_was_short.read().await;
            let warning_logged = *self.short_audio_warning_logged.read().await;

            if !warning_logged {
                should_log_short_warning = true;
                *self.short_audio_warning_logged.write().await = true;
            }

            // Only log transcription start if it's the first short audio or previous wasn't short
            should_log_transcription = !last_was_short;

            *self.last_transcription_was_short.write().await = true;
        } else {
            let last_was_short = *self.last_transcription_was_short.read().await;

            // Always log when transitioning from short to normal audio
            if last_was_short {
                log::info!("Audio duration normalized, resuming transcription");
                *self.short_audio_warning_logged.write().await = false;
            }

            *self.last_transcription_was_short.write().await = false;
        }

        if should_log_short_warning {
            log::warn!("Audio duration is short ({:.1}s < 1.0s). Consider padding the input audio with silence. Further short audio warnings will be suppressed.", duration_seconds);
        }

        // Performance optimization: reduce transcription start logging frequency
        let transcription_count = {
            let mut count = self.transcription_count.write().await;
            *count += 1;
            *count
        };

        // Only log every 10th transcription or significant audio (>10s) to reduce I/O overhead
        if should_log_transcription && (transcription_count % 10 == 0 || duration_seconds > 10.0) {
            log::info!(
                "Starting transcription #{} of {} samples ({:.1}s duration)",
                transcription_count,
                audio_data.len(),
                duration_seconds
            );
        }
        let mut state = ctx.create_state()?;
        state.full(params, &audio_data)?;

        // Extract text with improved segment handling
        let num_segments = state.full_n_segments()?;

        // Performance optimization: reduce segment completion logging
        // Only log for significant transcriptions to avoid I/O overhead
        if (should_log_transcription || num_segments > 0)
            && (num_segments > 3 || duration_seconds > 5.0)
        {
            perf_debug!(
                "Transcription #{} completed with {} segments ({:.1}s)",
                transcription_count,
                num_segments,
                duration_seconds
            );
        }
        let mut result = String::new();

        for i in 0..num_segments {
            let segment_text = match state.full_get_segment_text_lossy(i) {
                Ok(text) => text,
                Err(_) => continue,
            };

            let _start_time = state.full_get_segment_t0(i).unwrap_or(0);
            let _end_time = state.full_get_segment_t1(i).unwrap_or(0);

            // Performance optimization: remove per-segment debug logging
            // This was causing significant I/O overhead during transcription
            // Only log segments for very long audio (>30s) or when explicitly debugging
            if duration_seconds > 30.0 {
                perf_trace!(
                    "Segment {} ({:.2}s-{:.2}s): '{}'",
                    i,
                    _start_time as f64 / 100.0,
                    _end_time as f64 / 100.0,
                    segment_text
                );
            }

            // Clean and append segment text
            let cleaned_text = segment_text.trim();
            if !cleaned_text.is_empty() {
                if !result.is_empty() {
                    result.push(' ');
                }
                result.push_str(cleaned_text);
            }
        }

        let final_result = result.trim().to_string();

        // Performance optimization: smart logging for transcription results
        if final_result.is_empty() {
            // Only log empty results occasionally to reduce spam
            if should_log_transcription && transcription_count % 20 == 0 {
                perf_debug!(
                    "Transcription #{} result is empty - no speech detected",
                    transcription_count
                );
            }
        } else {
            // Reduce successful transcription logging frequency
            // Only log every 5th result or significant results (>50 chars) to reduce I/O overhead
            if transcription_count % 5 == 0 || final_result.len() > 50 || duration_seconds > 10.0 {
                log::info!(
                    "Transcription #{} produced {} UTF-8 bytes",
                    transcription_count,
                    final_result.len()
                );
            } else {
                perf_debug!("Transcription #{} produced output", transcription_count);
            }
        }

        Ok(final_result)
    }

    pub async fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }

    /// Validate if a model file is a valid GGML file by checking its header
    async fn validate_model_file(&self, model_path: &PathBuf) -> Result<()> {
        use tokio::io::AsyncReadExt;

        let mut file = fs::open_file(model_path)
            .await
            .map_err(|e| anyhow!("Failed to open model file: {}", e))?;

        // Read the first 8 bytes to check for GGML magic number
        let mut buffer = [0u8; 8];
        file.read_exact(&mut buffer)
            .await
            .map_err(|e| anyhow!("Failed to read model file header: {}", e))?;

        // Check for GGML magic number (various versions and endianness)
        if buffer.starts_with(b"ggml")
            || buffer.starts_with(b"GGUF")
            || buffer.starts_with(b"ggmf")
            || buffer.starts_with(b"lmgg")
            || buffer.starts_with(b"FUGU")
            || buffer.starts_with(b"fmgg")
        {
            Ok(())
        } else {
            Err(anyhow!(
                "Invalid model file: missing GGML/GGUF magic number. Found: {:?}",
                String::from_utf8_lossy(&buffer[..4])
            ))
        }
    }

    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete model: {}", model_name);

        // Get model info to find the file path
        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info = model_info.ok_or_else(|| anyhow!("Model '{}' not found", model_name))?;

        // Check if model is corrupted before allowing deletion
        log::info!("Model '{}' has status: {:?}", model_name, model_info.status);
        match &model_info.status {
            ModelStatus::Corrupted {
                file_size,
                expected_min_size,
            } => {
                log::info!(
                    "Deleting corrupted model '{}' (file size: {} bytes, expected min: {} bytes)",
                    model_name,
                    file_size,
                    expected_min_size
                );

                // Delete the file
                if model_info.path.exists() {
                    fs::remove_file(&model_info.path).await.map_err(|e| {
                        anyhow!(
                            "Failed to delete file '{}': {}",
                            model_info.path.display(),
                            e
                        )
                    })?;
                    log::info!(
                        "Successfully deleted corrupted file: {}",
                        model_info.path.display()
                    );
                } else {
                    log::warn!(
                        "File '{}' does not exist, nothing to delete",
                        model_info.path.display()
                    );
                }

                // Update model status to Missing
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!(
                    "Successfully deleted corrupted model '{}'",
                    model_name
                ))
            }
            ModelStatus::Available => {
                // Allow deletion of available models for testing/cleanup
                log::info!("Deleting available model '{}' (for cleanup)", model_name);

                if model_info.path.exists() {
                    fs::remove_file(&model_info.path).await.map_err(|e| {
                        anyhow!(
                            "Failed to delete file '{}': {}",
                            model_info.path.display(),
                            e
                        )
                    })?;
                    log::info!(
                        "Successfully deleted available model file: {}",
                        model_info.path.display()
                    );
                } else {
                    log::warn!(
                        "File '{}' does not exist, nothing to delete",
                        model_info.path.display()
                    );
                }

                // Update model status to Missing
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!("Successfully deleted model '{}'", model_name))
            }
            _ => Err(anyhow!(
                "Can only delete corrupted or available models. Model '{}' has status: {:?}",
                model_name,
                model_info.status
            )),
        }
    }

    async fn reserve_active_download(&self, model_name: &str) -> Result<Arc<ActiveDownload>> {
        let mut active_downloads = self.active_downloads.lock().await;
        if active_downloads.contains_key(model_name) {
            return Err(anyhow!(
                "Download already in progress for model: {}",
                model_name
            ));
        }

        let (completion, _) = watch::channel(false);
        let active_download = Arc::new(ActiveDownload {
            cancellation: CancellationToken::new(),
            completion,
        });

        active_downloads.insert(model_name.to_string(), Arc::clone(&active_download));
        Ok(active_download)
    }

    async fn finish_download(
        &self,
        model_name: &str,
        active_download: &Arc<ActiveDownload>,
        file_path: &PathBuf,
        mut result: Result<()>,
    ) -> Result<()> {
        let active_owner_matches = {
            let active_downloads = self.active_downloads.lock().await;
            matches!(
                active_downloads.get(model_name),
                Some(current) if Arc::ptr_eq(current, active_download)
            )
        };
        if !active_owner_matches {
            log::warn!(
                "Download owner for {} was no longer active during finalization",
                model_name
            );
            active_download.completion.send_replace(true);
            return result;
        }

        if result.is_ok() && !active_download.cancellation.is_cancelled() {
            result = self.validate_model_file(file_path).await;

            if result.is_ok() {
                let expected_min_size = WHISPER_MODEL_CATALOG
                    .iter()
                    .find(|model| model.0 == model_name)
                    .map(|model| ((model.2 as f64 * 0.9) as u64) * 1024 * 1024);

                result = match expected_min_size {
                    Some(expected_min_size) => match fs::metadata(file_path).await {
                        Ok(metadata) if metadata.len() >= expected_min_size => Ok(()),
                        Ok(metadata) => Err(anyhow!(
                            "Downloaded model file is too small: {} bytes (expected at least {} bytes)",
                            metadata.len(),
                            expected_min_size
                        )),
                        Err(e) => Err(anyhow!(
                            "Failed to read downloaded model file metadata: {}",
                            e
                        )),
                    },
                    None => Err(anyhow!(
                        "Unsupported model for download validation: {}",
                        model_name
                    )),
                };
            }
        }

        if result.is_err() && !active_download.cancellation.is_cancelled() && file_path.exists() {
            if let Err(e) = fs::remove_file(file_path).await {
                log::warn!("Failed to clean up failed download file: {}", e);
            } else {
                log::info!("Cleaned up failed download file: {}", file_path.display());
            }
        }

        let (released_active_owner, cancellation_won) = {
            let mut active_downloads = self.active_downloads.lock().await;
            match active_downloads.get(model_name) {
                Some(current) if Arc::ptr_eq(current, active_download) => {
                    if active_download.cancellation.is_cancelled() {
                        (false, true)
                    } else {
                        active_downloads.remove(model_name);
                        (true, false)
                    }
                }
                _ => {
                    log::warn!(
                        "Download owner for {} was no longer active during finalization",
                        model_name
                    );
                    (false, active_download.cancellation.is_cancelled())
                }
            }
        };

        if cancellation_won {
            result = Err(DownloadCancelled.into());
            if file_path.exists() {
                if let Err(e) = fs::remove_file(file_path).await {
                    log::warn!("Failed to clean up cancelled download file: {}", e);
                } else {
                    log::info!(
                        "Cleaned up cancelled download file: {}",
                        file_path.display()
                    );
                }
            }

            let removed = {
                let mut active_downloads = self.active_downloads.lock().await;
                #[cfg(test)]
                if let Some(hook) = self.test_hook() {
                    hook.cancellation_first_lock_acquired.notify_one();
                    hook.continue_cancellation.notified().await;
                }

                let mut models = self.available_models.write().await;
                match active_downloads.get(model_name) {
                    Some(current) if Arc::ptr_eq(current, active_download) => {
                        if let Some(model_info) = models.get_mut(model_name) {
                            model_info.status = ModelStatus::Missing;
                        }
                        active_downloads.remove(model_name);
                        true
                    }
                    _ => false,
                }
            };
            if !removed {
                log::warn!(
                    "Download owner for {} was no longer active during cancellation cleanup",
                    model_name
                );
            }
        } else if released_active_owner {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                if result.is_ok() {
                    model_info.status = ModelStatus::Available;
                    model_info.path = file_path.clone();
                } else {
                    model_info.status = ModelStatus::Missing;
                }
            }
        }

        active_download.completion.send_replace(true);
        result
    }

    pub async fn download_model(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for model: {}", model_name);

        let model_url = match model_name {
            "tiny" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            "base" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            "small" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            "medium" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
            "large-v3-turbo" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
            "large-v3" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
            "tiny-q5_1" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
            "base-q5_1" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
            "small-q5_1" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
            "medium-q5_0" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin",
            "large-v3-turbo-q5_0" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
            "large-v3-q5_0" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
            _ => return Err(anyhow!("Unsupported model: {}", model_name)),
        };

        // The catalog is not a download authority: pin and validate it first.
        let model_url = super::model_integrity::pin_catalog_url(model_name, model_url)?;
        let existing = self.models_dir.join(format!("ggml-{model_name}.bin"));
        if existing.exists() {
            // Never truncate an existing model as a side effect of retrying download.
            super::model_integrity::verify_file(model_name, &existing).await?;
            if let Some(callback) = progress_callback {
                callback(100);
            }
            return Ok(());
        }
        self.download_model_from_url(model_name, &model_url, progress_callback)
            .await
    }

    async fn download_model_from_url(
        &self,
        model_name: &str,
        model_url: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        let active_download = self.reserve_active_download(model_name).await?;
        let file_path = self.models_dir.join(format!("ggml-{}.bin", model_name));

        let result = self
            .download_model_with_owner(
                model_name,
                model_url,
                &file_path,
                &active_download,
                progress_callback,
            )
            .await;

        self.finish_download(model_name, &active_download, &file_path, result)
            .await
    }

    async fn download_model_with_owner(
        &self,
        model_name: &str,
        model_url: &str,
        file_path: &PathBuf,
        active_download: &ActiveDownload,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        // This private helper also serves local HTTP cancellation fixtures. The
        // public download command above exclusively supplies a pinned catalog URL.
        let pinned_download = super::model_integrity::pinned_url(model_name)
            .map(|url| url == model_url)
            .unwrap_or(false);
        if active_download.cancellation.is_cancelled() {
            return Err(DownloadCancelled.into());
        }

        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir)
                .await
                .map_err(|e| anyhow!("Failed to create models directory: {}", e))?;
        }

        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::Downloading { progress: 0 };
            }
        }

        let client = super::model_integrity::download_client()?;
        let response = tokio::select! {
            biased;
            _ = active_download.cancellation.cancelled() => return Err(DownloadCancelled.into()),
            response = client.get(model_url).send() => response
                .map_err(|e| anyhow!("Failed to start download: {}", e))?,
        };

        if !response.status().is_success() {
            return Err(anyhow!(
                "Download failed with status: {}",
                response.status()
            ));
        }

        let total_size = response.content_length().unwrap_or(0);
        if total_size > super::model_integrity::MAX_MODEL_BYTES {
            return Err(anyhow!("음성 모델 다운로드 크기 한도 초과"));
        }
        let mut file = fs::create_file(file_path)
            .await
            .map_err(|e| anyhow!("Failed to create file: {}", e))?;

        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        let mut downloaded = 0u64;
        let mut last_progress_report = 0u8;
        let mut last_report_time = std::time::Instant::now();

        if let Some(ref callback) = progress_callback {
            callback(0);
        }

        loop {
            let chunk_result = tokio::select! {
                biased;
                _ = active_download.cancellation.cancelled() => return Err(DownloadCancelled.into()),
                chunk_result = stream.next() => chunk_result,
            };

            let Some(chunk_result) = chunk_result else {
                break;
            };

            if active_download.cancellation.is_cancelled() {
                return Err(DownloadCancelled.into());
            }

            let chunk = chunk_result.map_err(|e| anyhow!("Failed to read chunk: {}", e))?;
            if downloaded.saturating_add(chunk.len() as u64)
                > super::model_integrity::MAX_MODEL_BYTES
            {
                return Err(anyhow!("음성 모델 다운로드 크기 한도 초과"));
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| anyhow!("Failed to write chunk to file: {}", e))?;

            downloaded += chunk.len() as u64;
            let progress = if total_size > 0 {
                (((downloaded as f64 / total_size as f64) * 100.0) as u8).min(99)
            } else {
                0
            };

            let time_since_last_report = last_report_time.elapsed().as_secs();
            if progress >= last_progress_report + 1
                || progress == 100
                || time_since_last_report >= 2
            {
                let mut models = self.available_models.write().await;
                if let Some(model_info) = models.get_mut(model_name) {
                    model_info.status = ModelStatus::Downloading { progress };
                }

                if let Some(ref callback) = progress_callback {
                    callback(progress);
                }

                last_progress_report = progress;
                last_report_time = std::time::Instant::now();
            }
        }

        file.flush()
            .await
            .map_err(|e| anyhow!("Failed to flush file: {}", e))?;
        file.sync_all().await?;
        drop(file);

        if pinned_download {
            tokio::select! {
                biased;
                _ = active_download.cancellation.cancelled() => return Err(DownloadCancelled.into()),
                verified = super::model_integrity::verify_file(model_name, file_path) => verified?,
            }
        }

        if active_download.cancellation.is_cancelled() {
            return Err(DownloadCancelled.into());
        }

        if let Some(ref callback) = progress_callback {
            callback(100);
        }
        Ok(())
    }

    pub async fn cancel_download(&self, model_name: &str) -> Result<CancelDownloadOutcome> {
        self.cancel_download_with_timeout(model_name, CANCEL_DOWNLOAD_CLEANUP_TIMEOUT)
            .await
    }

    async fn cancel_download_with_timeout(
        &self,
        model_name: &str,
        cleanup_timeout: Duration,
    ) -> Result<CancelDownloadOutcome> {
        log::info!("Cancelling download for model: {}", model_name);

        let Some(active_download) = self.active_downloads.lock().await.get(model_name).cloned()
        else {
            return Ok(CancelDownloadOutcome::Cancelled);
        };

        active_download.cancellation.cancel();

        let mut completion = active_download.completion.subscribe();
        if !*completion.borrow() {
            match tokio::time::timeout(cleanup_timeout, completion.changed()).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    return Err(anyhow!(
                        "Download worker ended before completing cancellation cleanup"
                    ));
                }
                Err(_) => {
                    return Ok(CancelDownloadOutcome::Pending);
                }
            }
        }

        Ok(CancelDownloadOutcome::Cancelled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use tokio::time::{timeout, Duration};

    #[tokio::test]
    #[ignore = "requires local model and STREAM_RECORD_PROMPT_FIXTURE mono 16k f32 PCM"]
    async fn stream_record_actual_prompt_feedback_comparison() {
        let model_dir = PathBuf::from(std::env::var("STREAM_RECORD_PROMPT_MODELS").unwrap());
        let fixture = PathBuf::from(std::env::var("STREAM_RECORD_PROMPT_FIXTURE").unwrap());
        let bytes = crate::review_paths::fs::read(&fixture).unwrap();
        assert_eq!(bytes.len() % 4, 0);
        let samples: Vec<f32> = bytes.chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).collect();
        assert_eq!(samples.len(), 12 * 16000);
        let engine = WhisperEngine::new_with_models_dir(Some(model_dir)).unwrap();
        engine.discover_models().await.unwrap();
        engine.load_model("small-q5_1").await.unwrap();
        crate::whisper_engine::stt_context::begin("").unwrap();
        let configured = crate::whisper_engine::stt_context::for_chunk(1092.0, 12.0)
            .map(|ticket| ticket.text);
        let mut results = Vec::new();
        for (label, prompt) in [
            ("none", None),
            ("static", Some("한국어 회의 발언.")),
            ("previous", Some("한국어 회의 발언. 이전 발언: 이에 대해 전해 드릴 수 있습니다.")),
            ("configured", configured.as_deref()),
        ] {
            let started = std::time::Instant::now();
            let result = engine.transcribe_audio_with_prompt(samples.clone(), Some("ko".into()),
                prompt.map(str::to_owned)).await.unwrap();
            results.push(serde_json::json!({"condition": label, "seconds": started.elapsed().as_secs_f64(),
                "text": result.text, "raw": result.raw_text}));
        }
        let output = PathBuf::from(std::env::var("STREAM_RECORD_PROMPT_RESULT").unwrap());
        crate::review_paths::fs::write(output, serde_json::to_vec_pretty(&results).unwrap()).unwrap();
        engine.unload_model().await;
        crate::whisper_engine::stt_context::end();
        assert_eq!(results[2]["text"], "이에 대해 전해 드릴 수 있습니다.");
        let configured_text = results[3]["text"].as_str().unwrap();
        assert!(!configured_text.contains("이에 대해 전해 드릴 수 있습니다"));
        assert_eq!(results[3]["text"], results[0]["text"]);
    }

    #[tokio::test]
    #[ignore = "requires an exact preserved live queue input and local multilingual model"]
    async fn stream_record_exact_utf8_wrapping() {
        let root = PathBuf::from(std::env::var("STREAM_RECORD_UTF8_ROOT").unwrap());
        let model_dir = PathBuf::from(std::env::var("STREAM_RECORD_PROMPT_MODELS").unwrap());
        let input = crate::review_paths::fs::read(root.join("input.chunk")).unwrap();
        assert_eq!(&input[..4], b"SRQ1");
        assert_eq!(u32::from_le_bytes(input[4..8].try_into().unwrap()), 16_000);
        let sample_count = u64::from_le_bytes(input[25..33].try_into().unwrap()) as usize;
        assert_eq!(input.len(), 33 + sample_count * 4);
        let samples: Vec<f32> = input[33..].chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).collect();
        assert_eq!(samples.len(), 12 * 16_000);
        let original: serde_json::Value = serde_json::from_slice(
            &crate::review_paths::fs::read(root.join("original-result.json")).unwrap()).unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(model_dir)).unwrap();
        engine.discover_models().await.unwrap();
        engine.load_model("small-q5_1").await.unwrap();
        let configured = engine.transcribe_audio_with_prompt(
            samples.clone(), Some("ko".into()), None).await.unwrap();
        let configured_file = engine.transcribe_audio(samples.clone(), Some("ko".into())).await.unwrap();
        let adaptive = crate::audio::HardwareProfile::detect().get_whisper_config();
        let lock = engine.current_context.read().await;
        let context = lock.as_ref().unwrap();
        let mut controls = Vec::new();
        for split_on_word in [false, true] {
            let mut params = FullParams::new(SamplingStrategy::BeamSearch {
                beam_size: adaptive.beam_size as i32, patience: 1.0,
            });
            params.set_language(Some("ko"));
            params.set_translate(false);
            params.set_no_timestamps(true);
            params.set_token_timestamps(true);
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_suppress_blank(true);
            params.set_suppress_non_speech_tokens(true);
            params.set_temperature(adaptive.temperature);
            params.set_max_initial_ts(1.0);
            params.set_entropy_thold(2.4);
            params.set_logprob_thold(-1.0);
            params.set_no_speech_thold(0.55);
            params.set_max_len(200);
            params.set_split_on_word(split_on_word);
            params.set_single_segment(false);
            let mut state = context.create_state().unwrap();
            state.full(params, &samples).unwrap();
            let bytes: Vec<Vec<u8>> = (0..state.full_n_segments().unwrap())
                .map(|i| state.full_get_segment_bytes(i).unwrap()).collect();
            let joined = bytes.concat();
            let joined_text = String::from_utf8(joined).unwrap();
            let valid_segments = bytes.iter().all(|segment| std::str::from_utf8(segment).is_ok());
            let lossy_text = bytes.iter().map(|segment| String::from_utf8_lossy(segment).into_owned())
                .collect::<Vec<_>>().concat();
            controls.push(serde_json::json!({
                "split_on_word": split_on_word,
                "all_segments_valid_utf8": valid_segments,
                "segment_bytes": bytes,
                "joined_utf8": joined_text,
                "lossy_per_segment": lossy_text,
            }));
        }
        let results = serde_json::json!({
            "samples": sample_count,
            "configured_raw": configured.raw_text,
            "configured_text": configured.text,
            "configured_spans": configured.spans,
            "configured_file_text": configured_file,
            "controls": controls,
        });
        crate::review_paths::fs::write(root.join("results.json"),
            serde_json::to_vec_pretty(&results).unwrap()).unwrap();
        assert_eq!(controls[0]["lossy_per_segment"], original["raw_engine_output"]);
        assert_eq!(controls[0]["all_segments_valid_utf8"], false);
        assert_eq!(controls[1]["all_segments_valid_utf8"], true);
        assert_eq!(controls[0]["joined_utf8"], controls[1]["joined_utf8"],
            "word-boundary wrapping must not change decoded text bytes");
        assert_eq!(results["configured_raw"], controls[1]["joined_utf8"],
            "live transcription must preserve complete UTF-8 characters");
        assert!(!results["configured_text"].as_str().unwrap().contains('\u{fffd}'));
        assert!(!results["configured_file_text"].as_str().unwrap().contains('\u{fffd}'));
        assert!(results["configured_spans"].as_array().unwrap().iter()
            .all(|span| !span["text"].as_str().unwrap().contains('\u{fffd}')));
    }

    #[tokio::test]
    #[ignore = "requires preserved meeting fixtures and local multilingual model"]
    async fn stream_record_actual_decoder_quality_matrix() {
        let root = PathBuf::from(std::env::var("STREAM_RECORD_QUALITY_ROOT").unwrap());
        let model_dir = PathBuf::from(std::env::var("STREAM_RECORD_PROMPT_MODELS").unwrap());
        let engine = WhisperEngine::new_with_models_dir(Some(model_dir)).unwrap();
        engine.discover_models().await.unwrap();
        engine.load_model("small-q5_1").await.unwrap();
        let mut results = Vec::new();
        for seconds in [72, 96, 156, 180] {
            let bytes = crate::review_paths::fs::read(root.join(format!("quality-{seconds}.f32"))).unwrap();
            let source: Vec<f32> = bytes.chunks_exact(4)
                .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).collect();
            assert_eq!(source.len(), 12 * 48000);
            let samples = crate::audio::audio_processing::resample_audio(&source, 48000, 16000);
            for (label, temperature, prompt) in [
                ("current-static", 0.2, Some("한국어 회의 발언.")),
                ("zero-static", 0.0, Some("한국어 회의 발언.")),
                ("current-none", 0.2, None),
                ("zero-none", 0.0, None),
            ] {
                let started = std::time::Instant::now();
                let lock = engine.current_context.read().await;
                let ctx = lock.as_ref().unwrap();
                let mut params = FullParams::new(SamplingStrategy::BeamSearch { beam_size: 2, patience: 1.0 });
                params.set_language(Some("ko"));
                params.set_translate(false);
                if let Some(prompt) = prompt { params.set_initial_prompt(prompt); }
                params.set_no_timestamps(true);
                params.set_token_timestamps(true);
                params.set_print_special(false);
                params.set_print_progress(false);
                params.set_print_realtime(false);
                params.set_print_timestamps(false);
                params.set_suppress_blank(true);
                params.set_suppress_non_speech_tokens(true);
                params.set_temperature(temperature);
                params.set_max_initial_ts(1.0);
                params.set_entropy_thold(2.4);
                params.set_logprob_thold(-1.0);
                params.set_no_speech_thold(0.55);
                params.set_max_len(200);
                params.set_single_segment(false);
                let mut state = ctx.create_state().unwrap();
                state.full(params, &samples).unwrap();
                let text = (0..state.full_n_segments().unwrap())
                    .map(|i| state.full_get_segment_text_lossy(i).unwrap())
                    .collect::<Vec<_>>().join(" ");
                results.push(serde_json::json!({"start":seconds,"condition":label,
                    "elapsed":started.elapsed().as_secs_f64(),"text":text,"samples":samples.len()}));
                crate::review_paths::fs::write(root.join("quality-results.json"),
                    serde_json::to_vec_pretty(&results).unwrap()).unwrap();
            }
        }
        assert_eq!(results.len(), 16);
    }

    #[tokio::test]
    #[ignore = "requires lossless PCM copied from an approved live queue"]
    async fn stream_record_exact_prompt_comparison() {
        let root = PathBuf::from(std::env::var("STREAM_RECORD_EXACT_ROOT").unwrap());
        let manifest: serde_json::Value = serde_json::from_slice(
            &crate::review_paths::fs::read(root.join("fixtures.json")).unwrap()).unwrap();
        let model_dir = PathBuf::from(std::env::var("STREAM_RECORD_PROMPT_MODELS").unwrap());
        let engine = WhisperEngine::new_with_models_dir(Some(model_dir)).unwrap();
        engine.discover_models().await.unwrap();
        engine.load_model("small-q5_1").await.unwrap();
        crate::whisper_engine::stt_context::begin("").unwrap();
        let mut results = Vec::new();
        for fixture in manifest.as_array().unwrap() {
            let bytes = crate::review_paths::fs::read(root.join(fixture["file"].as_str().unwrap())).unwrap();
            assert_eq!(bytes.len() % 4, 0);
            let samples: Vec<f32> = bytes.chunks_exact(4)
                .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).collect();
            assert_eq!(samples.len() as u64, fixture["samples"].as_u64().unwrap());
            let ticket = crate::whisper_engine::stt_context::for_chunk(
                fixture["start"].as_f64().unwrap(), samples.len() as f64 / 16000.0);
            let configured = ticket.map(|ticket| ticket.text);
            for (label, prompt) in [
                ("configured", configured),
                ("static", Some("한국어 회의 발언.".to_owned())),
                ("none", None),
            ] {
                let started = std::time::Instant::now();
                let result = engine.transcribe_audio_with_prompt(samples.clone(), Some("ko".into()), prompt).await.unwrap();
                results.push(serde_json::json!({"sequence":fixture["sequence"],"condition":label,
                    "elapsed":started.elapsed().as_secs_f64(),"text":result.text,"raw":result.raw_text}));
                crate::review_paths::fs::write(root.join("results.json"),
                    serde_json::to_vec_pretty(&results).unwrap()).unwrap();
            }
        }
        crate::whisper_engine::stt_context::end();
        assert!(!results.is_empty());
        for comparison in results.chunks_exact(3) {
            assert_eq!(comparison[0]["text"], comparison[2]["text"],
                "an empty user glossary must not inject generated meeting prose");
        }
    }

    fn tiny_model(models: &[ModelInfo]) -> &ModelInfo {
        models
            .iter()
            .find(|model| model.name == "tiny")
            .expect("tiny should be present in the Whisper model catalog")
    }

    #[tokio::test]
    async fn discover_models_keeps_active_downloads_downloading_before_a_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();

        let _active_download = engine.reserve_active_download("tiny").await.unwrap();
        engine.available_models.write().await.insert(
            "tiny".to_string(),
            ModelInfo {
                name: "tiny".to_string(),
                path: dir.path().join("ggml-tiny.bin"),
                size_mb: 75,
                accuracy: "Basic".to_string(),
                speed: "Fast".to_string(),
                status: ModelStatus::Downloading { progress: 42 },
                description: "test model".to_string(),
            },
        );

        let absent = engine.discover_models().await.unwrap();
        assert!(matches!(
            tiny_model(&absent).status,
            ModelStatus::Downloading { progress: 42 }
        ));

        crate::review_paths::fs::write(dir.path().join("ggml-tiny.bin"), b"").unwrap();
        let zero_byte = engine.discover_models().await.unwrap();
        assert!(matches!(
            tiny_model(&zero_byte).status,
            ModelStatus::Downloading { progress: 42 }
        ));

        crate::review_paths::fs::write(dir.path().join("ggml-tiny.bin"), [0_u8; 32]).unwrap();
        let partial = engine.discover_models().await.unwrap();
        assert!(matches!(
            tiny_model(&partial).status,
            ModelStatus::Downloading { progress: 42 }
        ));
    }

    #[tokio::test]
    async fn discover_models_uses_disk_state_after_a_download_is_no_longer_active() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();

        let model_path = dir.path().join("ggml-tiny.bin");
        crate::review_paths::fs::write(&model_path, b"").unwrap();
        let missing_models = engine.discover_models().await.unwrap();
        assert!(matches!(
            tiny_model(&missing_models).status,
            ModelStatus::Missing
        ));

        crate::review_paths::fs::write(&model_path, vec![0_u8; 2 * 1024 * 1024]).unwrap();
        let corrupted_models = engine.discover_models().await.unwrap();

        assert!(matches!(
            tiny_model(&corrupted_models).status,
            ModelStatus::Corrupted { .. }
        ));
    }

    #[tokio::test]
    async fn finish_download_publishes_available_after_releasing_active_owner() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        let model_path = dir.path().join("ggml-tiny.bin");

        crate::review_paths::fs::write(&model_path, b"ggml\0\0\0\0").unwrap();
        crate::review_paths::fs::OpenOptions::new()
            .write(true)
            .open(&model_path)
            .unwrap()
            .set_len(68 * 1024 * 1024)
            .unwrap();

        engine.discover_models().await.unwrap();
        let active_download = engine.reserve_active_download("tiny").await.unwrap();
        let active_models = engine.discover_models().await.unwrap();
        assert!(matches!(
            tiny_model(&active_models).status,
            ModelStatus::Downloading { progress: 0 }
        ));

        engine
            .finish_download("tiny", &active_download, &model_path, Ok(()))
            .await
            .unwrap();

        assert!(!engine.active_downloads.lock().await.contains_key("tiny"));
        assert!(matches!(
            engine
                .available_models
                .read()
                .await
                .get("tiny")
                .expect("tiny should remain cached")
                .status,
            ModelStatus::Available
        ));

        let rediscovered_models = engine.discover_models().await.unwrap();
        assert!(matches!(
            tiny_model(&rediscovered_models).status,
            ModelStatus::Available
        ));
    }

    #[tokio::test]
    async fn finish_download_rejects_invalid_header_and_cleans_file() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        let model_path = dir.path().join("ggml-tiny.bin");
        crate::review_paths::fs::write(&model_path, b"not-a-model").unwrap();

        engine.discover_models().await.unwrap();
        let active_download = engine.reserve_active_download("tiny").await.unwrap();
        let error = engine
            .finish_download("tiny", &active_download, &model_path, Ok(()))
            .await
            .unwrap_err();

        assert!(error
            .to_string()
            .contains("Invalid model file: missing GGML/GGUF magic number"));
        assert!(!engine.active_downloads.lock().await.contains_key("tiny"));
        assert!(!model_path.exists());
        assert!(matches!(
            engine
                .available_models
                .read()
                .await
                .get("tiny")
                .expect("tiny should remain cached")
                .status,
            ModelStatus::Missing
        ));
    }

    #[tokio::test]
    async fn unsupported_download_does_not_leave_an_active_transfer() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();

        assert!(engine.download_model("not-a-model", None).await.is_err());
        assert!(!engine
            .active_downloads
            .lock()
            .await
            .contains_key("not-a-model"));
    }

    #[tokio::test]
    async fn duplicate_download_reservation_is_rejected_while_the_first_owner_is_active() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();

        let _first_owner = engine.reserve_active_download("tiny").await.unwrap();
        assert!(engine.reserve_active_download("tiny").await.is_err());
    }

    #[tokio::test]
    async fn cancelled_finalization_holds_active_ownership_before_discovery() {
        let dir = tempfile::tempdir().unwrap();
        let engine =
            Arc::new(WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap());
        engine.discover_models().await.unwrap();

        let active_download = engine.reserve_active_download("tiny").await.unwrap();
        active_download.cancellation.cancel();

        let hook = Arc::new(DownloadStateTestHook {
            cancellation_first_lock_acquired: tokio::sync::Notify::new(),
            continue_cancellation: tokio::sync::Notify::new(),
            discovery_active_lock_acquired: tokio::sync::Notify::new(),
            continue_discovery: tokio::sync::Notify::new(),
        });
        *engine.download_state_test_hook.lock().unwrap() = Some(Arc::clone(&hook));

        let finalization_engine = Arc::clone(&engine);
        let finalization_owner = Arc::clone(&active_download);
        let model_path = dir.path().join("ggml-tiny.bin");
        let finalization = tokio::spawn(async move {
            finalization_engine
                .finish_download(
                    "tiny",
                    &finalization_owner,
                    &model_path,
                    Err(DownloadCancelled.into()),
                )
                .await
        });

        timeout(
            Duration::from_secs(1),
            hook.cancellation_first_lock_acquired.notified(),
        )
        .await
        .expect("cancellation finalization should reach its first lock");

        let discovery_engine = Arc::clone(&engine);
        let discovery = tokio::spawn(async move { discovery_engine.discover_models().await });

        assert!(
            timeout(
                Duration::from_millis(100),
                hook.discovery_active_lock_acquired.notified(),
            )
            .await
            .is_err(),
            "discovery must wait for cancellation to release active ownership"
        );

        hook.continue_cancellation.notify_one();
        let finalization_result = timeout(Duration::from_secs(1), finalization)
            .await
            .expect("cancelled finalization should complete")
            .unwrap()
            .unwrap_err();
        assert!(is_download_cancelled(&finalization_result));

        timeout(
            Duration::from_secs(1),
            hook.discovery_active_lock_acquired.notified(),
        )
        .await
        .expect("discovery should acquire active ownership after cancellation finalizes");
        hook.continue_discovery.notify_one();

        let models = timeout(Duration::from_secs(1), discovery)
            .await
            .expect("discovery should complete")
            .unwrap()
            .unwrap();
        assert!(matches!(tiny_model(&models).status, ModelStatus::Missing));
        assert!(!engine.active_downloads.lock().await.contains_key("tiny"));
    }

    #[tokio::test]
    async fn cancelling_an_unresponsive_download_keeps_ownership_reserved() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        let active_download = engine.reserve_active_download("tiny").await.unwrap();

        let outcome = engine
            .cancel_download_with_timeout("tiny", Duration::from_millis(1))
            .await
            .expect("an unresponsive download should report cancellation pending");

        assert_eq!(outcome, CancelDownloadOutcome::Pending);
        assert!(active_download.cancellation.is_cancelled());
        assert!(matches!(
            engine.active_downloads.lock().await.get("tiny"),
            Some(current) if Arc::ptr_eq(current, &active_download)
        ));
        assert!(engine.reserve_active_download("tiny").await.is_err());
    }

    #[tokio::test]
    async fn late_cancellation_preserves_a_completed_model_state() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        let model_path = dir.path().join("ggml-tiny.bin");

        crate::review_paths::fs::write(&model_path, b"ggml\0\0\0\0").unwrap();
        crate::review_paths::fs::OpenOptions::new()
            .write(true)
            .open(&model_path)
            .unwrap()
            .set_len(68 * 1024 * 1024)
            .unwrap();

        engine.discover_models().await.unwrap();
        let active_download = engine.reserve_active_download("tiny").await.unwrap();
        engine
            .finish_download("tiny", &active_download, &model_path, Ok(()))
            .await
            .unwrap();

        assert_eq!(
            engine
                .cancel_download_with_timeout("tiny", Duration::from_millis(1))
                .await
                .unwrap(),
            CancelDownloadOutcome::Cancelled
        );
        assert!(matches!(
            tiny_model(&engine.discover_models().await.unwrap()).status,
            ModelStatus::Available
        ));
    }

    async fn stalled_http_server() -> (
        String,
        oneshot::Receiver<()>,
        oneshot::Sender<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (headers_sent, headers_ready) = oneshot::channel();
        let (release_body, body_released) = oneshot::channel();

        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
            socket.flush().await.unwrap();
            headers_sent.send(()).unwrap();
            let _ = body_released.await;
            let _ = socket.write_all(b"test").await;
        });

        (
            format!("http://{address}/model.bin"),
            headers_ready,
            release_body,
            server,
        )
    }

    async fn response_http_server(
        content_length: usize,
        body: &'static [u8],
    ) -> (
        String,
        oneshot::Receiver<Vec<u8>>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (request_sent, request_received) = oneshot::channel();

        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            loop {
                let bytes_read = socket.read(&mut buffer).await.unwrap();
                if bytes_read == 0 {
                    break;
                }

                request.extend_from_slice(&buffer[..bytes_read]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            request_sent.send(request).unwrap();

            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n"
            );
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(body).await.unwrap();
            socket.flush().await.unwrap();
        });

        (
            format!("http://{address}/model.bin"),
            request_received,
            server,
        )
    }

    #[tokio::test]
    async fn downloaded_model_sends_user_agent_and_rejects_undersized_valid_header() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        engine.discover_models().await.unwrap();
        let (url, request, server) = response_http_server(8, b"ggml\0\0\0\0").await;

        let error = engine
            .download_model_from_url("tiny", &url, None)
            .await
            .unwrap_err();
        let request = String::from_utf8(request.await.unwrap()).unwrap();
        server.await.unwrap();

        assert!(error.to_string().contains("too small"));
        assert!(request
            .to_ascii_lowercase()
            .contains("user-agent: stream-record-model-downloader"));
        assert!(!engine.active_downloads.lock().await.contains_key("tiny"));
        assert!(!dir.path().join("ggml-tiny.bin").exists());
        assert!(matches!(
            engine
                .available_models
                .read()
                .await
                .get("tiny")
                .expect("tiny should remain cached")
                .status,
            ModelStatus::Missing
        ));
    }

    #[tokio::test]
    async fn cancelling_a_stalled_download_waits_for_cleanup_before_retry_can_start() {
        let dir = tempfile::tempdir().unwrap();
        let engine =
            Arc::new(WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap());
        let (url_a, headers_a, release_a, server_a) = stalled_http_server().await;

        let download_a_engine = Arc::clone(&engine);
        let download_a = tokio::spawn(async move {
            download_a_engine
                .download_model_from_url("tiny", &url_a, None)
                .await
        });

        timeout(Duration::from_secs(1), headers_a)
            .await
            .expect("first request should receive response headers")
            .unwrap();

        assert!(engine.active_downloads.lock().await.contains_key("tiny"));
        let status_while_active = engine.discover_models().await.unwrap();
        assert!(matches!(
            tiny_model(&status_while_active).status,
            ModelStatus::Downloading { progress: 0 }
        ));

        timeout(Duration::from_secs(1), engine.cancel_download("tiny"))
            .await
            .expect("cancellation should not wait for a stalled response body")
            .unwrap();

        let download_a_result = timeout(Duration::from_secs(1), download_a)
            .await
            .expect("cancelled worker should finish promptly")
            .unwrap();
        assert!(is_download_cancelled(&download_a_result.unwrap_err()));
        assert!(!engine.active_downloads.lock().await.contains_key("tiny"));
        assert!(!dir.path().join("ggml-tiny.bin").exists());

        let (url_b, headers_b, release_b, server_b) = stalled_http_server().await;
        let download_b_engine = Arc::clone(&engine);
        let download_b = tokio::spawn(async move {
            download_b_engine
                .download_model_from_url("tiny", &url_b, None)
                .await
        });
        timeout(Duration::from_secs(1), headers_b)
            .await
            .expect("retry should reserve the released model slot")
            .unwrap();
        assert!(engine.active_downloads.lock().await.contains_key("tiny"));

        timeout(Duration::from_secs(1), engine.cancel_download("tiny"))
            .await
            .expect("retry cancellation should also complete promptly")
            .unwrap();
        assert!(is_download_cancelled(
            &timeout(Duration::from_secs(1), download_b)
                .await
                .expect("retry worker should finish promptly")
                .unwrap()
                .unwrap_err()
        ));

        let _ = release_a.send(());
        let _ = release_b.send(());
        let _ = server_a.await;
        let _ = server_b.await;
    }

    #[tokio::test]
    async fn incomplete_response_cleans_partial_file_and_cache() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        let model_path = dir.path().join("ggml-tiny.bin");
        engine.discover_models().await.unwrap();
        let (url, _request, server) = response_http_server(8, b"ggml").await;

        let error = engine
            .download_model_from_url("tiny", &url, None)
            .await
            .unwrap_err();
        server.await.unwrap();

        assert!(error.to_string().contains("Failed to read chunk"));
        assert!(!engine.active_downloads.lock().await.contains_key("tiny"));
        assert!(!model_path.exists());
        assert!(matches!(
            engine
                .available_models
                .read()
                .await
                .get("tiny")
                .expect("tiny should remain cached")
                .status,
            ModelStatus::Missing
        ));

        let models = engine.discover_models().await.unwrap();
        assert!(matches!(tiny_model(&models).status, ModelStatus::Missing));
    }

    #[tokio::test]
    async fn terminal_download_error_releases_the_active_transfer() {
        let dir = tempfile::tempdir().unwrap();
        let engine = WhisperEngine::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        let model_path = dir.path().join("ggml-tiny.bin");
        crate::review_paths::fs::write(&model_path, vec![0_u8; 2 * 1024 * 1024]).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });

        assert!(engine
            .download_model_from_url("tiny", &format!("http://{address}/model.bin"), None)
            .await
            .is_err());
        server.await.unwrap();

        assert!(!engine.active_downloads.lock().await.contains_key("tiny"));
        assert!(!model_path.exists());
        let models = engine.discover_models().await.unwrap();
        assert!(matches!(tiny_model(&models).status, ModelStatus::Missing));
    }
}

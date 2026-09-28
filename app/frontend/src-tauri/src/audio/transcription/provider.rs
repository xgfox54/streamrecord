// audio/transcription/provider.rs
//
// Defines the unified TranscriptionProvider trait and common types for all
// transcription engines (Whisper, Parakeet, future providers).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

// ============================================================================
// TRANSCRIPTION PROVIDER TRAIT & ERROR TYPES
// ============================================================================

/// Granular error types for transcription operations
#[derive(Debug, Clone)]
pub enum TranscriptionError {
    ModelNotLoaded,
    AudioTooShort { samples: usize, minimum: usize },
    EngineFailed(String),
    UnsupportedLanguage(String),
}

impl std::fmt::Display for TranscriptionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ModelNotLoaded => write!(f, "No transcription model is loaded"),
            Self::AudioTooShort { samples, minimum } => write!(
                f,
                "Audio too short: {} samples (minimum {})",
                samples, minimum
            ),
            Self::EngineFailed(msg) => write!(f, "Transcription engine failed: {}", msg),
            Self::UnsupportedLanguage(lang) => {
                write!(f, "Language '{}' is not supported by this provider", lang)
            }
        }
    }
}

impl std::error::Error for TranscriptionError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptScoreKind {
    MeanTokenProbability,
    Unavailable,
}

impl Default for TranscriptScoreKind {
    fn default() -> Self {
        Self::Unavailable
    }
}

impl TranscriptScoreKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MeanTokenProbability => "mean_token_probability",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptScore {
    pub kind: TranscriptScoreKind,
    pub value: Option<f32>,
    pub engine: String,
    pub calibration: String,
}

impl TranscriptScore {
    pub fn unavailable(engine: impl Into<String>) -> Self {
        Self {
            kind: TranscriptScoreKind::Unavailable,
            value: None,
            engine: engine.into(),
            calibration: "unavailable".to_string(),
        }
    }

    pub fn mean_token_probability(engine: impl Into<String>, value: Option<f32>) -> Self {
        match value.filter(|value| value.is_finite() && (0.0..=1.0).contains(value)) {
            Some(value) => Self {
                kind: TranscriptScoreKind::MeanTokenProbability,
                value: Some(value),
                engine: engine.into(),
                calibration: "uncalibrated_not_accuracy".to_string(),
            },
            None => Self::unavailable(engine),
        }
    }
}

impl Default for TranscriptScore {
    fn default() -> Self {
        Self {
            kind: TranscriptScoreKind::Unavailable,
            value: None,
            engine: "legacy".to_string(),
            calibration: "legacy_unavailable".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RawEngineOutputStatus {
    Captured,
    RawUnavailableLegacy,
}

impl Default for RawEngineOutputStatus {
    fn default() -> Self {
        Self::RawUnavailableLegacy
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranscriptSpan {
    pub text: String,
    pub start_sample: u64,
    pub end_sample: u64,
    pub timebase_hz: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptResult {
    pub raw_text: String,
    pub text: String,
    pub score: TranscriptScore,
    pub is_partial: bool,
    pub spans: Vec<TranscriptSpan>,
}

/// Trait for transcription providers (Whisper, Parakeet, future providers)
#[async_trait]
pub trait TranscriptionProvider: Send + Sync {
    /// Transcribe audio samples to text
    ///
    /// # Arguments
    /// * `audio` - Audio samples (16kHz mono, f32 format)
    /// * `language` - Optional language hint (e.g., "en", "es", "fr")
    ///
    /// # Returns
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError>;

    /// Optional explicit hint. Providers without prompt support keep their
    /// normal behavior rather than treating the hint as audio or instructions.
    async fn transcribe_with_prompt(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
        _prompt: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        self.transcribe(audio, language).await
    }

    /// Check if a model is currently loaded
    async fn is_model_loaded(&self) -> bool;

    /// Get the name of the currently loaded model
    async fn get_current_model(&self) -> Option<String>;

    /// Get the provider name (for logging/debugging)
    fn provider_name(&self) -> &'static str;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_defaults_are_explicitly_unavailable() {
        let score = TranscriptScore::default();
        assert_eq!(score.kind, TranscriptScoreKind::Unavailable);
        assert_eq!(score.value, None);
        assert_eq!(score.engine, "legacy");
        assert_eq!(score.calibration, "legacy_unavailable");
        assert_eq!(
            RawEngineOutputStatus::default(),
            RawEngineOutputStatus::RawUnavailableLegacy
        );
    }

    #[test]
    fn token_probability_rejects_invalid_values() {
        for value in [None, Some(f32::NAN), Some(-0.1), Some(1.1)] {
            assert_eq!(
                TranscriptScore::mean_token_probability("whisper_cpp", value).kind,
                TranscriptScoreKind::Unavailable
            );
        }
        let score = TranscriptScore::mean_token_probability("whisper_cpp", Some(0.75));
        assert_eq!(score.kind, TranscriptScoreKind::MeanTokenProbability);
        assert_eq!(score.value, Some(0.75));
        assert_eq!(score.calibration, "uncalibrated_not_accuracy");
    }
}

// audio/transcription/whisper_provider.rs
//
// Whisper transcription provider implementation.

use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use std::sync::Arc;

/// Whisper transcription provider (wraps WhisperEngine)
pub struct WhisperProvider {
    engine: Arc<crate::whisper_engine::WhisperEngine>,
}

impl WhisperProvider {
    pub fn new(engine: Arc<crate::whisper_engine::WhisperEngine>) -> Self {
        Self { engine }
    }
}

#[async_trait]
impl TranscriptionProvider for WhisperProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        self.transcribe_with_prompt(audio, language, None).await
    }

    async fn transcribe_with_prompt(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
        prompt: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        self.engine
            .transcribe_audio_with_prompt(audio, language, prompt)
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))
    }

    async fn is_model_loaded(&self) -> bool {
        self.engine.is_model_loaded().await
    }

    async fn get_current_model(&self) -> Option<String> {
        self.engine.get_current_model().await
    }

    fn provider_name(&self) -> &'static str {
        "Whisper"
    }
}

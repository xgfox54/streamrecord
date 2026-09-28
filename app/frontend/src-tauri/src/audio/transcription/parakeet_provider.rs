// audio/transcription/parakeet_provider.rs
//
// Parakeet transcription provider implementation.

use super::provider::{
    TranscriptResult, TranscriptScore, TranscriptSpan, TranscriptionError, TranscriptionProvider,
};
use async_trait::async_trait;
use log::warn;
use std::sync::Arc;

/// Parakeet transcription provider (wraps ParakeetEngine)
pub struct ParakeetProvider {
    engine: Arc<crate::parakeet_engine::ParakeetEngine>,
}

impl ParakeetProvider {
    pub fn new(engine: Arc<crate::parakeet_engine::ParakeetEngine>) -> Self {
        Self { engine }
    }
}

#[async_trait]
impl TranscriptionProvider for ParakeetProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        // Log language preference warning if set (Parakeet doesn't support it yet)
        if let Some(ref lang) = language {
            warn!(
                "Parakeet doesn't support language preference '{}' yet - transcribing in default language",
                lang
            );
        }

        let input_samples = audio.len() as u64;
        match self.engine.transcribe_audio(audio).await {
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
                Ok(TranscriptResult {
                    raw_text,
                    text,
                    score: TranscriptScore::unavailable("parakeet"),
                    is_partial: false,
                    spans,
                })
            }
            Err(e) => Err(TranscriptionError::EngineFailed(e.to_string())),
        }
    }

    async fn is_model_loaded(&self) -> bool {
        self.engine.is_model_loaded().await
    }

    async fn get_current_model(&self) -> Option<String> {
        self.engine.get_current_model().await
    }

    fn provider_name(&self) -> &'static str {
        "Parakeet"
    }
}

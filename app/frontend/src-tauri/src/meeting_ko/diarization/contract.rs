use super::{DiarizationError, ENGINE_REVISION, MODEL_ID, MODEL_REVISION};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpeakerSegment {
    pub start: f64,
    pub end: f64,
    pub speaker: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizationResult {
    pub model_id: &'static str,
    pub model_revision: &'static str,
    pub engine_revision: &'static str,
    pub segments: Vec<SpeakerSegment>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeOutput {
    file: String,
    segments: Vec<SpeakerSegment>,
}

pub fn parse_output(bytes: &[u8], duration: f64) -> Result<DiarizationResult, DiarizationError> {
    if !duration.is_finite() || duration <= 0.0 || bytes.len() > 32 * 1024 * 1024 {
        return Err(DiarizationError::InvalidSegments);
    }
    let native: NativeOutput = serde_json::from_slice(bytes)?;
    if native.file.is_empty() || native.segments.len() > 200_000 {
        return Err(DiarizationError::InvalidSegments);
    }
    for segment in &native.segments {
        if !segment.start.is_finite()
            || !segment.end.is_finite()
            || segment.start < 0.0
            || segment.end <= segment.start
            || segment.end > duration + 0.1
            || !(1..=8).contains(&segment.speaker)
        {
            return Err(DiarizationError::InvalidSegments);
        }
    }
    Ok(DiarizationResult {
        model_id: MODEL_ID,
        model_revision: MODEL_REVISION,
        engine_revision: ENGINE_REVISION,
        segments: native.segments,
    })
}

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportTiming {
    pub elapsed_seconds: f64,
    pub estimated_total_seconds: Option<f64>,
    pub remaining_seconds: Option<f64>,
}

/// Estimate from completed audio work, never from the weighted UI percentage.
pub fn estimate_import_time(
    elapsed: Duration,
    inference_elapsed: Duration,
    completed_audio_seconds: f64,
    total_audio_seconds: f64,
) -> ImportTiming {
    let remaining_seconds = if completed_audio_seconds > 0.0 {
        Some(inference_elapsed.as_secs_f64()
            * (total_audio_seconds - completed_audio_seconds).max(0.0)
            / completed_audio_seconds)
    } else {
        None
    };
    ImportTiming {
        elapsed_seconds: elapsed.as_secs_f64(),
        estimated_total_seconds: remaining_seconds.map(|remaining| elapsed.as_secs_f64() + remaining),
        remaining_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_record_import_time_is_unknown_before_the_first_completed_chunk() {
        let timing = estimate_import_time(Duration::from_secs(20), Duration::ZERO, 0.0, 3600.0);
        assert!(timing.estimated_total_seconds.is_none());
        assert!(timing.remaining_seconds.is_none());
    }

    #[test]
    fn stream_record_import_time_uses_audio_work_and_includes_preparation() {
        let timing = estimate_import_time(Duration::from_secs(140), Duration::from_secs(120), 300.0, 900.0);
        assert!((timing.remaining_seconds.unwrap() - 240.0).abs() < 0.001);
        assert!((timing.estimated_total_seconds.unwrap() - 380.0).abs() < 0.001);
    }

    #[test]
    fn stream_record_import_time_updates_with_speed_and_never_goes_negative() {
        let timing = estimate_import_time(Duration::from_secs(170), Duration::from_secs(150), 600.0, 900.0);
        assert!((timing.remaining_seconds.unwrap() - 75.0).abs() < 0.001);
        let done = estimate_import_time(Duration::from_secs(200), Duration::from_secs(180), 910.0, 900.0);
        assert!(done.remaining_seconds.unwrap().abs() < 0.001);
    }
}

//! Explicit test-only capture exception. All filesystem isolation remains active.
use std::io;

const INPUT: &str = "Stereo Mix(Realtek(R) Audio)";

fn allowed_capture(
    enabled: bool,
    nonce: Option<&str>,
    approval: Option<&str>,
    command: &str,
    payload: &serde_json::Value,
) -> bool {
    enabled
        && nonce.is_some_and(|value| {
            value.len() == 32
                && value.bytes().all(|c| c.is_ascii_hexdigit())
                && approval == Some(value)
        })
        && command == "ko_start_recording"
        && payload.get("micName").and_then(serde_json::Value::as_str) == Some(INPUT)
}

pub fn check_command(command: &str, payload: &serde_json::Value) -> io::Result<()> {
    if ["download", "install", "permission", "trigger_audio"]
        .iter().any(|part| command.contains(part))
    {
        return Err(super::denied("Permission requests and downloads are disabled in review mode"));
    }
    if command.contains("start_recording") {
        super::context()?;
        let nonce = std::env::var("STREAM_RECORD_REVIEW_NONCE").ok();
        let approval = std::env::var("STREAM_RECORD_REVIEW_CAPTURE_NONCE").ok();
        if !allowed_capture(
            cfg!(feature = "review-capture-validation"),
            nonce.as_deref(), approval.as_deref(), command, payload,
        ) {
            return Err(super::denied("Review capture requires the separate validation build, matching capture nonce, and exact Stereo Mix input"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const NONCE: &str = "0123456789abcdef0123456789abcdef";
    fn payload() -> serde_json::Value { serde_json::json!({"micName": INPUT}) }

    #[test]
    fn capture_requires_explicit_build_and_matching_nonce() {
        assert!(allowed_capture(true, Some(NONCE), Some(NONCE), "ko_start_recording", &payload()));
        assert!(!allowed_capture(false, Some(NONCE), Some(NONCE), "ko_start_recording", &payload()));
        for (nonce, approval) in [(None, None), (Some(NONCE), None), (Some(NONCE), Some("wrong")), (Some(""), Some(""))] {
            assert!(!allowed_capture(true, nonce, approval, "ko_start_recording", &payload()));
        }
    }

    #[test]
    fn capture_rejects_default_microphone_and_legacy_routes() {
        for value in [serde_json::json!({}), serde_json::json!({"micName": null}), serde_json::json!({"micName": "Microphone (Realtek(R) Audio)"})] {
            assert!(!allowed_capture(true, Some(NONCE), Some(NONCE), "ko_start_recording", &value));
        }
        for command in ["start_recording", "start_recording_with_devices", "start_recording_with_devices_and_meeting"] {
            assert!(!allowed_capture(true, Some(NONCE), Some(NONCE), command, &payload()));
        }
    }

    #[test]
    fn capture_exception_keeps_other_restrictions_and_stop_available() {
        for command in ["whisper_download_model", "trigger_microphone_permission", "install_model", "trigger_audio"] {
            assert!(check_command(command, &payload()).is_err());
        }
        for command in ["ko_stop_recording", "ko_poll_live_diarization", "ko_list_records"] {
            assert!(check_command(command, &payload()).is_ok());
        }
    }
}

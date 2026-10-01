use super::*;

#[test]
fn preserves_overlapping_speakers_from_native_output() {
    let json = br#"{"file":"meeting.wav","segments":[{"start":0.2,"end":2.1,"speaker":1},{"start":1.9,"end":3.0,"speaker":2}]}"#;
    let result = parse_output(json, 3.0).expect("valid native output");
    assert_eq!(result.segments.len(), 2);
    assert_eq!(result.segments[1].speaker, 2);
    assert!(result.segments[0].end > result.segments[1].start);
}

#[test]
fn rejects_invalid_speaker_time_and_duration_boundaries() {
    for segment in [
        r#"{"start":0,"end":1,"speaker":0}"#,
        r#"{"start":0,"end":1,"speaker":9}"#,
        r#"{"start":-1,"end":1,"speaker":1}"#,
        r#"{"start":2,"end":1,"speaker":1}"#,
        r#"{"start":0,"end":4,"speaker":1}"#,
    ] {
        let json = format!(r#"{{"file":"a.wav","segments":[{segment}]}}"#);
        assert!(parse_output(json.as_bytes(), 3.0).is_err());
    }
}

#[test]
fn silence_is_an_empty_result_not_an_invented_speaker() {
    let result =
        parse_output(br#"{"file":"a.wav","segments":[]}"#, 3.0).expect("silence has no speakers");
    assert!(result.segments.is_empty());
}

#[tokio::test]
async fn cancelled_request_never_launches_a_runtime() {
    let cancel = tokio_util::sync::CancellationToken::new();
    cancel.cancel();
    let request = DiarizationRequest {
        audio_path: std::path::PathBuf::from("absent.wav"),
        duration_seconds: 3.0,
        runtime_dir: std::path::PathBuf::from("absent-runtime"),
    };
    assert!(matches!(
        run(&request, &cancel).await,
        Err(DiarizationError::Cancelled)
    ));
}

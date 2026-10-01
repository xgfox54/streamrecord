//! Opt-in same-audio baseline using independent published references, not microphone input.
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reference {
    id: String,
    audio_path: PathBuf,
    audio_sha256: String,
    duration_seconds: f64,
}

#[cfg(all(target_os = "windows", feature = "cuda"))]
#[tokio::test]
#[ignore = "requires explicitly prepared public corpus and bundled CUDA Whisper model"]
async fn stream_record_whisper_public_quality_baseline() {
    let directory = PathBuf::from(
        std::env::var_os("STREAM_RECORD_QUALITY_DIR").expect("isolated quality directory"),
    );
    let references: Vec<Reference> = serde_json::from_slice(
        &std::fs::read(directory.join("references.json")).expect("prepared reference manifest"),
    )
    .expect("valid independent references");
    assert_eq!(references.len(), 3, "bounded published FLEURS smoke corpus");
    assert!(
        whisper_rs::SystemInfo::default().cuda,
        "CUDA compilation required"
    );
    let temporary = tempfile::tempdir().expect("isolated model directory");
    crate::bundled_whisper::ensure_from_paths(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR")),
        temporary.path(),
    )
    .await
    .expect("verified bundled model");
    let engine = crate::whisper_engine::WhisperEngine::new_with_models_dir(Some(
        temporary.path().to_path_buf(),
    ))
    .expect("native engine");
    engine.discover_models().await.expect("model discovery");
    engine
        .load_model(crate::bundled_whisper::DEFAULT_MODEL)
        .await
        .expect("real CUDA model load");
    let mut runs = Vec::new();
    for reference in references {
        let bytes = std::fs::read(&reference.audio_path).expect("public audio");
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            reference.audio_sha256,
            "audio identity"
        );
        let decoded =
            crate::audio::decoder::decode_audio_file(&reference.audio_path).expect("audio decode");
        assert!(
            (decoded.duration_seconds - reference.duration_seconds).abs() < 0.02,
            "reference duration"
        );
        let samples = decoded.to_whisper_format();
        let started = Instant::now();
        let transcript = engine
            .transcribe_audio_with_prompt(samples, Some("ko".to_string()), None)
            .await
            .expect("native transcription");
        let elapsed = started.elapsed().as_secs_f64();
        assert!(!transcript.text.trim().is_empty());
        runs.push(json!({"id":reference.id,"audioSha256":reference.audio_sha256,"engine":"native-whisper-cuda-G0","model":"small-q5_1","text":transcript.text,"elapsedSeconds":elapsed,"firstPartialMs":null,"committedMs":null,"peakRamMiB":null,"peakVramMiB":null}));
    }
    assert!(engine.unload_model().await);
    std::fs::write(
        directory.join("native-whisper-runs.json"),
        serde_json::to_vec_pretty(&runs).expect("run JSON"),
    )
    .expect("write actual inference results");
    println!("PUBLIC_WHISPER_QUALITY_INFERENCE_VERIFIED samples={} engine=native-whisper-cuda model=small-q5_1 mode=offline-whole-clip glossary=none", runs.len());
}

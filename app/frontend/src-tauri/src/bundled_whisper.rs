//! Offline bootstrap for the Whisper model shipped inside the installer (MIT).
//! This module performs no HTTP requests and never replaces an existing model.
use crate::whisper_engine::model_integrity::{expected_sha256, verify_digest, MAX_MODEL_BYTES};
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, Runtime};
use crate::review_paths::async_fs as fs;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::Mutex};

pub const DEFAULT_MODEL: &str = "small-q5_1";

pub fn models_dir(app_data_dir: &Path) -> PathBuf {
    let legacy = app_data_dir.join("models");
    let Some(roaming) = app_data_dir.parent() else {
        return legacy;
    };
    let current = roaming.join("Stream-Record").join("models");
    if current.exists() {
        return current;
    }
    if legacy.is_dir() {
        match current.parent() {
            Some(parent)
                if crate::review_paths::fs::create_dir_all(parent).is_ok()
                    && crate::review_paths::fs::rename(&legacy, &current).is_ok() =>
            {
                current
            }
            _ => legacy,
        }
    } else {
        current
    }
}
pub const MODEL_FILENAME: &str = "ggml-small-q5_1.bin";
static PREPARING: Mutex<()> = Mutex::const_new(());
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

async fn verify_regular(path: &Path, expected: &str) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .await
        .context("음성 모델 파일을 찾을 수 없습니다")?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_MODEL_BYTES {
        bail!("음성 모델은 크기가 유효한 일반 파일이어야 합니다");
    }
    let mut file = fs::open_file(path).await?;
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut hash = Sha256::new();
    let mut count = 0u64;
    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > MAX_MODEL_BYTES {
            bail!("음성 모델 크기 한도 초과");
        }
        hash.update(&buffer[..n]);
    }
    if count != metadata.len() {
        bail!("검증 중 모델 파일 크기가 변경되었습니다");
    }
    verify_digest(expected, &format!("{:x}", hash.finalize()))
}

/// Returns true only when a new, verified model was installed. Existing files are preserved.
async fn copy_verified(source: &Path, destination: &Path, expected: &str) -> Result<bool> {
    match fs::symlink_metadata(destination).await {
        Ok(_) => {
            verify_regular(destination, expected).await?;
            return Ok(false);
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    verify_regular(source, expected)
        .await
        .context("동봉 한국어 모델 검증 실패. 모델 포함 설치파일로 복구하세요")?;
    let parent = destination
        .parent()
        .context("모델 저장 경로가 올바르지 않습니다")?;
    fs::create_dir_all(parent).await?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temp = parent.join(format!(
        ".stream-record-model-{}-{stamp}-{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    // create_new prevents accidentally truncating another writer's temporary file.
    let mut writer = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .await?;
    let result: Result<bool> = async {
        let mut reader = fs::open_file(source).await?.take(MAX_MODEL_BYTES + 1);
        let count = tokio::io::copy(&mut reader, &mut writer).await?;
        writer.flush().await?;
        writer.sync_all().await?;
        drop(writer);
        if count == 0 || count > MAX_MODEL_BYTES {
            bail!("동봉 모델 복사 크기 오류");
        }
        verify_regular(&temp, expected).await?;
        // Atomic, no-clobber publication. Both paths are in the user's model directory.
        // Never use a replacing rename or remove the existing destination.
        match fs::hard_link(&temp, destination).await {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                verify_regular(destination, expected).await?;
                Ok(false)
            }
            Err(e) => Err(e).context("모델 안전 등록 실패. 저장 공간 및 파일시스템을 확인하세요"),
        }
    }
    .await;
    // Only this invocation's exclusively-created staging file may be removed.
    let _ = fs::remove_file(&temp).await;
    result
}

pub async fn ensure_from_paths(resource_dir: &Path, models_dir: &Path) -> Result<PathBuf> {
    let _lock = PREPARING.lock().await;
    let destination = models_dir.join(MODEL_FILENAME);
    let source = resource_dir.join("bundled-models").join(MODEL_FILENAME);
    copy_verified(&source, &destination, expected_sha256(DEFAULT_MODEL)?).await?;
    Ok(destination)
}

#[tauri::command]
pub async fn ko_prepare_bundled_whisper<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let models = models_dir(&app.path().app_data_dir().map_err(|e| e.to_string())?);
    ensure_from_paths(&resources, &models).await
        .map(|_| DEFAULT_MODEL.to_string())
        .map_err(|e| format!("동봉 한국어 모델 준비 실패. 인터넷 다운로드는 시도하지 않았고 기존 모델은 보존했습니다. {e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn digest(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }
    #[tokio::test]
    async fn stream_record_bundle_bootstraps_offline_and_reuses_without_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.bin");
        let dest = dir.path().join("models/model.bin");
        let data = b"verified-model-fixture";
        fs::write(&source, data).await.unwrap();
        assert!(copy_verified(&source, &dest, &digest(data)).await.unwrap());
        fs::remove_file(&source).await.unwrap();
        assert!(!copy_verified(&source, &dest, &digest(data)).await.unwrap());
        assert_eq!(fs::read(&dest).await.unwrap(), data);
    }
    #[tokio::test]
    async fn stream_record_bundle_corrupt_source_is_not_published() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.bin");
        let dest = dir.path().join("model.bin");
        fs::write(&source, b"wrong").await.unwrap();
        assert!(copy_verified(&source, &dest, &digest(b"right"))
            .await
            .is_err());
        assert!(!dest.exists());
        assert!(source.exists());
    }
    #[tokio::test]
    async fn stream_record_bundle_never_overwrites_existing_invalid_model() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.bin");
        let dest = dir.path().join("model.bin");
        fs::write(&source, b"right").await.unwrap();
        fs::write(&dest, b"existing").await.unwrap();
        assert!(copy_verified(&source, &dest, &digest(b"right"))
            .await
            .is_err());
        assert_eq!(fs::read(&dest).await.unwrap(), b"existing");
    }
    #[tokio::test]
    async fn stream_record_bundle_missing_source_does_not_create_model() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("model.bin");
        assert!(
            copy_verified(&dir.path().join("missing.bin"), &dest, &digest(b"right"))
                .await
                .is_err()
        );
        assert!(!dest.exists());
    }
    #[tokio::test]
    #[ignore = "Requires the bundled 190MB model; opt-in offline integration test, no microphone or network"]
    async fn stream_record_bundled_real_model_loads_offline() {
        assert_eq!(
            std::env::var("STREAM_RECORD_BUNDLED_TEST").as_deref(),
            Ok("1")
        );
        let resources = std::env::var_os("STREAM_RECORD_BUNDLE_TEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        let dir = tempfile::tempdir().unwrap();
        let model = ensure_from_paths(&resources, dir.path()).await.unwrap();
        assert!(model.exists());
        let engine = crate::whisper_engine::WhisperEngine::new_with_models_dir(Some(
            dir.path().to_path_buf(),
        ))
        .unwrap();
        engine.discover_models().await.unwrap();
        engine
            .load_model(DEFAULT_MODEL)
            .await
            .expect("Bundled model is not loadable by the shipped Whisper engine");
        println!(
            "BUNDLED_MODEL_OFFLINE_VERIFIED model=small-q5_1 sha256=true load=true network=false"
        );
    }

    #[cfg(all(target_os = "windows", feature = "vulkan"))]
    #[tokio::test]
    #[ignore = "Opt-in real Vulkan/CPU comparison with a verified local model and public WAV fixture"]
    async fn stream_record_vulkan_real_inference() {
        use std::time::Instant;
        assert_eq!(std::env::var("STREAM_RECORD_ACCEL_TEST").as_deref(), Ok("1"));
        let gpu = match std::env::var("STREAM_RECORD_ACCEL_TEST_MODE").as_deref() {
            Ok("gpu") => true,
            Ok("cpu") => false,
            _ => panic!("STREAM_RECORD_ACCEL_TEST_MODE must be gpu or cpu"),
        };
        let models = PathBuf::from(std::env::var_os("STREAM_RECORD_ACCEL_TEST_MODELS").expect("model directory required"));
        let audio = PathBuf::from(std::env::var_os("STREAM_RECORD_ACCEL_TEST_AUDIO").expect("public WAV fixture required"));
        let engine = crate::whisper_engine::WhisperEngine::new_with_models_dir(Some(models)).unwrap();
        engine.discover_models().await.unwrap();
        engine.load_model_with_gpu(DEFAULT_MODEL, gpu).await.unwrap();
        let status = engine.acceleration_status().await.unwrap();
        assert_eq!(status.backend, "Vulkan");
        assert_eq!(status.gpu_requested, gpu);
        assert!(!status.cpu_fallback);
        let decoded = crate::audio::decoder::decode_audio_file(&audio).unwrap();
        let duration = decoded.duration_seconds;
        let started = Instant::now();
        let result = engine.transcribe_audio_with_result(decoded.to_whisper_format(), Some("ko".to_string())).await.unwrap();
        let elapsed = started.elapsed().as_secs_f64();
        assert!(!result.text.trim().is_empty());
        println!("ACCEL_INFERENCE_VERIFIED mode={} backend=Vulkan model=small-q5_1 audio_seconds={:.3} inference_seconds={:.3} rtf={:.4} transcript_chars={}", if gpu { "gpu" } else { "cpu" }, duration, elapsed, elapsed / duration, result.text.chars().count());
    }

    #[cfg(all(target_os = "windows", feature = "cuda"))]
    #[tokio::test]
    #[ignore = "Requires the bundled model, a real WAV fixture and an NVIDIA CUDA device"]
    async fn stream_record_bundled_real_cuda_inference() {
        use std::process::Command;
        use std::time::Instant;

        assert_eq!(std::env::var("STREAM_RECORD_CUDA_TEST").as_deref(), Ok("1"));
        let audio_path = PathBuf::from(
            std::env::var_os("STREAM_RECORD_CUDA_TEST_AUDIO")
                .expect("STREAM_RECORD_CUDA_TEST_AUDIO is required"),
        );
        let native = whisper_rs::SystemInfo::default();
        assert!(native.cuda, "whisper.cpp was not compiled with CUDA");

        let resources = std::env::var_os("STREAM_RECORD_BUNDLE_TEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        let dir = tempfile::tempdir().unwrap();
        ensure_from_paths(&resources, dir.path()).await.unwrap();
        let gpu_memory_mb = || {
            let output = Command::new("nvidia-smi.exe")
                .args(["--query-gpu=memory.used", "--format=csv,noheader,nounits"])
                .output()
                .expect("nvidia-smi GPU memory query failed");
            assert!(output.status.success());
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| line.trim().parse::<u64>().ok())
                .expect("nvidia-smi did not report GPU memory")
        };
        let gpu_memory_before_mb = gpu_memory_mb();
        let engine = crate::whisper_engine::WhisperEngine::new_with_models_dir(Some(
            dir.path().to_path_buf(),
        ))
        .unwrap();
        engine.discover_models().await.unwrap();
        engine.load_model(DEFAULT_MODEL).await.unwrap();
        let gpu_memory_after_mb = gpu_memory_mb();

        let process_id = std::process::id().to_string();
        let compute = Command::new("nvidia-smi.exe")
            .args([
                "--query-compute-apps=pid,used_gpu_memory",
                "--format=csv,noheader,nounits",
            ])
            .output()
            .expect("nvidia-smi compute query failed");
        assert!(compute.status.success());
        let process_vram_mb = String::from_utf8_lossy(&compute.stdout)
            .lines()
            .filter_map(|line| {
                let mut fields = line.split(',').map(str::trim);
                (fields.next()? == process_id).then(|| fields.next()?.parse::<u64>().ok())?
            })
            .max();
        let used_vram_mb = process_vram_mb
            .unwrap_or_else(|| gpu_memory_after_mb.saturating_sub(gpu_memory_before_mb));
        assert!(used_vram_mb > 0);

        let decoded = crate::audio::decoder::decode_audio_file(&audio_path).unwrap();
        let duration_seconds = decoded.duration_seconds;
        let samples = decoded.to_whisper_format();
        let started = Instant::now();
        let result = engine
            .transcribe_audio_with_result(samples, Some("ko".to_string()))
            .await
            .unwrap();
        let inference_seconds = started.elapsed().as_secs_f64();
        assert!(
            !result.text.trim().is_empty(),
            "CUDA inference returned no text"
        );
        let rtf = inference_seconds / duration_seconds;
        println!(
            "CUDA_INFERENCE_VERIFIED compiled=cuda requested=cuda effective=cuda model=small-q5_1 gpu_vram_mb={} audio_seconds={:.3} inference_seconds={:.3} rtf={:.4} transcript_chars={}",
            used_vram_mb,
            duration_seconds,
            inference_seconds,
            rtf,
            result.text.chars().count()
        );
    }
}

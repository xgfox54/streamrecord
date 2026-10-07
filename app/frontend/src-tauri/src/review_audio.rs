//! Explicitly selected/recorded local audio review and bounded recovery (MIT).
//! No network input, model download, overwrite of recordings, or remote inference.
use once_cell::sync::Lazy;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::AsyncReadExt;

#[derive(Clone)]
struct AuthorizedFile {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
}
static FILES: Lazy<Mutex<HashMap<String, AuthorizedFile>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RUNNING: AtomicBool = AtomicBool::new(false);
struct RunGuard;
impl Drop for RunGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Internal only: invoked after a native picker selection or successful recording.
/// There is intentionally no IPC command that grants access to an arbitrary path.
pub fn register(path: &Path) -> Result<(), String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("재생 가능한 음성 파일이 없습니다.".into());
    }
    let key = path.to_string_lossy().into_owned();
    let file = AuthorizedFile {
        path,
        size: metadata.len(),
        modified: metadata.modified().map_err(|e| e.to_string())?,
    };
    FILES
        .lock()
        .map_err(|_| "음성 파일 권한 잠금 오류".to_string())?
        .insert(key, file);
    Ok(())
}
fn authorized(path: &str) -> Result<AuthorizedFile, String> {
    let canonical = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    let file = FILES.lock().map_err(|_| "음성 파일 권한 잠금 오류".to_string())?
        .get(canonical.to_string_lossy().as_ref()).cloned()
        .ok_or("앱에서 원본 음성 파일을 다시 선택하세요. 저장된 경로만으로 접근 권한을 부여하지 않습니다.")?;
    let meta = canonical.metadata().map_err(|e| e.to_string())?;
    if meta.len() != file.size || meta.modified().map_err(|e| e.to_string())? != file.modified {
        return Err("선택한 뒤 음성 파일이 변경되었습니다. 원본을 다시 선택하세요.".into());
    }
    Ok(file)
}

#[derive(Serialize)]
pub struct ReviewAudio {
    pub path: String,
    pub filename: String,
    pub duration_seconds: f64,
    pub sha256: String,
}
#[tauri::command]
pub async fn ko_open_review_audio<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<ReviewAudio, String> {
    let file = authorized(&path)?;
    let target = file.path.clone();
    let info =
        tokio::task::spawn_blocking(move || crate::audio::import::validate_audio_file(&target))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    if !info.duration_seconds.is_finite()
        || info.duration_seconds <= 0.0
        || info.duration_seconds > 86400.0
    {
        return Err("음성 길이를 확인하지 못했거나 24시간을 초과합니다.".into());
    }
    let mut source = crate::review_paths::async_fs::open_file(&file.path)
        .await
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![0; 1024 * 1024];
    let mut hash = Sha256::new();
    loop {
        let n = source.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    authorized(&path)?;
    app.asset_protocol_scope()
        .allow_file(&file.path)
        .map_err(|e| e.to_string())?;
    Ok(ReviewAudio {
        path: file.path.to_string_lossy().into_owned(),
        filename: info.filename,
        duration_seconds: info.duration_seconds,
        sha256: format!("{:x}", hash.finalize()),
    })
}

pub fn checked_window(start: f64, duration: f64) -> Result<(), String> {
    if !start.is_finite()
        || !duration.is_finite()
        || start < 0.0
        || start >= 86400.0
        || duration <= 0.0
        || duration > 24.0
        || start + duration > 86400.0
    {
        return Err("받아쓰기 복구 구간 범위가 올바르지 않습니다.".into());
    }
    Ok(())
}
#[derive(Serialize)]
pub struct RecoveredWindow {
    pub text: String,
    pub audio_start_time: f64,
    pub audio_end_time: f64,
    pub is_partial: bool,
}

#[tauri::command]
pub async fn ko_transcribe_review_window(
    path: String,
    start: f64,
    duration: f64,
    model: String,
) -> Result<RecoveredWindow, String> {
    checked_window(start, duration)?;
    if crate::audio::recording_commands::is_recording().await
        || crate::audio::import::is_import_in_progress()
    {
        return Err("진행 중인 녹음·파일 받아쓰기를 먼저 완료하세요.".into());
    }
    RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "이미 음성 복구 구간을 처리 중입니다.".to_string())?;
    let _guard = RunGuard;
    let file = authorized(&path)?;
    crate::whisper_engine::model_integrity::expected_sha256(&model).map_err(|e| e.to_string())?;
    let engine = {
        crate::whisper_engine::commands::WHISPER_ENGINE
            .lock()
            .map_err(|_| "모델 잠금 오류".to_string())?
            .as_ref()
            .cloned()
            .ok_or("한국어 음성 모델을 먼저 준비하세요.")?
    };
    if engine.get_current_model().await.as_deref() != Some(model.as_str()) {
        return Err("복구 작업 도중 음성 모델이 변경됐습니다. 같은 모델로 다시 시작하세요.".into());
    }
    let ffmpeg =
        crate::audio::ffmpeg::find_ffmpeg_path().ok_or("동봉된 ffmpeg를 찾지 못했습니다.")?;
    let mut command = tokio::process::Command::new(ffmpeg);
    command
        .args([
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-ss",
            &format!("{start:.6}"),
            "-i",
        ])
        .arg(&file.path)
        .args([
            "-t",
            &format!("{duration:.6}"),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|e| format!("음성 구간 추출 실패: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("음성 출력 파이프를 열지 못했습니다.")?;
    let max_bytes = 24 * 16000 * 4 + 4;
    let mut data = Vec::new();
    tokio::time::timeout(
        Duration::from_secs(60),
        stdout.take(max_bytes).read_to_end(&mut data),
    )
    .await
    .map_err(|_| "음성 구간 추출 시간 초과".to_string())?
    .map_err(|e| e.to_string())?;
    if data.len() >= max_bytes as usize {
        return Err("음성 추출 크기 한도를 초과했습니다.".into());
    }
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
        .await
        .map_err(|_| "음성 변환 프로세스 종료 시간 초과".to_string())?
        .map_err(|e| e.to_string())?;
    if !status.success() || data.is_empty() || data.len() % 4 != 0 {
        return Err(
            "음성 구간을 정상적으로 추출하지 못했습니다. 완료 구간으로 저장하지 않았습니다.".into(),
        );
    }
    let samples: Vec<f32> = data
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    if samples.iter().any(|sample| !sample.is_finite()) {
        return Err("음성에 비정상 샘플이 있습니다.".into());
    }
    let end = start + samples.len() as f64 / 16000.0;
    // Only exact digital silence is skipped; quiet speech is never RMS-filtered here.
    let text = if samples.iter().all(|sample| *sample == 0.0) {
        String::new()
    } else {
        engine
            .transcribe_audio_with_result(samples, Some("ko".into()))
            .await
            .map_err(|e| e.to_string())?
            .text
    };
    authorized(&path)?;
    Ok(RecoveredWindow {
        text,
        audio_start_time: start,
        audio_end_time: end,
        is_partial: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stream_record_recovery_window_has_finite_bounded_coordinates() {
        assert!(checked_window(0.0, 24.0).is_ok());
        assert!(checked_window(86400.0 - 0.5, 0.5).is_ok());
        for (start, duration) in [
            (f64::NAN, 1.0),
            (0.0, f64::INFINITY),
            (-1.0, 1.0),
            (0.0, 25.0),
            (0.0, 0.0),
            (86399.0, 2.0),
        ] {
            assert!(checked_window(start, duration).is_err());
        }
    }
    #[test]
    fn stream_record_review_requires_native_file_authorization() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        crate::review_paths::fs::write(temp.path(), b"not-a-real-recording").unwrap();
        assert!(authorized(temp.path().to_str().unwrap()).is_err());
        register(temp.path()).unwrap();
        assert!(authorized(temp.path().to_str().unwrap()).is_ok());
        crate::review_paths::fs::write(temp.path(), b"changed").unwrap();
        assert!(authorized(temp.path().to_str().unwrap()).is_err());
    }
}

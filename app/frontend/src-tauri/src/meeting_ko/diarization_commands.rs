//! Authorized saved-audio diarization IPC. Original audio and transcripts stay immutable.
use super::diarization::{self, DiarizationRequest, DiarizationResult};
use serde::Serialize;
use std::{process::Stdio, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager, Runtime};
use tokio_util::sync::CancellationToken;

static RUNNING: Mutex<Option<CancellationToken>> = Mutex::new(None);
struct RunGuard;
impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut running) = RUNNING.lock() {
            *running = None;
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDiarization {
    pub audio_sha256: String,
    pub duration_seconds: f64,
    #[serde(flatten)]
    pub result: DiarizationResult,
}

#[tauri::command]
pub fn ko_cancel_diarization() -> Result<(), String> {
    let running = RUNNING.lock().map_err(|_| "화자분리 상태 잠금 오류")?;
    if let Some(token) = running.as_ref() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn ko_run_diarization<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    expected_sha256: String,
) -> Result<AudioDiarization, String> {
    let _transition = super::RECORDING_TRANSITION
        .try_lock()
        .map_err(|_| "녹음 상태가 변경 중입니다. 잠시 기다려 주세요.")?;
    if crate::audio::recording_commands::is_recording().await
        || crate::audio::import::is_import_in_progress()
    {
        return Err("진행 중인 녹음·파일 전사를 먼저 완료하세요.".into());
    }
    let _import_guard = crate::audio::import::ImportGuard::acquire()?;
    let cancel = CancellationToken::new();
    {
        let mut running = RUNNING.lock().map_err(|_| "화자분리 상태 잠금 오류")?;
        if running.is_some() {
            return Err("이미 화자분리 중입니다.".into());
        }
        *running = Some(cancel.clone());
    }
    let _guard = RunGuard;
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("화자분리를 취소했습니다.".into()),
        result = tokio::time::timeout(Duration::from_secs(7200), analyze(&app, &path, &expected_sha256)) => {
            result.map_err(|_| "화자분리 제한 시간을 초과했습니다.".to_string())?
        }
    }
}

async fn analyze<R: Runtime>(
    app: &AppHandle<R>,
    path: &str,
    expected_sha256: &str,
) -> Result<AudioDiarization, String> {
    let audio = crate::review_audio::ko_open_review_audio(app.clone(), path.to_owned()).await?;
    if audio.sha256 != expected_sha256 {
        return Err("대화의 원본 음성과 선택한 파일이 다릅니다. 원본을 다시 선택하세요.".into());
    }
    let runtime_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("bundled-diarization");
    if !runtime_dir.join("nemo-speech.exe").is_file()
        || !runtime_dir.join(diarization::MODEL_FILE).is_file()
    {
        return Err(
            "Nemotron 화자분리 엔진이 동봉되지 않았습니다. 최신 설치본을 확인하세요.".into(),
        );
    }
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|e| e.to_string())?;
    let temp = tempfile::Builder::new()
        .prefix("diarization-")
        .tempdir_in(cache)
        .map_err(|e| e.to_string())?;
    let wav = temp.path().join("audio.wav");
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
            "-i",
        ])
        .arg(&audio.path)
        .args([
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
        ])
        .arg(&wav)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let status = tokio::time::timeout(Duration::from_secs(600), command.status())
        .await
        .map_err(|_| "화자분리용 음성 변환 시간 초과")?
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("화자분리용 음성을 변환하지 못했습니다. 원본은 변경하지 않았습니다.".into());
    }
    let wav_info_path = wav.clone();
    let info = tokio::task::spawn_blocking(move || {
        crate::audio::import::validate_audio_file(&wav_info_path)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let request = DiarizationRequest {
        audio_path: wav,
        duration_seconds: info.duration_seconds,
        runtime_dir,
    };
    let result = diarization::run(&request, &CancellationToken::new())
        .await
        .map_err(|e| e.to_string())?;
    // Recheck the authorized source after processing; never attach stale audio identities.
    let after = crate::review_audio::ko_open_review_audio(app.clone(), path.to_owned()).await?;
    if after.sha256 != audio.sha256 {
        return Err("처리 중 원본 음성이 변경되어 화자분리 결과를 적용하지 않았습니다.".into());
    }
    Ok(AudioDiarization {
        audio_sha256: audio.sha256,
        duration_seconds: request.duration_seconds,
        result,
    })
}

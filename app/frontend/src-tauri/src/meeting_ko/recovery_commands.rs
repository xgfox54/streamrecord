use crate::audio::transcription::{queue::recovery, queue_runner as runner};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn ko_list_transcription_recovery() -> Result<Vec<recovery::RecoverySession>, String> {
    let mut sessions =
        recovery::discover(&recovery::persistent_root()).map_err(|e| e.to_string())?;
    sessions.extend(
        recovery::discover(&std::env::temp_dir().join("stream-record"))
            .map_err(|e| e.to_string())?,
    );
    Ok(sessions
        .into_iter()
        .filter(|s| {
            s.pending + s.failed + s.deferred + s.cancelled + s.result_count + s.partial_writes > 0
                || s.inspection_error.is_some()
        })
        .collect())
}

fn owned_directory(directory: &str) -> Result<PathBuf, String> {
    let path = Path::new(directory)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let root = recovery::persistent_root()
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if path.parent() != Some(root.as_path())
        || !path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("transcription-spool-"))
    {
        return Err("Stream-Record의 복구 대기열만 열 수 있습니다.".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn ko_resume_transcription_recovery<R: Runtime>(
    app: AppHandle<R>,
    directory: String,
    retry_failed: bool,
) -> Result<runner::RecoveryResult, String> {
    let _transition = super::RECORDING_TRANSITION
        .try_lock()
        .map_err(|_| "녹음 작업이 진행 중입니다.".to_owned())?;
    if crate::audio::recording_commands::is_recording().await {
        return Err("녹음을 중지한 뒤 미처리 음성을 복구하세요.".into());
    }
    let _import_guard = crate::audio::import::ImportGuard::acquire()
        .map_err(|_| "파일 가져오기 또는 음성 분석 작업이 진행 중입니다.".to_owned())?;
    let path = owned_directory(&directory)?;
    crate::set_language_preference("ko".to_string()).await?;
    runner::resume_session(&app, &path, retry_failed)
        .await
        .map_err(|e| e.to_string())
}

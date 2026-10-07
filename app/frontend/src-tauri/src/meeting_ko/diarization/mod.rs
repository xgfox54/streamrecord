//! Offline local Nemotron 3 diarization; speaker identities share one recording cache.
mod contract;
#[cfg(test)]
mod tests;

pub use contract::{parse_output, DiarizationResult};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
use tokio_util::sync::CancellationToken;

pub const MODEL_FILE: &str = "Nemotron-3-Diarization.q8_0.gguf";
pub const MODEL_SHA256: &str = "08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1";
pub const MODEL_ID: &str = "nvidia/Nemotron-3-Diarization";
pub const MODEL_REVISION: &str = "f667ed73aee57d40cc39428eb768b4fd87a0a29e";
pub const ENGINE_REVISION: &str = "4c101bc7113f49101a3e11d2c994c519f41939f6";

pub struct DiarizationRequest {
    pub audio_path: PathBuf,
    pub duration_seconds: f64,
    pub runtime_dir: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum DiarizationError {
    #[error("참여자 구분을 취소했습니다.")]
    Cancelled,
    #[error("참여자 구분 엔진 또는 모델을 찾을 수 없습니다. 설치 상태를 확인해 주세요.")]
    Unavailable,
    #[error("참여자 구분 모델의 무결성 검사에 실패했습니다.")]
    ModelIntegrity,
    #[error("참여자를 구분할 저장 WAV 음성과 유효한 길이가 필요합니다.")]
    InvalidAudio,
    #[error("참여자 구분 엔진 실행에 실패했습니다 (종료 코드 {0:?}).")]
    EngineExit(Option<i32>),
    #[error("참여자 구분 제한 시간을 초과했습니다.")]
    Timeout,
    #[error("참여자 구분 결과에 유효하지 않은 시간 또는 참여자 번호가 포함되어 있습니다.")]
    InvalidSegments,
    #[error("참여자 구분 파일 처리 오류: {0}")]
    Io(#[from] std::io::Error),
    #[error("참여자 구분 결과 형식 오류: {0}")]
    Json(#[from] serde_json::Error),
}

/// Cancellation drops the child future and kills the isolated native process.
/// The caller provides a completed WAV and its actual PCM duration, never transcript text.
pub async fn run(
    request: &DiarizationRequest,
    cancel: &CancellationToken,
) -> Result<DiarizationResult, DiarizationError> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(DiarizationError::Cancelled),
        result = tokio::time::timeout(Duration::from_secs(7200), execute(request)) => {
            result.map_err(|_| DiarizationError::Timeout)?
        }
    }
}

async fn execute(request: &DiarizationRequest) -> Result<DiarizationResult, DiarizationError> {
    if !request.duration_seconds.is_finite()
        || request.duration_seconds <= 0.0
        || request.duration_seconds > 86400.0
        || !request.audio_path.is_file()
    {
        return Err(DiarizationError::InvalidAudio);
    }
    let executable = request.runtime_dir.join("nemo-speech.exe");
    let model = request.runtime_dir.join(MODEL_FILE);
    if !executable.is_file() || !model.is_file() {
        return Err(DiarizationError::Unavailable);
    }
    let mut file = crate::review_paths::async_fs::open_file(&model).await?;
    let mut hasher = Sha256::new();
    let mut chunk = vec![0_u8; 65536];
    loop {
        let count = file.read(&mut chunk).await?;
        if count == 0 {
            break;
        }
        hasher.update(&chunk[..count]);
    }
    if format!("{:x}", hasher.finalize()) != MODEL_SHA256 {
        return Err(DiarizationError::ModelIntegrity);
    }
    let mut command = Command::new(executable);
    command
        .arg("diarize")
        .arg(&request.audio_path)
        .arg("--model")
        .arg(model)
        .args([
            "--backend",
            "cpu",
            "--preset",
            "v3-offline",
            "--format",
            "json",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // CREATE_NO_WINDOW prevents a console stealing focus in the desktop app.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().map_err(DiarizationError::Io)?;
    let stdout = child.stdout.take().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::BrokenPipe, "native output pipe missing")
    })?;
    let mut bytes = Vec::new();
    stdout
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(DiarizationError::InvalidSegments);
    }
    let status = child.wait().await?;
    if !status.success() {
        return Err(DiarizationError::EngineExit(status.code()));
    }
    parse_output(&bytes, request.duration_seconds)
}

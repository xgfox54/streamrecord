use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManifest {
    pub version: u32,
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySession {
    pub directory: PathBuf,
    pub session_id: Option<String>,
    pub recording_folder: Option<PathBuf>,
    pub pending: usize,
    pub failed: usize,
    pub deferred: usize,
    pub cancelled: usize,
    pub completed: usize,
    pub result_count: usize,
    pub partial_writes: usize,
    pub active: bool,
    pub legacy: bool,
    pub inspection_error: Option<String>,
}

impl RecoverySession {
    pub fn processing_complete(&self) -> bool {
        self.pending == 0
            && self.failed == 0
            && self.deferred == 0
            && self.cancelled == 0
            && self.partial_writes == 0
            && self.inspection_error.is_none()
    }
}

pub fn persistent_root() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("local.meetily.korean.workspace")
        .join("transcription-spool")
}

pub(crate) fn claim(root: &Path) -> Result<Arc<File>> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("owner.lock"))?;
    fs2::FileExt::try_lock_exclusive(&file)
        .context("다른 전사 작업이 이 복구 대기열을 사용 중입니다")?;
    Ok(Arc::new(file))
}

pub(crate) fn create(root: &Path, session_id: &str) -> Result<Arc<File>> {
    if session_id.is_empty() || session_id.len() > 256 {
        bail!("복구 세션 ID가 올바르지 않습니다");
    }
    let owner = claim(root)?;
    let manifest = SessionManifest {
        version: 1,
        session_id: session_id.to_owned(),
    };
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join("session.tmp"))?;
    file.write_all(&serde_json::to_vec(&manifest)?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(root.join("session.tmp"), root.join("session.json"))?;
    Ok(owner)
}

pub fn inspect(root: &Path) -> Result<RecoverySession> {
    let manifest_path = root.join("session.json");
    let session_id = if manifest_path.exists() {
        let manifest: SessionManifest = serde_json::from_reader(File::open(manifest_path)?)?;
        if manifest.version != 1 {
            bail!("지원하지 않는 전사 복구 형식입니다");
        }
        Some(manifest.session_id)
    } else {
        None
    };
    let active = match OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.join("owner.lock"))
    {
        Ok(file) => fs2::FileExt::try_lock_exclusive(&file).is_err(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    let recording_folder = match std::fs::read(root.join("recording-folder.json")) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let mut result = RecoverySession {
        recording_folder,
        inspection_error: None,
        directory: root.to_path_buf(),
        legacy: session_id.is_none(),
        session_id,
        pending: 0,
        failed: 0,
        deferred: 0,
        cancelled: 0,
        completed: 0,
        result_count: 0,
        partial_writes: 0,
        active,
    };
    for entry in std::fs::read_dir(root)? {
        let path = entry?.path();
        if path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().ends_with(".result.json"))
        {
            result.result_count += 1;
        }
        match path.extension().and_then(|s| s.to_str()) {
            Some("chunk") if !path.with_extension("done").exists() => result.pending += 1,
            Some("failed") => result.failed += 1,
            Some("deferred") => result.deferred += 1,
            Some("cancelled") => result.cancelled += 1,
            Some("done") => result.completed += 1,
            Some("tmp") => result.partial_writes += 1,
            _ => {}
        }
    }
    Ok(result)
}

/// Read-only discovery includes previous versions' temporary queues; it never retries them.
pub fn discover(root: &Path) -> Result<Vec<RecoverySession>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir()
            && entry
                .file_name()
                .to_string_lossy()
                .starts_with("transcription-spool-")
        {
            match inspect(&entry.path()) {
                Ok(session) => sessions.push(session),
                Err(error) => sessions.push(RecoverySession {
                    directory: entry.path(),
                    session_id: None,
                    recording_folder: None,
                    pending: 0,
                    failed: 0,
                    deferred: 0,
                    cancelled: 0,
                    completed: 0,
                    result_count: 0,
                    partial_writes: 0,
                    active: false,
                    legacy: true,
                    inspection_error: Some(error.to_string()),
                }),
            }
        }
    }
    sessions.sort_by(|a, b| a.directory.cmp(&b.directory));
    Ok(sessions)
}

pub(crate) fn prepare_retry(root: &Path, retry_failed: bool) -> Result<()> {
    for entry in std::fs::read_dir(root)? {
        let path = entry?.path();
        let eligible = match path.extension().and_then(|s| s.to_str()) {
            Some("deferred") => true,
            Some("failed" | "cancelled") => retry_failed,
            _ => false,
        };
        if eligible && !path.with_extension("done").exists() {
            let target = path.with_extension("chunk");
            if target.exists() {
                bail!("동일 구간의 복구 파일이 중복되어 있습니다");
            }
            std::fs::rename(path, target)?;
        }
    }
    Ok(())
}

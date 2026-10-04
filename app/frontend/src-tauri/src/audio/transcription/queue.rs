use crate::audio::recording_state::{AudioChunk, DeviceType};
use anyhow::{bail, Context, Result};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use crate::review_paths::async_fs as fs;
use tokio::{io::AsyncWriteExt, sync::{mpsc, Notify}};

const MAGIC: &[u8; 4] = b"SRQ1";
const HEADER_BYTES: usize = 4 + 4 + 8 + 8 + 1 + 8;
const MAX_CHUNK_SAMPLES: usize = 10_000_000;
static QUEUE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct DiskQueueSender {
    root: PathBuf,
    wake: mpsc::Sender<()>,
    _owner: Arc<crate::review_paths::fs::File>,
}

pub struct DiskQueueReceiver {
    root: PathBuf,
    owner: Arc<crate::review_paths::fs::File>,
    wake: mpsc::Receiver<()>,
    in_flight: Arc<Mutex<HashSet<PathBuf>>>,
    released: Arc<Notify>,
}

pub struct DiskQueueItem {
    _owner: Arc<crate::review_paths::fs::File>,
    chunk: AudioChunk,
    path: PathBuf,
    in_flight: Arc<Mutex<HashSet<PathBuf>>>,
    released: Arc<Notify>,
}

pub async fn disk_backed_queue() -> Result<(DiskQueueSender, DiskQueueReceiver)> {
    disk_backed_queue_for_session(
        &recovery::persistent_root(),
        &uuid::Uuid::new_v4().to_string(),
    )
    .await
}

pub async fn disk_backed_queue_for_session(
    parent: &Path,
    session_id: &str,
) -> Result<(DiskQueueSender, DiskQueueReceiver)> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let root = parent.join(format!(
        "transcription-spool-{}-{stamp}-{}",
        std::process::id(),
        QUEUE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).await?;
    let owner = recovery::create(&root, session_id)?;
    let (wake_sender, wake_receiver) = mpsc::channel(1);
    let in_flight = Arc::new(Mutex::new(HashSet::new()));
    let released = Arc::new(Notify::new());
    Ok((
        DiskQueueSender {
            root: root.clone(),
            wake: wake_sender,
            _owner: owner.clone(),
        },
        DiskQueueReceiver {
            root,
            wake: wake_receiver,
            owner,
            in_flight,
            released,
        },
    ))
}

impl DiskQueueReceiver {
    pub fn directory(&self) -> &Path {
        &self.root
    }

    pub async fn resume(root: &Path, retry_failed: bool) -> Result<Self> {
        let info = recovery::inspect(root)?;
        if info.legacy {
            bail!("이전 버전 대기열은 원본 녹음 세션 확인 후 수동 복구해야 합니다");
        }
        let owner = recovery::claim(root)?;
        recovery::prepare_retry(root, retry_failed)?;
        let (sender, wake) = mpsc::channel(1);
        drop(sender);
        Ok(Self {
            root: root.to_path_buf(),
            owner,
            wake,
            in_flight: Arc::new(Mutex::new(HashSet::new())),
            released: Arc::new(Notify::new()),
        })
    }
    pub async fn recv(&mut self) -> Result<Option<DiskQueueItem>> {
        loop {
            if let Some(path) = next_chunk_path(&self.root, &self.in_flight).await? {
                self.in_flight
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .insert(path.clone());
                let result: Result<AudioChunk> = async {
                    let bytes = fs::read(&path).await.with_context(|| {
                        format!("받아쓰기 대기열 파일 읽기 실패: {}", path.display())
                    })?;
                    decode_chunk(&bytes)
                }
                .await;
                match result {
                    Ok(chunk) => {
                        return Ok(Some(DiskQueueItem {
                            chunk,
                            _owner: self.owner.clone(),
                            path,
                            in_flight: self.in_flight.clone(),
                            released: self.released.clone(),
                        }));
                    }
                    Err(error) => {
                        self.in_flight
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .remove(&path);
                        return Err(error);
                    }
                }
            }
            if self.wake.is_closed() {
                if self
                    .in_flight
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .is_empty()
                {
                    return Ok(None);
                }
                self.released.notified().await;
            } else {
                tokio::select! {
                    wake = self.wake.recv() => {
                        if wake.is_none() && self.in_flight.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_empty() {
                                    return Ok(None);
                        }
                    }
                    _ = self.released.notified() => {}
                }
            }
        }
    }
}

impl DiskQueueItem {
    pub const fn chunk_id(&self) -> u64 {
        self.chunk.chunk_id
    }

    pub fn take_chunk(&mut self) -> AudioChunk {
        AudioChunk {
            data: std::mem::take(&mut self.chunk.data),
            sample_rate: self.chunk.sample_rate,
            timestamp: self.chunk.timestamp,
            chunk_id: self.chunk.chunk_id,
            device_type: self.chunk.device_type.clone(),
        }
    }

    pub async fn commit(self) -> Result<()> {
        let receipt = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.path.with_extension("done"))
            .await?;
        receipt.sync_all().await?;
        fs::remove_file(&self.path)
            .await
            .with_context(|| format!("처리한 받아쓰기 대기열 파일 삭제 실패: {}", self.path.display()))
    }

    pub async fn retain(self, disposition: &str) -> Result<PathBuf> {
        if !matches!(disposition, "failed" | "deferred" | "cancelled") {
            bail!("지원하지 않는 보존 상태입니다");
        }
        let retained = self.path.with_extension(disposition);
        fs::rename(&self.path, &retained).await.with_context(|| {
            format!(
                "처리하지 못한 받아쓰기 대기열 파일 보존 실패: {}",
                self.path.display()
            )
        })?;
        Ok(retained)
    }
}

impl Drop for DiskQueueItem {
    fn drop(&mut self) {
        self.in_flight
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.path);
        self.released.notify_one();
    }
}

async fn next_chunk_path(
    root: &Path,
    in_flight: &Arc<Mutex<HashSet<PathBuf>>>,
) -> Result<Option<PathBuf>> {
    let mut entries = fs::read_dir(root).await?;
    let mut paths = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("chunk")
            && !path.with_extension("done").exists()
        {
            paths.push(path);
        }
    }
    paths.sort_unstable();
    let in_flight = in_flight
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Ok(paths.into_iter().find(|path| !in_flight.contains(path)))
}

#[path = "queue_codec.rs"]
mod codec;
use codec::{decode_chunk, encode_chunk};
#[path = "queue_recovery.rs"]
pub mod recovery;
#[cfg(test)]
#[path = "queue_recovery_tests.rs"]
mod recovery_tests;
#[cfg(test)]
#[path = "queue_tests.rs"]
mod tests;

#[path = "queue_receipts.rs"]
mod receipts;

#[path = "queue_enqueue.rs"]
mod enqueue;

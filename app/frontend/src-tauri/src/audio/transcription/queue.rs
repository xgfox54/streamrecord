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
use tokio::{
    fs,
    io::AsyncWriteExt,
    sync::{mpsc, Notify},
};

const MAGIC: &[u8; 4] = b"SRQ1";
const HEADER_BYTES: usize = 4 + 4 + 8 + 8 + 1 + 8;
const MAX_CHUNK_SAMPLES: usize = 10_000_000;
static QUEUE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct DiskQueueSender {
    root: PathBuf,
    wake: mpsc::Sender<()>,
}

pub struct DiskQueueReceiver {
    root: PathBuf,
    wake: mpsc::Receiver<()>,
    in_flight: Arc<Mutex<HashSet<PathBuf>>>,
    released: Arc<Notify>,
}

pub struct DiskQueueItem {
    chunk: Option<AudioChunk>,
    path: PathBuf,
    in_flight: Arc<Mutex<HashSet<PathBuf>>>,
    released: Arc<Notify>,
}

pub async fn disk_backed_queue() -> Result<(DiskQueueSender, DiskQueueReceiver)> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let root = std::env::temp_dir().join("stream-record").join(format!(
        "transcription-spool-{}-{stamp}-{}",
        std::process::id(),
        QUEUE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root)
        .await
        .context("전사 대기열 디렉터리를 만들 수 없습니다")?;
    let (wake_sender, wake_receiver) = mpsc::channel(1);
    let in_flight = Arc::new(Mutex::new(HashSet::new()));
    let released = Arc::new(Notify::new());
    Ok((
        DiskQueueSender {
            root: root.clone(),
            wake: wake_sender,
        },
        DiskQueueReceiver {
            root,
            wake: wake_receiver,
            in_flight,
            released,
        },
    ))
}

impl DiskQueueSender {
    pub async fn enqueue(&self, chunk: AudioChunk) -> Result<()> {
        if chunk.data.len() > MAX_CHUNK_SAMPLES {
            bail!("전사 청크가 안전 크기 한도를 초과했습니다");
        }
        let final_path = self.root.join(format!("{:020}.chunk", chunk.chunk_id));
        let temp_path = self.root.join(format!(
            ".{:020}-{}.tmp",
            chunk.chunk_id,
            QUEUE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let bytes = encode_chunk(&chunk);
        let result: Result<()> = async {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)
                .await?;
            file.write_all(&bytes).await?;
            file.flush().await?;
            file.sync_data().await?;
            drop(file);
            fs::rename(&temp_path, &final_path).await?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            let _ = fs::remove_file(&temp_path).await;
            return Err(error).context("전사 청크를 디스크 대기열에 커밋하지 못했습니다");
        }
        match self.wake.try_send(()) {
            Ok(()) | Err(mpsc::error::TrySendError::Full(())) => Ok(()),
            Err(mpsc::error::TrySendError::Closed(())) => {
                let _ = fs::remove_file(&final_path).await;
                bail!("전사 작업기가 종료되어 청크를 전달할 수 없습니다")
            }
        }
    }
}

impl DiskQueueReceiver {
    pub async fn recv(&mut self) -> Result<Option<DiskQueueItem>> {
        loop {
            if let Some(path) = next_chunk_path(&self.root, &self.in_flight).await? {
                self.in_flight.lock().unwrap().insert(path.clone());
                let result: Result<AudioChunk> = async {
                    let bytes = fs::read(&path).await.with_context(|| {
                        format!("전사 대기열 파일 읽기 실패: {}", path.display())
                    })?;
                    decode_chunk(&bytes)
                }
                .await;
                match result {
                    Ok(chunk) => {
                        return Ok(Some(DiskQueueItem {
                            chunk: Some(chunk),
                            path,
                            in_flight: self.in_flight.clone(),
                            released: self.released.clone(),
                        }));
                    }
                    Err(error) => {
                        self.in_flight.lock().unwrap().remove(&path);
                        return Err(error);
                    }
                }
            }
            if self.wake.is_closed() {
                if self.in_flight.lock().unwrap().is_empty() {
                    let _ = fs::remove_dir(&self.root).await;
                    return Ok(None);
                }
                self.released.notified().await;
            } else {
                tokio::select! {
                    wake = self.wake.recv() => {
                        if wake.is_none() && self.in_flight.lock().unwrap().is_empty() {
                            let _ = fs::remove_dir(&self.root).await;
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
    pub fn chunk_id(&self) -> u64 {
        self.chunk
            .as_ref()
            .expect("disk queue item audio may only be taken once")
            .chunk_id
    }

    pub fn take_chunk(&mut self) -> AudioChunk {
        self.chunk
            .take()
            .expect("disk queue item audio may only be taken once")
    }

    pub async fn commit(self) -> Result<()> {
        fs::remove_file(&self.path)
            .await
            .with_context(|| format!("처리한 전사 대기열 파일 삭제 실패: {}", self.path.display()))
    }

    pub async fn retain(self, disposition: &str) -> Result<PathBuf> {
        let retained = self.path.with_extension(disposition);
        fs::rename(&self.path, &retained).await.with_context(|| {
            format!(
                "처리하지 못한 전사 대기열 파일 보존 실패: {}",
                self.path.display()
            )
        })?;
        Ok(retained)
    }
}

impl Drop for DiskQueueItem {
    fn drop(&mut self) {
        self.in_flight.lock().unwrap().remove(&self.path);
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
        if path.extension().and_then(|value| value.to_str()) == Some("chunk") {
            paths.push(path);
        }
    }
    paths.sort_unstable();
    let in_flight = in_flight.lock().unwrap();
    Ok(paths.into_iter().find(|path| !in_flight.contains(path)))
}

fn encode_chunk(chunk: &AudioChunk) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES + chunk.data.len() * 4);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&chunk.sample_rate.to_le_bytes());
    bytes.extend_from_slice(&chunk.timestamp.to_bits().to_le_bytes());
    bytes.extend_from_slice(&chunk.chunk_id.to_le_bytes());
    bytes.push(match chunk.device_type {
        DeviceType::Microphone => 0,
        DeviceType::System => 1,
    });
    bytes.extend_from_slice(&(chunk.data.len() as u64).to_le_bytes());
    for sample in &chunk.data {
        bytes.extend_from_slice(&sample.to_bits().to_le_bytes());
    }
    bytes
}

fn decode_chunk(bytes: &[u8]) -> Result<AudioChunk> {
    if bytes.len() < HEADER_BYTES || &bytes[..4] != MAGIC {
        bail!("전사 대기열 파일 헤더가 올바르지 않습니다");
    }
    let sample_rate = u32::from_le_bytes(bytes[4..8].try_into()?);
    let timestamp = f64::from_bits(u64::from_le_bytes(bytes[8..16].try_into()?));
    let chunk_id = u64::from_le_bytes(bytes[16..24].try_into()?);
    let device_type = match bytes[24] {
        0 => DeviceType::Microphone,
        1 => DeviceType::System,
        _ => bail!("전사 대기열의 입력 장치 구분값이 올바르지 않습니다"),
    };
    let sample_count = u64::from_le_bytes(bytes[25..33].try_into()?) as usize;
    if sample_count > MAX_CHUNK_SAMPLES
        || bytes.len() != HEADER_BYTES.saturating_add(sample_count.saturating_mul(4))
    {
        bail!("전사 대기열 파일 크기가 올바르지 않습니다");
    }
    let mut data = Vec::with_capacity(sample_count);
    for raw in bytes[HEADER_BYTES..].chunks_exact(4) {
        data.push(f32::from_bits(u32::from_le_bytes(raw.try_into()?)));
    }
    Ok(AudioChunk {
        data,
        sample_rate,
        timestamp,
        chunk_id,
        device_type,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(id: u64, device_type: DeviceType) -> AudioChunk {
        AudioChunk {
            data: vec![0.25, -0.5, 1.0],
            sample_rate: 16_000,
            timestamp: id as f64 + 0.5,
            chunk_id: id,
            device_type,
        }
    }

    #[tokio::test]
    async fn disk_queue_preserves_order_and_audio_metadata_with_coalesced_wakes() {
        let (sender, mut receiver) = disk_backed_queue().await.unwrap();
        let root = receiver.root.clone();
        sender.enqueue(chunk(2, DeviceType::System)).await.unwrap();
        sender
            .enqueue(chunk(1, DeviceType::Microphone))
            .await
            .unwrap();
        sender
            .enqueue(chunk(3, DeviceType::Microphone))
            .await
            .unwrap();
        drop(sender);

        let mut first = receiver.recv().await.unwrap().unwrap();
        let first_chunk = first.take_chunk();
        assert_eq!(first_chunk.chunk_id, 1);
        assert_eq!(first_chunk.data, vec![0.25, -0.5, 1.0]);
        first.commit().await.unwrap();
        let mut second = receiver.recv().await.unwrap().unwrap();
        let second_chunk = second.take_chunk();
        assert_eq!(second_chunk.chunk_id, 2);
        assert_eq!(second_chunk.device_type, DeviceType::System);
        second.commit().await.unwrap();
        let mut third = receiver.recv().await.unwrap().unwrap();
        let third_chunk = third.take_chunk();
        assert_eq!(third_chunk.chunk_id, 3);
        assert_eq!(third_chunk.sample_rate, 16_000);
        third.commit().await.unwrap();
        assert!(receiver.recv().await.unwrap().is_none());
        assert!(!root.exists());
    }

    #[tokio::test]
    async fn failed_work_is_retained_outside_the_active_queue() {
        let (sender, mut receiver) = disk_backed_queue().await.unwrap();
        let root = receiver.root.clone();
        sender
            .enqueue(chunk(7, DeviceType::Microphone))
            .await
            .unwrap();
        drop(sender);
        let item = receiver.recv().await.unwrap().unwrap();
        let retained = item.retain("failed").await.unwrap();
        assert!(retained.exists());
        assert!(receiver.recv().await.unwrap().is_none());
        assert!(root.exists());
        fs::remove_file(retained).await.unwrap();
        fs::remove_dir(root).await.unwrap();
    }

    #[test]
    fn malformed_or_oversized_queue_files_are_rejected() {
        assert!(decode_chunk(b"not-a-queue-file").is_err());
        let mut bytes = encode_chunk(&chunk(1, DeviceType::Microphone));
        bytes.truncate(bytes.len() - 1);
        assert!(decode_chunk(&bytes).is_err());
    }
}

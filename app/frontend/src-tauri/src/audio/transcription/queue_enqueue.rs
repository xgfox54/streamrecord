use super::*;
impl DiskQueueSender {
    pub async fn enqueue(&self, chunk: AudioChunk) -> Result<()> {
        if chunk.data.len() > MAX_CHUNK_SAMPLES {
            bail!("받아쓰기 청크가 안전 크기 한도를 초과했습니다");
        }
        let final_path = self.root.join(format!("{:020}.chunk", chunk.chunk_id));
        let temp_path = self.root.join(format!(
            ".{:020}-{}.tmp",
            chunk.chunk_id,
            QUEUE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        if final_path.with_extension("done").exists() {
            bail!("이미 처리한 구간을 다시 등록할 수 없습니다");
        }
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
            fs::hard_link(&temp_path, &final_path).await?;
            fs::remove_file(&temp_path).await?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            let _ = fs::remove_file(&temp_path).await;
            return Err(error).context("받아쓰기 청크를 디스크 대기열에 커밋하지 못했습니다");
        }
        match self.wake.try_send(()) {
            Ok(()) | Err(mpsc::error::TrySendError::Full(())) => Ok(()),
            Err(mpsc::error::TrySendError::Closed(())) => {
                bail!("받아쓰기 작업기가 종료되어 청크를 전달할 수 없습니다")
            }
        }
    }
}

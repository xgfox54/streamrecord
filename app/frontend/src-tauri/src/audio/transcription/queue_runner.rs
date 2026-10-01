use super::queue::{recovery, DiskQueueReceiver};
use crate::audio::transcription::{
    engine,
    provider::TranscriptionError,
    worker::{transcribe_chunk_with_provider, TranscriptUpdate},
    RawEngineOutputStatus,
};
use anyhow::{bail, Result};
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Runtime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredRow {
    pub source_id: String,
    pub update: TranscriptUpdate,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub session_id: String,
    pub directory: std::path::PathBuf,
    pub rows: Vec<RecoveredRow>,
    pub pending: usize,
    pub failed: usize,
    pub deferred: usize,
    pub cancelled: usize,
    pub partial_writes: usize,
    pub complete: bool,
}

/// Recover into an independent, durable result set; never append to the current recording.
pub async fn resume_session<R: Runtime>(
    app: &AppHandle<R>,
    directory: &Path,
    retry_failed: bool,
) -> Result<RecoveryResult> {
    let info = recovery::inspect(directory)?;
    let Some(session_id) = info.session_id else {
        bail!("이전 버전 대기열은 세션 연결 정보가 없어 자동 복구할 수 없습니다");
    };
    let mut receiver = DiskQueueReceiver::resume(directory, retry_failed).await?;
    while let Some(mut item) = receiver.recv().await? {
        if item.saved_result::<TranscriptUpdate>().await?.is_some() {
            item.commit().await?;
            continue;
        }
        let engine = engine::get_or_init_transcription_engine(app)
            .await
            .map_err(anyhow::Error::msg)?;
        let chunk = item.take_chunk();
        let chunk_id = chunk.chunk_id;
        let start = chunk.timestamp;
        let duration = chunk.data.len() as f64 / f64::from(chunk.sample_rate);
        match transcribe_chunk_with_provider(&engine, chunk, app).await {
            Ok(result) => {
                if !result.text.trim().is_empty() {
                    let update = TranscriptUpdate {
                        raw_engine_output: result.raw_text,
                        raw_engine_output_status: RawEngineOutputStatus::Captured,
                        text: result.text,
                        timestamp: String::new(),
                        source: "Recovered audio".to_owned(),
                        sequence_id: chunk_id,
                        chunk_start_time: start,
                        is_partial: result.is_partial,
                        confidence: None,
                        score: result.score,
                        spans: result.spans,
                        result_committed: true,
                        audio_start_time: start,
                        audio_end_time: start + duration,
                        duration,
                    };
                    item.save_result(&update).await?;
                }
                item.commit().await?;
            }
            Err(TranscriptionError::AudioTooShort { .. }) => item.commit().await?,
            Err(TranscriptionError::ModelNotLoaded) => {
                item.retain("deferred").await?;
                break;
            }
            Err(_) => {
                item.retain("failed").await?;
            }
        }
    }
    let mut rows = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(id) = name.strip_suffix(".result.json") else {
            continue;
        };
        let id: u64 = id.parse()?;
        let mut update: TranscriptUpdate = serde_json::from_slice(&std::fs::read(path)?)?;
        update.result_committed = true;
        rows.push(RecoveredRow {
            source_id: format!("{session_id}:{id}"),
            update,
        });
    }
    rows.sort_by(|a, b| {
        a.update
            .audio_start_time
            .total_cmp(&b.update.audio_start_time)
    });
    let final_info = recovery::inspect(directory)?;
    Ok(RecoveryResult {
        session_id,
        directory: directory.to_path_buf(),
        rows,
        pending: final_info.pending,
        failed: final_info.failed,
        deferred: final_info.deferred,
        cancelled: final_info.cancelled,
        partial_writes: final_info.partial_writes,
        complete: final_info.processing_complete(),
    })
}

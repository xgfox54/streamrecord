use super::recording_state::AudioChunk;
use anyhow::{anyhow, Result};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::ffmpeg::find_ffmpeg_path;

/// Audio data without device type (we only store mixed audio)
#[derive(Clone)]
struct AudioData {
    data: Vec<f32>,
    // sample_rate: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct CheckpointTiming {
    pub samples: usize,
    pub sample_rate: u32,
}

pub(crate) fn checkpoint_timing_path(checkpoint: &std::path::Path) -> PathBuf {
    checkpoint.with_extension("timing.json")
}

#[derive(Debug)]
pub struct FinalizedAudio {
    pub path: PathBuf,
    pub duration_seconds: f64,
}

/// Incremental audio saver that writes checkpoints every 30 seconds
/// to minimize memory usage and enable crash recovery
pub struct IncrementalAudioSaver {
    checkpoint_buffer: Vec<AudioData>,
    checkpoint_interval_samples: usize, // 30s at 48kHz = 1,440,000 samples
    checkpoint_count: u32,
    checkpoints_dir: PathBuf,
    meeting_folder: PathBuf,
    sample_rate: u32,
}

impl IncrementalAudioSaver {
    /// Create a new incremental saver
    ///
    /// # Arguments
    /// * `meeting_folder` - Path to the meeting folder (contains .checkpoints/)
    /// * `sample_rate` - Sample rate of audio (typically 48000)
    pub fn new(meeting_folder: PathBuf, sample_rate: u32) -> Result<Self> {
        let checkpoints_dir = meeting_folder.join(".checkpoints");

        // Verify checkpoints directory exists
        if !checkpoints_dir.exists() {
            return Err(anyhow!(
                "Checkpoints directory does not exist: {}",
                checkpoints_dir.display()
            ));
        }

        Ok(Self {
            checkpoint_buffer: Vec::new(),
            checkpoint_interval_samples: sample_rate as usize * 30, // 30 seconds
            checkpoint_count: 0,
            checkpoints_dir,
            meeting_folder,
            sample_rate,
        })
    }

    /// Add an audio chunk to the buffer
    /// Automatically saves a checkpoint when buffer reaches 30 seconds
    pub async fn add_chunk(&mut self, chunk: AudioChunk) -> Result<()> {
        let audio_data = AudioData {
            data: chunk.data,
            // sample_rate: chunk.sample_rate,
        };

        self.checkpoint_buffer.push(audio_data);

        // Calculate total samples in buffer
        let total_samples: usize = self.checkpoint_buffer.iter().map(|c| c.data.len()).sum();

        // Save checkpoint when buffer reaches threshold (30 seconds)
        if total_samples >= self.checkpoint_interval_samples {
            self.save_checkpoint().await?;
            self.checkpoint_buffer.clear();
        }

        Ok(())
    }

    /// Save current buffer as a checkpoint file
    async fn save_checkpoint(&mut self) -> Result<()> {
        // Concatenate all chunks in buffer
        let audio_data: Vec<f32> = self
            .checkpoint_buffer
            .iter()
            .flat_map(|c| &c.data)
            .cloned()
            .collect();

        if audio_data.is_empty() {
            warn!("Attempted to save empty checkpoint, skipping");
            return Ok(());
        }

        // Generate checkpoint filename
        let checkpoint_path = self
            .checkpoints_dir
            .join(format!("audio_chunk_{:03}.mp4", self.checkpoint_count));

        // FFmpeg must never expose a half-written .mp4 to live analysis or crash recovery.
        // A failed encode leaves only a .partial file; the previous checkpoints stay intact.
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let pending_path = checkpoint_path.with_extension(format!("{nonce}.partial"));
        if checkpoint_path.exists() {
            return Err(anyhow!("Checkpoint path is already in use: {}", checkpoint_path.display()));
        }
        super::encode::encode_single_audio_async(
            bytemuck::cast_slice(&audio_data),
            self.sample_rate,
            1, // mono
            &pending_path,
        ).await?;

        crate::review_paths::fs::rename(&pending_path, &checkpoint_path)?;

        let duration_seconds = audio_data.len() as f32 / self.sample_rate as f32;
        self.checkpoint_count += 1;
        // Timing is a live-analysis hint. Failure must not invalidate durable audio.
        let timing = CheckpointTiming { samples: audio_data.len(), sample_rate: self.sample_rate };
        match serde_json::to_vec(&timing) {
            Ok(bytes) => if let Err(error) = crate::review_paths::fs::write(checkpoint_timing_path(&checkpoint_path), bytes) {
                warn!("Checkpoint timing unavailable; audio remains safe: {}", error);
            },
            Err(error) => warn!("Checkpoint timing unavailable; audio remains safe: {}", error),
        }

        info!(
            "Saved checkpoint {}: {:.2}s of audio ({} samples)",
            self.checkpoint_count,
            duration_seconds,
            audio_data.len()
        );

        Ok(())
    }

    /// Finalize the recording: save final checkpoint, merge all checkpoints, cleanup
    ///
    /// Returns the final audio path and duration of the samples written to it.
    pub async fn finalize(&mut self) -> Result<FinalizedAudio> {
        info!("Finalizing incremental recording...");

        // Save final buffer if not empty
        if !self.checkpoint_buffer.is_empty() {
            info!(
                "Saving final checkpoint with remaining {} chunks",
                self.checkpoint_buffer.len()
            );
            self.save_checkpoint().await?;
            self.checkpoint_buffer.clear();
        }

        if self.checkpoint_count == 0 {
            return Err(anyhow!(
                "No audio checkpoints to merge - recording may have failed"
            ));
        }

        let final_audio_path = self.meeting_folder.join("audio.mp4");
        let merged = self.merge_checkpoints(&final_audio_path).await?;

        // Clean up checkpoints directory
        info!("Cleaning up {} checkpoint files", self.checkpoint_count);
        if let Err(e) = crate::review_paths::fs::remove_dir_all(&self.checkpoints_dir) {
            warn!("Failed to clean up checkpoints directory: {}", e);
            // Non-fatal - user can manually delete
        }

        info!("Finalized recording: {}", final_audio_path.display());

        Ok(FinalizedAudio {
            path: final_audio_path,
            duration_seconds: merged.samples as f64 / merged.sample_rate as f64,
        })
    }

    async fn merge_checkpoints(&self, output: &PathBuf) -> Result<super::checkpoint_merge::MergedAudio> {
        let checkpoints: Vec<_> = (0..self.checkpoint_count)
            .map(|i| self.checkpoints_dir.join(format!("audio_chunk_{:03}.mp4", i)))
            .collect();
        let ffmpeg = find_ffmpeg_path().ok_or_else(|| anyhow!("FFmpeg not found"))?;
        let merged = super::checkpoint_merge::merge(&ffmpeg, &checkpoints, output, self.sample_rate).await?;
        info!("Merged {} checkpoints: {} samples at {} Hz (estimated timing: {})",
            checkpoints.len(), merged.samples, merged.sample_rate, merged.estimated_timing);
        Ok(merged)
    }

    /// Get the meeting folder path
    pub fn get_meeting_folder(&self) -> &PathBuf {
        &self.meeting_folder
    }

    /// Get current checkpoint count
    pub fn get_checkpoint_count(&self) -> u32 {
        self.checkpoint_count
    }
}

/// Audio recovery status for transcript recovery feature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioRecoveryStatus {
    pub status: String, // "success" | "partial" | "failed" | "none"
    pub chunk_count: u32,
    pub estimated_duration_seconds: f64,
    pub audio_file_path: Option<String>,
    pub message: String,
}

/// Recover audio from checkpoint files
/// This is called by the transcript recovery system to merge audio chunks after a crash
#[tauri::command]
pub async fn recover_audio_from_checkpoints(
    meeting_folder: String,
    _sample_rate: u32,
) -> Result<AudioRecoveryStatus, String> {
    info!("Starting audio recovery for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        info!(
            "No checkpoints directory found at: {}",
            checkpoints_dir.display()
        );
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoints found".to_string(),
        });
    }

    // Scan for checkpoint files
    let mut checkpoint_files: Vec<_> = crate::review_paths::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().and_then(|s| s.to_str()) == Some("mp4"))
        .collect();

    if checkpoint_files.is_empty() {
        info!(
            "No checkpoint files found in: {}",
            checkpoints_dir.display()
        );
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoint files found".to_string(),
        });
    }

    // Sort by filename (audio_chunk_000.mp4, audio_chunk_001.mp4, etc.)
    checkpoint_files.sort_by_key(|entry| entry.path());

    let chunk_count = checkpoint_files.len() as u32;
    let estimated_duration = (chunk_count as f64) * 30.0; // 30 seconds per chunk

    info!(
        "Found {} checkpoint files, estimated duration: {:.2}s",
        chunk_count, estimated_duration
    );

    let output_path = folder_path.join("audio.mp4");
    let ffmpeg = find_ffmpeg_path()
        .ok_or_else(|| "FFmpeg not found. Please install FFmpeg to recover audio.".to_string())?;
    let paths: Vec<_> = checkpoint_files.iter().map(|entry| entry.path()).collect();
    match super::checkpoint_merge::merge(&ffmpeg, &paths, &output_path, _sample_rate).await {
        Ok(merged) => Ok(AudioRecoveryStatus {
            status: "success".to_string(),
            chunk_count,
            estimated_duration_seconds: merged.samples as f64 / merged.sample_rate as f64,
            audio_file_path: Some(output_path.to_string_lossy().into_owned()),
            message: if merged.estimated_timing {
                format!("Recovered {} audio chunks; missing timing metadata, duration is estimated", chunk_count)
            } else {
                format!("Successfully recovered {} audio chunks", chunk_count)
            },
        }),
        Err(error) => {
            error!("Audio recovery failed: {}", error);
            Ok(AudioRecoveryStatus {
                status: "failed".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: None,
                message: format!("Audio recovery failed: {}", error),
            })
        }
    }
}

/// Clean up checkpoint files after successful recording or recovery
/// This command is called by the frontend after successful save to clean up checkpoint files
#[tauri::command]
pub async fn cleanup_checkpoints(meeting_folder: String) -> Result<(), String> {
    info!("Cleaning up checkpoints for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    if checkpoints_dir.exists() {
        crate::review_paths::fs::remove_dir_all(&checkpoints_dir)
            .map_err(|e| format!("Failed to remove checkpoints directory: {}", e))?;
        info!("Successfully cleaned up checkpoints directory");
    } else {
        info!("No checkpoints directory to clean up");
    }

    Ok(())
}

/// Check if a meeting folder has audio checkpoint files
/// Returns true if .checkpoints/ directory exists and contains .mp4 files
#[tauri::command]
pub async fn has_audio_checkpoints(meeting_folder: String) -> Result<bool, String> {
    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        return Ok(false);
    }

    // Scan for .mp4 checkpoint files
    let has_mp4_files = crate::review_paths::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .any(|entry| entry.path().extension().and_then(|s| s.to_str()) == Some("mp4"));

    Ok(has_mp4_files)
}

#[cfg(test)]
mod tests {
    use super::super::recording_state::DeviceType;
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_checkpoint_creation() {
        // Create temp meeting folder
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Test_Meeting");
        crate::review_paths::fs::create_dir_all(&meeting_folder).unwrap();
        crate::review_paths::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000).unwrap();

        // Add 60 seconds worth of audio (should create 2 checkpoints)
        for i in 0..120 {
            // 120 chunks of 0.5s each
            let chunk = AudioChunk {
                data: vec![0.5f32; 24000], // 0.5s at 48kHz
                sample_rate: 48000,
                timestamp: i as f64 * 0.5, // timestamp in seconds
                chunk_id: i as u64,
                device_type: DeviceType::Microphone,
            };
            saver.add_chunk(chunk).await.unwrap();
        }

        // Verify 2 checkpoints created
        assert_eq!(saver.checkpoint_count, 2);

        // Finalize and verify merge
        let final_audio = saver.finalize().await.unwrap();
        assert!(final_audio.path.exists());
        assert_eq!(final_audio.duration_seconds, 60.0);

        // Verify checkpoints directory deleted
        assert!(!meeting_folder.join(".checkpoints").exists());
    }

    #[tokio::test]
    async fn test_empty_recording() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Empty_Test");
        crate::review_paths::fs::create_dir_all(&meeting_folder).unwrap();
        crate::review_paths::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000).unwrap();

        // Try to finalize without adding any chunks
        let result = saver.finalize().await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("No audio checkpoints"));
    }
}

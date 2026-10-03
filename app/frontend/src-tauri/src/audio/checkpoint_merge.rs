use super::incremental_saver::{checkpoint_timing_path, CheckpointTiming};
use anyhow::{anyhow, bail, Context, Result};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub(super) struct MergedAudio {
    pub samples: u64,
    pub sample_rate: u32,
    pub estimated_timing: bool,
}

struct Encoder(Child);
impl Drop for Encoder {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn command(ffmpeg: &Path) -> Command {
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-nostdin", "-nostats", "-v", "error"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

pub(super) fn merge(
    ffmpeg: &Path,
    checkpoints: &[PathBuf],
    output: &Path,
    fallback_rate: u32,
) -> Result<MergedAudio> {
    if checkpoints.is_empty() {
        bail!("No audio checkpoints to merge");
    }
    crate::review_paths::guard_write(output)?;
    if output.exists() {
        bail!("Completed audio already exists: {}", output.display());
    }
    let parent = output.parent().context("Missing audio output directory")?;
    crate::review_paths::guard_write(parent)?;
    let mut timings = Vec::with_capacity(checkpoints.len());
    for checkpoint in checkpoints {
        crate::review_paths::guard_read(checkpoint)?;
        let timing = match crate::review_paths::fs::read(checkpoint_timing_path(checkpoint)) {
            Ok(bytes) => Some(serde_json::from_slice::<CheckpointTiming>(&bytes)
                .context("Invalid checkpoint timing")?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        timings.push(timing);
    }
    let rate = timings.iter().flatten().next().map_or(fallback_rate, |t| t.sample_rate);
    if !(8000..=384000).contains(&rate)
        || timings.iter().flatten().any(|t| t.sample_rate != rate || t.samples == 0)
    {
        bail!("Invalid or inconsistent checkpoint sample rate/count");
    }
    let estimated_timing = timings.iter().any(Option::is_none);
    if estimated_timing {
        log::warn!("Legacy checkpoint timing missing; recovered duration includes estimated AAC tail padding");
    }

    let pending = tempfile::Builder::new().prefix("audio-merge-").suffix(".mp4")
        .tempfile_in(parent)?;
    crate::review_paths::guard_write(pending.path())?;
    let mut diagnostics = tempfile::tempfile_in(parent)?;
    let mut encoder_command = command(ffmpeg);
    encoder_command.args(["-f", "f32le", "-ar", &rate.to_string(), "-ac", "1", "-i", "pipe:0",
        "-c:a", "aac", "-b:a", "192k", "-profile:a", "aac_low", "-movflags", "+faststart",
        "-f", "mp4", "-y"])
        .arg(pending.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(diagnostics.try_clone()?));
    let mut encoder = Encoder(encoder_command.spawn().context("Start merged audio encoder")?);
    let mut input = encoder.0.stdin.take().context("Missing encoder input")?;
    let mut total_samples = 0u64;
    for (checkpoint, timing) in checkpoints.iter().zip(timings.iter()) {
        let decoded = tempfile::Builder::new().prefix("checkpoint-pcm-").suffix(".f32")
            .tempfile_in(parent)?.into_temp_path();
        crate::review_paths::guard_write(&decoded)?;
        let result = command(ffmpeg).arg("-i").arg(checkpoint)
            .args(["-map", "0:a:0", "-vn", "-ac", "1", "-ar", &rate.to_string(), "-f", "f32le", "-y"])
            .arg(&decoded).output().context("Decode audio checkpoint")?;
        if !result.status.success() {
            bail!("Checkpoint decode failed: {}", String::from_utf8_lossy(&result.stderr));
        }
        let pcm = crate::review_paths::fs::open_file(&decoded)?;
        let decoded_bytes = pcm.metadata()?.len();
        if decoded_bytes == 0 || decoded_bytes % 4 != 0 {
            bail!("Invalid decoded checkpoint length");
        }
        let samples = timing.as_ref().map_or(decoded_bytes / 4, |t| t.samples as u64);
        let bytes = samples.checked_mul(4).context("Checkpoint sample count overflow")?;
        if decoded_bytes < bytes {
            bail!("Decoded checkpoint is shorter than its saved sample count");
        }
        let copied = std::io::copy(&mut pcm.take(bytes), &mut input)?;
        if copied != bytes {
            bail!("Incomplete checkpoint read");
        }
        total_samples = total_samples.checked_add(samples).context("Merged sample count overflow")?;
    }
    drop(input);
    let status = encoder.0.wait().context("Wait for merged audio encoder")?;
    if !status.success() {
        diagnostics.seek(SeekFrom::Start(0))?;
        let mut message = String::new();
        diagnostics.take(8192).read_to_string(&mut message)?;
        bail!("Merged audio encode failed: {message}");
    }
    if pending.as_file().metadata()?.len() == 0 {
        bail!("Merged audio encoder produced an empty file");
    }
    pending.as_file().sync_all().context("Flush merged audio before publication")?;
    pending.persist_noclobber(output).map_err(|error| anyhow!("Publish merged audio: {error}"))?;
    Ok(MergedAudio { samples: total_samples, sample_rate: rate, estimated_timing })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(ffmpeg: &Path, audio: &Path) -> Vec<f32> {
        let result = command(ffmpeg).arg("-i").arg(audio)
            .args(["-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"])
            .output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        result.stdout.chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).collect()
    }

    #[test]
    fn rejects_invalid_timing_and_preserves_existing_audio() {
        let temp = tempfile::tempdir().unwrap();
        let checkpoint = temp.path().join("audio_chunk_000.mp4");
        let output = temp.path().join("audio.mp4");
        std::fs::write(&checkpoint, b"checkpoint").unwrap();
        std::fs::write(checkpoint_timing_path(&checkpoint), b"invalid").unwrap();
        let ffmpeg = Path::new("unused-ffmpeg");
        let error = merge(ffmpeg, &[checkpoint.clone()], &output, 48000).err().unwrap();
        assert!(error.to_string().contains("Invalid checkpoint timing"));
        assert!(!output.exists());
        std::fs::write(&output, b"completed recording").unwrap();
        assert!(merge(ffmpeg, &[checkpoint.clone()], &output, 48000).is_err());
        assert_eq!(std::fs::read(&output).unwrap(), b"completed recording");
        assert_eq!(std::fs::read(&checkpoint).unwrap(), b"checkpoint");
    }

    #[test]
    #[ignore = "requires STREAM_RECORD_CHECKPOINT_FIXTURE with two actual meeting checkpoints"]
    fn actual_checkpoint_merge_preserves_alignment_and_failed_sources() {
        let fixture = PathBuf::from(std::env::var("STREAM_RECORD_CHECKPOINT_FIXTURE").unwrap());
        let temp = tempfile::tempdir().unwrap();
        let ffmpeg = super::super::ffmpeg::find_ffmpeg_path().unwrap();
        let mut paths = Vec::new();
        let mut reference = Vec::new();
        for index in 0..2 {
            let name = format!("audio_chunk_{index:03}.mp4");
            let source = fixture.join(&name);
            let path = temp.path().join(&name);
            std::fs::copy(&source, &path).unwrap();
            std::fs::copy(checkpoint_timing_path(&source), checkpoint_timing_path(&path)).unwrap();
            let timing: CheckpointTiming = serde_json::from_slice(
                &std::fs::read(checkpoint_timing_path(&path)).unwrap()).unwrap();
            assert_eq!(timing.sample_rate, 48000);
            let decoded = decode(&ffmpeg, &path);
            reference.extend_from_slice(&decoded[..timing.samples]);
            paths.push(path);
        }
        let output = temp.path().join("audio.mp4");
        let merged = merge(&ffmpeg, &paths, &output, 48000).unwrap();
        assert_eq!(merged.samples as usize, reference.len());
        assert!(!merged.estimated_timing);
        let decoded = decode(&ffmpeg, &output);
        assert!(decoded.len() >= reference.len());
        assert!(decoded.len() - reference.len() < 1024);
        for seconds in [5, 29, 31, 50] {
            let start = seconds * 48000;
            let a = &reference[start..start + 8192];
            let b = &decoded[start..start + 8192];
            let dot: f64 = a.iter().zip(b).map(|(x, y)| *x as f64 * *y as f64).sum();
            let aa: f64 = a.iter().map(|x| (*x as f64).powi(2)).sum();
            let bb: f64 = b.iter().map(|x| (*x as f64).powi(2)).sum();
            let correlation = dot / (aa * bb).sqrt();
            assert!(correlation > 0.99, "{seconds}s correlation={correlation}");
        }
        std::fs::write(&paths[1], b"corrupt checkpoint").unwrap();
        let failed_output = temp.path().join("failed.mp4");
        assert!(merge(&ffmpeg, &paths, &failed_output, 48000).is_err());
        assert!(!failed_output.exists());
        assert!(paths.iter().all(|path| path.exists()));
        assert_eq!(std::fs::read(&paths[1]).unwrap(), b"corrupt checkpoint");
    }
}

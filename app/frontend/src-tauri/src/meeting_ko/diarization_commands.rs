//! Authorized saved-audio diarization IPC. Original audio and transcripts stay immutable.
use super::diarization::{self, DiarizationRequest, DiarizationResult};
use serde::Serialize;
use std::{path::{Path, PathBuf}, process::Stdio, sync::Mutex, time::Duration};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDiarization {
    pub checkpoint_index: u32,
    pub window_start_seconds: f64,
    pub window_end_seconds: f64,
    #[serde(flatten)]
    pub result: DiarizationResult,
}

fn checkpoint_path(folder: &Path, index: u32) -> PathBuf {
    folder.join(".checkpoints").join(format!("audio_chunk_{index:03}.mp4"))
}

fn checkpoint_duration(path: &Path) -> Option<f64> {
    let data = crate::review_paths::fs::read(crate::audio::incremental_saver::checkpoint_timing_path(path)).ok()?;
    let timing: crate::audio::incremental_saver::CheckpointTiming = serde_json::from_slice(&data).ok()?;
    let duration = timing.samples as f64 / timing.sample_rate as f64;
    (timing.sample_rate >= 8_000 && timing.sample_rate <= 192_000
        && duration > 0.0 && duration <= 60.0 && path.is_file()).then_some(duration)
}

struct LiveWindowFiles {
    first: u32,
    index: u32,
    start: f64,
    end: f64,
}

struct FullRecordingFiles {
    last: u32,
    end: f64,
}

/// Every completed checkpoint from the start of the recording, in order and without gaps.
/// Live speaker numbers drift when only one-minute windows are compared, so the whole
/// recording is analysed again from time to time to keep each person's number consistent.
fn full_recording(folder: &Path) -> Option<FullRecordingFiles> {
    if !folder.join(".checkpoints").is_dir() {
        return None;
    }
    let mut end = 0.0;
    let mut last = None;
    for index in 0..=2880_u32 {
        let Some(duration) = checkpoint_duration(&checkpoint_path(folder, index)) else { break };
        end += duration;
        last = Some(index);
    }
    last.filter(|last| *last >= 1).map(|last| FullRecordingFiles { last, end })
}

fn wav_header(data_bytes: u32) -> [u8; 44] {
    let mut header = [0_u8; 44];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
    header[8..16].copy_from_slice(b"WAVEfmt ");
    header[16..20].copy_from_slice(&16_u32.to_le_bytes());
    header[20..22].copy_from_slice(&1_u16.to_le_bytes());
    header[22..24].copy_from_slice(&1_u16.to_le_bytes());
    header[24..28].copy_from_slice(&16_000_u32.to_le_bytes());
    header[28..32].copy_from_slice(&32_000_u32.to_le_bytes());
    header[32..34].copy_from_slice(&2_u16.to_le_bytes());
    header[34..36].copy_from_slice(&16_u16.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    header
}

fn next_live_window(folder: &Path, after_checkpoint: i64) -> Result<Option<LiveWindowFiles>, String> {
    if after_checkpoint < -1 || after_checkpoint > 2880 {
        return Err("Invalid checkpoint cursor".into());
    }
    let dir = folder.join(".checkpoints");
    if !dir.is_dir() { return Ok(None); } // auto-save is disabled
    let next = crate::review_paths::fs::read_dir(&dir).map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let number = name.strip_prefix("audio_chunk_")?.strip_suffix(".mp4")?.parse::<u32>().ok()?;
            (number <= 2880 && checkpoint_duration(&entry.path()).is_some()).then_some(number)
        })
        .filter(|index| i64::from(*index) > after_checkpoint)
        .min();
    let Some(index) = next else { return Ok(None); };
    if i64::from(index) != after_checkpoint + 1 { return Ok(None); }
    let first = index.saturating_sub(1);
    let mut start = 0.0;
    for prior in 0..first {
        let Some(duration) = checkpoint_duration(&checkpoint_path(folder, prior)) else { return Ok(None); };
        start += duration;
    }
    let Some(first_duration) = checkpoint_duration(&checkpoint_path(folder, first)) else { return Ok(None); };
    let second = if first != index { checkpoint_duration(&checkpoint_path(folder, index)) } else { None };
    if first != index && second.is_none() { return Ok(None); }
    Ok(Some(LiveWindowFiles { first, index, start, end: start + first_duration + second.unwrap_or(0.0) }))
}

/// Analyze the next complete checkpoint, including the previous checkpoint as
/// overlap so the UI can reconcile speaker IDs across windows. With `full`, analyze
/// the whole recording so far so the UI can re-anchor every speaker number. The source
/// path is obtained only from the active recording manager, never from the webview.
#[tauri::command]
pub async fn ko_poll_live_diarization<R: Runtime>(
    app: AppHandle<R>,
    after_checkpoint: i64,
    full: Option<bool>,
) -> Result<Option<LiveDiarization>, String> {
    if !(-1..=2880).contains(&after_checkpoint) {
        return Err("Invalid checkpoint cursor".into());
    }
    let Some((folder, state)) = crate::audio::recording_commands::live_diarization_session() else {
        return Ok(None);
    };
    let full = full.unwrap_or(false);
    let window = if full {
        let Some(files) = full_recording(&folder) else { return Ok(None); };
        LiveWindowFiles { first: 0, index: files.last, start: 0.0, end: files.end }
    } else {
        let Some(window) = next_live_window(&folder, after_checkpoint)? else { return Ok(None); };
        window
    };
    // Offline analysis runs at about 30x real time on CPU; allow a margin for slow laptops.
    let limit = if full { Duration::from_secs((120.0 + window.end / 4.0).min(3600.0) as u64) } else { Duration::from_secs(240) };
    let cancel = CancellationToken::new();
    {
        let mut running = RUNNING.lock().map_err(|_| "Diarization lock unavailable")?;
        if running.is_some() { return Ok(None); }
        *running = Some(cancel.clone());
    }
    let _guard = RunGuard;
    let mut result = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("Live diarization cancelled".to_string()),
        result = tokio::time::timeout(limit, analyze_live(&app, &folder, window.first, window.index, full)) =>
            result.map_err(|_| "Live diarization timed out".to_string())?,
    }?;
    if !crate::audio::recording_commands::live_diarization_session_matches(&state) {
        return Ok(None);
    }
    for segment in &mut result.segments {
        segment.start += window.start;
        segment.end += window.start;
    }
    Ok(Some(LiveDiarization {
        checkpoint_index: window.index,
        window_start_seconds: window.start,
        window_end_seconds: window.end,
        result,
    }))
}

async fn analyze_live<R: Runtime>(
    app: &AppHandle<R>, folder: &Path, first: u32, latest: u32, full: bool,
) -> Result<DiarizationResult, String> {
    let runtime_dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("bundled-diarization");
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let ffmpeg = crate::audio::ffmpeg::find_ffmpeg_path().ok_or("ffmpeg unavailable")?;
    if full {
        run_full_recording(&ffmpeg, runtime_dir, cache, folder, latest).await
    } else {
        run_live_window(&ffmpeg, runtime_dir, cache, folder, first, latest).await
    }
}

/// Decodes checkpoints 0..=last one at a time, trimmed to their saved sample counts so
/// AAC padding cannot accumulate into drift, and streams them into one 16 kHz mono WAV.
async fn run_full_recording(
    ffmpeg: &Path, runtime_dir: PathBuf, cache: PathBuf, folder: &Path, last: u32,
) -> Result<DiarizationResult, String> {
    crate::review_paths::async_fs::create_dir_all(&cache).await.map_err(|e| e.to_string())?;
    let temp = tempfile::Builder::new().prefix("live-diarization-full-").tempdir_in(cache).map_err(|e| e.to_string())?;
    let wav = temp.path().join("audio.wav");
    let mut output = crate::review_paths::async_fs::create_file(&wav).await.map_err(|e| e.to_string())?;
    output.write_all(&wav_header(0)).await.map_err(|e| e.to_string())?;
    let mut data_bytes: u64 = 0;
    for index in 0..=last {
        let path = checkpoint_path(folder, index);
        let duration = checkpoint_duration(&path).ok_or("Checkpoint changed during live analysis")?;
        let mut command = tokio::process::Command::new(ffmpeg);
        command.args(["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i"]).arg(&path)
            .args(["-t", &format!("{duration:.6}"), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let decoded = tokio::time::timeout(Duration::from_secs(60), command.output()).await
            .map_err(|_| "Live audio conversion timed out")?.map_err(|e| e.to_string())?;
        if !decoded.status.success() || decoded.stdout.is_empty() {
            return Err("Live audio conversion failed".into());
        }
        output.write_all(&decoded.stdout).await.map_err(|e| e.to_string())?;
        data_bytes += decoded.stdout.len() as u64;
    }
    if data_bytes > u64::from(u32::MAX - 36) {
        return Err("Recording too long for live analysis".into());
    }
    let data_bytes = data_bytes as u32;
    output.seek(std::io::SeekFrom::Start(0)).await.map_err(|e| e.to_string())?;
    output.write_all(&wav_header(data_bytes)).await.map_err(|e| e.to_string())?;
    output.flush().await.map_err(|e| e.to_string())?;
    drop(output);
    let wav_info_path = wav.clone();
    let info = tokio::task::spawn_blocking(move || crate::audio::import::validate_audio_file(&wav_info_path))
        .await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    diarization::run(&DiarizationRequest { audio_path: wav, duration_seconds: info.duration_seconds, runtime_dir }, &CancellationToken::new())
        .await.map_err(|e| e.to_string())
}

async fn run_live_window(
    ffmpeg: &Path, runtime_dir: PathBuf, cache: PathBuf, folder: &Path, first: u32, latest: u32,
) -> Result<DiarizationResult, String> {
    crate::review_paths::async_fs::create_dir_all(&cache).await.map_err(|e| e.to_string())?;
    let temp = tempfile::Builder::new().prefix("live-diarization-").tempdir_in(cache).map_err(|e| e.to_string())?;
    let wav = temp.path().join("audio.wav");
    let mut command = tokio::process::Command::new(ffmpeg);
    command.args(["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe"])
        .arg("-i").arg(checkpoint_path(folder, first));
    if latest != first {
        command.args(["-protocol_whitelist", "file,pipe"]).arg("-i").arg(checkpoint_path(folder, latest))
            .args(["-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]"]);
    }
    command.args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav"])
        .arg(&wav).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let status = tokio::time::timeout(Duration::from_secs(120), command.status()).await
        .map_err(|_| "Live audio conversion timed out")?.map_err(|e| e.to_string())?;
    if !status.success() { return Err("Live audio conversion failed".into()); }
    let wav_info_path = wav.clone();
    let info = tokio::task::spawn_blocking(move || crate::audio::import::validate_audio_file(&wav_info_path))
        .await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    diarization::run(&DiarizationRequest { audio_path: wav, duration_seconds: info.duration_seconds, runtime_dir }, &CancellationToken::new())
        .await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod live_window_tests {
    use super::*;

    fn publish(folder: &Path, index: u32, seconds: u32) {
        let path = checkpoint_path(folder, index);
        crate::review_paths::fs::write(&path, b"fixture").unwrap();
        let timing = crate::audio::incremental_saver::CheckpointTiming {
            samples: seconds as usize * 48_000,
            sample_rate: 48_000,
        };
        crate::review_paths::fs::write(
            crate::audio::incremental_saver::checkpoint_timing_path(&path),
            serde_json::to_vec(&timing).unwrap(),
        ).unwrap();
    }

    #[test]
    fn completed_windows_resume_with_exact_offsets_and_ignore_partial_files() {
        let folder = tempfile::tempdir().unwrap();
        crate::review_paths::fs::create_dir(folder.path().join(".checkpoints")).unwrap();
        publish(folder.path(), 0, 30);
        publish(folder.path(), 1, 31);
        publish(folder.path(), 2, 29);
        crate::review_paths::fs::write(folder.path().join(".checkpoints/audio_chunk_003.partial"), b"incomplete").unwrap();
        let first = next_live_window(folder.path(), -1).unwrap().unwrap();
        assert_eq!((first.first, first.index, first.start, first.end), (0, 0, 0.0, 30.0));
        let second = next_live_window(folder.path(), 0).unwrap().unwrap();
        assert_eq!((second.first, second.index, second.start, second.end), (0, 1, 0.0, 61.0));
        let resumed = next_live_window(folder.path(), 1).unwrap().unwrap();
        assert_eq!((resumed.first, resumed.index, resumed.start, resumed.end), (1, 2, 30.0, 90.0));
        assert!(next_live_window(folder.path(), 2).unwrap().is_none());
        assert!(next_live_window(folder.path(), 2881).is_err());
    }

    #[test]
    fn missing_timing_never_advances_past_a_gap() {
        let folder = tempfile::tempdir().unwrap();
        crate::review_paths::fs::create_dir(folder.path().join(".checkpoints")).unwrap();
        publish(folder.path(), 0, 30);
        crate::review_paths::fs::write(checkpoint_path(folder.path(), 1), b"audio without timing").unwrap();
        publish(folder.path(), 2, 30);
        assert!(next_live_window(folder.path(), 0).unwrap().is_none());
    }

    #[test]
    fn full_recording_covers_every_completed_checkpoint_from_the_start() {
        let folder = tempfile::tempdir().unwrap();
        assert!(full_recording(folder.path()).is_none());
        crate::review_paths::fs::create_dir(folder.path().join(".checkpoints")).unwrap();
        publish(folder.path(), 0, 30);
        assert!(full_recording(folder.path()).is_none(), "one checkpoint is too short to re-anchor");
        publish(folder.path(), 1, 31);
        publish(folder.path(), 2, 29);
        crate::review_paths::fs::write(folder.path().join(".checkpoints/audio_chunk_003.partial"), b"incomplete").unwrap();
        let full = full_recording(folder.path()).unwrap();
        assert_eq!((full.last, full.end), (2, 90.0));
        crate::review_paths::fs::write(checkpoint_path(folder.path(), 3), b"audio without timing").unwrap();
        publish(folder.path(), 4, 30);
        let gap = full_recording(folder.path()).unwrap();
        assert_eq!((gap.last, gap.end), (2, 90.0), "a gap stops at the last consecutive checkpoint");
    }

    #[test]
    fn wav_header_describes_mono_16khz_pcm() {
        let header = wav_header(32_000);
        let word = |at: usize| u32::from_le_bytes(header[at..at + 4].try_into().unwrap());
        assert_eq!(&header[0..4], b"RIFF");
        assert_eq!(&header[8..16], b"WAVEfmt ");
        assert_eq!((word(4), word(24), word(28), word(40)), (32_036, 16_000, 32_000, 32_000));
        assert_eq!(&header[36..40], b"data");
    }

    #[tokio::test]
    #[ignore = "run explicitly with real 30-second checkpoints and the bundled native model"]
    async fn real_checkpoints_are_analysed_from_the_start() {
        let fixture = PathBuf::from(std::env::var("STREAM_RECORD_FULL_FIXTURE").unwrap());
        let runtime = PathBuf::from(std::env::var("STREAM_RECORD_DIARIZATION_RUNTIME").unwrap());
        let ffmpeg = PathBuf::from(std::env::var("STREAM_RECORD_FFMPEG").unwrap());
        let test_root = PathBuf::from(std::env::var("STREAM_RECORD_TEST_ROOT").unwrap());
        let count: u32 = std::env::var("STREAM_RECORD_FULL_CHUNKS").unwrap().parse().unwrap();
        let folder = tempfile::Builder::new().prefix("full-live-").tempdir_in(&test_root).unwrap();
        crate::review_paths::fs::create_dir(folder.path().join(".checkpoints")).unwrap();
        for index in 0..count {
            publish(folder.path(), index, 30);
            crate::review_paths::fs::copy(fixture.join(format!("audio_chunk_{index:03}.mp4")), checkpoint_path(folder.path(), index)).unwrap();
        }
        let full = full_recording(folder.path()).unwrap();
        assert_eq!((full.last, full.end), (count - 1, f64::from(count) * 30.0));
        let cache = tempfile::Builder::new().prefix("full-cache-").tempdir_in(&test_root).unwrap();
        let started = std::time::Instant::now();
        let result = run_full_recording(&ffmpeg, runtime, cache.path().to_path_buf(), folder.path(), full.last).await.unwrap();
        crate::review_paths::fs::write(test_root.join("full-live-result.json"), serde_json::to_vec(&result).unwrap()).unwrap();
        let speakers: std::collections::BTreeSet<u8> = result.segments.iter().map(|s| s.speaker).collect();
        println!("FULL_LIVE_ANALYSIS chunks={count} seconds={:.1} segments={} speakers={speakers:?}", started.elapsed().as_secs_f64(), result.segments.len());
        assert!(!result.segments.is_empty());
        assert!(result.segments.iter().all(|s| s.start >= 0.0 && s.end <= full.end + 0.1 && (1..=8).contains(&s.speaker)));
    }

    #[tokio::test]
    #[ignore = "run explicitly with the public fixture and bundled native model"]
    async fn public_audio_runs_through_the_live_conversion_and_model() {
        let public = PathBuf::from(std::env::var("STREAM_RECORD_PUBLIC_AUDIO_FIXTURE").unwrap());
        let runtime = PathBuf::from(std::env::var("STREAM_RECORD_DIARIZATION_RUNTIME").unwrap());
        let ffmpeg = PathBuf::from(std::env::var("STREAM_RECORD_FFMPEG").unwrap());
        let test_root = PathBuf::from(std::env::var("STREAM_RECORD_TEST_ROOT").unwrap());
        let folder = tempfile::Builder::new().prefix("public-live-").tempdir_in(&test_root).unwrap();
        crate::review_paths::fs::create_dir(folder.path().join(".checkpoints")).unwrap();
        for index in 0..=1 {
            publish(folder.path(), index, 30);
            crate::review_paths::fs::copy(
                public.join(format!("audio_chunk_{index:03}.mp4")),
                checkpoint_path(folder.path(), index),
            ).unwrap();
        }
        let originals: Vec<_> = (0..=1)
            .map(|index| crate::review_paths::fs::read(checkpoint_path(folder.path(), index)).unwrap())
            .collect();
        let cache = tempfile::Builder::new().prefix("public-cache-").tempdir_in(&test_root).unwrap();
        let result = run_live_window(
            &ffmpeg, runtime, cache.path().to_path_buf(), folder.path(), 0, 1,
        ).await.unwrap();
        assert!(!result.segments.is_empty());
        assert!(result.segments.iter().all(|s| s.start >= 0.0 && s.end <= 60.1 && s.speaker <= 8));
        let missing_runtime = folder.path().join("missing-model");
        assert!(run_live_window(
            &ffmpeg, missing_runtime, cache.path().to_path_buf(), folder.path(), 0, 1,
        ).await.is_err());
        for index in 0..=1 {
            assert_eq!(crate::review_paths::fs::read(checkpoint_path(folder.path(), index)).unwrap(), originals[index as usize]);
        }
        crate::review_paths::fs::write(folder.path().join(".checkpoints/audio_chunk_002.partial"), b"interrupted").unwrap();
        assert_eq!(which::which("ffmpeg.exe").unwrap().canonicalize().unwrap(), ffmpeg.canonicalize().unwrap());
        let recovered = crate::audio::incremental_saver::recover_audio_from_checkpoints(
            folder.path().to_string_lossy().into_owned(), 48_000,
        ).await.unwrap();
        assert_eq!(recovered.status, "success");
        assert_eq!(recovered.chunk_count, 2);
        assert!(folder.path().join("audio.mp4").is_file());
        for index in 0..=1 {
            assert_eq!(crate::review_paths::fs::read(checkpoint_path(folder.path(), index)).unwrap(), originals[index as usize]);
        }
    }

    #[tokio::test]
    #[ignore = "run explicitly with repeated public audio in the isolated fixture directory"]
    async fn public_audio_one_and_three_hour_recovery() {
        let public = PathBuf::from(std::env::var("STREAM_RECORD_PUBLIC_AUDIO_FIXTURE").unwrap());
        let test_root = PathBuf::from(std::env::var("STREAM_RECORD_TEST_ROOT").unwrap());
        let source = public.join("audio_chunk_000.mp4");
        assert!(which::which("ffmpeg.exe").is_ok());
        for count in [120_u32, 360_u32] {
            let folder = tempfile::Builder::new().prefix("public-long-").tempdir_in(&test_root).unwrap();
            crate::review_paths::fs::create_dir(folder.path().join(".checkpoints")).unwrap();
            for index in 0..count {
                let path = checkpoint_path(folder.path(), index);
                crate::review_paths::fs::hard_link(&source, &path).unwrap();
                let timing = crate::audio::incremental_saver::CheckpointTiming {
                    samples: 30 * 48_000, sample_rate: 48_000,
                };
                crate::review_paths::fs::write(
                    crate::audio::incremental_saver::checkpoint_timing_path(&path),
                    serde_json::to_vec(&timing).unwrap(),
                ).unwrap();
            }
            let last = next_live_window(folder.path(), i64::from(count) - 2).unwrap().unwrap();
            assert_eq!(last.index, count - 1);
            assert_eq!(last.end, f64::from(count) * 30.0);
            let recovered = crate::audio::incremental_saver::recover_audio_from_checkpoints(
                folder.path().to_string_lossy().into_owned(), 48_000,
            ).await.unwrap();
            assert_eq!(recovered.status, "success");
            assert_eq!(recovered.chunk_count, count);
            assert_eq!(recovered.estimated_duration_seconds, f64::from(count) * 30.0);
            assert!(folder.path().join("audio.mp4").metadata().unwrap().len() > 100_000);
        }
    }
}

#[tauri::command]
pub fn ko_cancel_diarization() -> Result<(), String> {
    let running = RUNNING.lock().map_err(|_| "참여자 구분 상태 잠금 오류")?;
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
        return Err("진행 중인 녹음·파일 받아쓰기를 먼저 완료하세요.".into());
    }
    let _import_guard = crate::audio::import::ImportGuard::acquire()?;
    let cancel = CancellationToken::new();
    {
        let mut running = RUNNING.lock().map_err(|_| "참여자 구분 상태 잠금 오류")?;
        if running.is_some() {
            return Err("이미 참여자 구분 중입니다.".into());
        }
        *running = Some(cancel.clone());
    }
    let _guard = RunGuard;
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("참여자 구분을 취소했습니다.".into()),
        result = tokio::time::timeout(Duration::from_secs(7200), analyze(&app, &path, &expected_sha256)) => {
            result.map_err(|_| "참여자 구분 제한 시간을 초과했습니다.".to_string())?
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
            "Nemotron 참여자 구분 엔진이 동봉되지 않았습니다. 최신 설치본을 확인하세요.".into(),
        );
    }
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    crate::review_paths::async_fs::create_dir_all(&cache)
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
        .map_err(|_| "참여자 구분용 음성 변환 시간 초과")?
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("참여자 구분용 음성을 변환하지 못했습니다. 원본은 변경하지 않았습니다.".into());
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
        return Err("처리 중 원본 음성이 변경되어 참여자 구분 결과를 적용하지 않았습니다.".into());
    }
    Ok(AudioDiarization {
        audio_sha256: audio.sha256,
        duration_seconds: request.duration_seconds,
        result,
    })
}

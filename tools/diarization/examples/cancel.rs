use std::{
    error::Error,
    path::PathBuf,
    time::{Duration, Instant},
};
use stream_record_diarization_validation::{run, DiarizationError, DiarizationRequest};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let request = DiarizationRequest {
        runtime_dir: PathBuf::from(args.next().ok_or("runtime directory required")?),
        audio_path: PathBuf::from(args.next().ok_or("WAV path required")?),
        duration_seconds: args.next().ok_or("duration required")?.parse()?,
    };
    let cancel = CancellationToken::new();
    let started = Instant::now();
    let inference = run(&request, &cancel);
    let cancellation = async {
        tokio::time::sleep(Duration::from_secs(12)).await;
        let output = tokio::process::Command::new("tasklist.exe")
            .args(["/FI", "IMAGENAME eq nemo-speech.exe", "/FO", "CSV", "/NH"])
            .output()
            .await?;
        let active = String::from_utf8(output.stdout)?
            .to_lowercase()
            .contains("nemo-speech.exe");
        cancel.cancel();
        Ok::<bool, Box<dyn Error>>(active)
    };
    let (result, active) = tokio::join!(inference, cancellation);
    if !matches!(result, Err(DiarizationError::Cancelled)) {
        return Err("inference cancellation failed".into());
    }
    println!(
        "cancelled_after_seconds={:.3}; native_process_observed={}",
        started.elapsed().as_secs_f64(),
        active?
    );
    Ok(())
}

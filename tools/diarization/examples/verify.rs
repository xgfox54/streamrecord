use std::{error::Error, path::PathBuf, time::Instant};
use stream_record_diarization_validation::{run, DiarizationRequest};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let request = DiarizationRequest {
        runtime_dir: PathBuf::from(args.next().ok_or("runtime directory required")?),
        audio_path: PathBuf::from(args.next().ok_or("WAV path required")?),
        duration_seconds: args.next().ok_or("duration required")?.parse()?,
    };
    let started = Instant::now();
    let result = run(&request, &CancellationToken::new()).await?;
    eprintln!("elapsed_seconds={:.3}", started.elapsed().as_secs_f64());
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

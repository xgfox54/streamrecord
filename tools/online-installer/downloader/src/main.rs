use std::{error::Error, io::{self, Write}, time::Duration};

fn artifact_url(version: &str, name: &str) -> Result<String, &'static str> {
    if version != "0.7.6" { return Err("Unsupported release version"); }
    let prefix = format!("Stream-Record-{version}-korean-bundled-vulkan-windows-x64-setup.exe.part-");
    let suffix = name.strip_prefix(&prefix).ok_or("Unsupported artifact name")?;
    if !matches!(suffix, "000" | "001" | "002" | "003" | "004") { return Err("Unsupported artifact part"); }
    Ok(format!("https://gitlab.aigov.go.kr/api/v4/projects/1092/packages/generic/stream-record/{version}/{name}"))
}

async fn download() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--version"] {
        println!("streamrecord-download 1.0.0; reqwest 0.13.5; Rustls TLS 1.3; Windows 10+ x64; static CRT");
        return Ok(());
    }
    if args.len() != 3 { return Err("Expected release, artifact name and byte count".into()); }
    let url = artifact_url(&args[0], &args[1])?;
    let expected: u64 = args[2].parse()?;
    if expected == 0 || expected > 72 * 1024 * 1024 { return Err("Unsupported artifact size".into()); }
    let client = reqwest::Client::builder()
        .tls_backend_rustls()
        .tls_version_min(reqwest::tls::Version::TLS_1_3)
        .tls_version_max(reqwest::tls::Version::TLS_1_3)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(45))
        .timeout(Duration::from_secs(600))
        .user_agent("StreamRecord-OnlineSetup/2.0")
        .build()?;
    let mut response = client.get(url).send().await?;
    if !response.status().is_success() { return Err(format!("Download HTTP {}", response.status()).into()); }
    if response.content_length().is_some_and(|size| size != expected) { return Err("Unexpected content length".into()); }
    let mut received = 0u64;
    let mut stdout = io::stdout().lock();
    while let Some(chunk) = response.chunk().await? {
        received += chunk.len() as u64;
        if received > expected { return Err("Download exceeds expected size".into()); }
        stdout.write_all(&chunk)?;
    }
    stdout.flush()?;
    if received != expected { return Err("Incomplete artifact download".into()); }
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = download().await {
        eprintln!("Download failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::artifact_url;
    #[test]
    fn allows_exact_pinned_parts() {
        for index in 0..5 {
            let name = format!("Stream-Record-0.7.6-korean-bundled-vulkan-windows-x64-setup.exe.part-{index:03}");
            assert!(artifact_url("0.7.6", &name).unwrap().starts_with("https://gitlab.aigov.go.kr/"));
        }
    }
    #[test]
    fn refuses_other_versions_parts_and_paths() {
        for (version, name) in [("0.7.0", "Stream-Record-0.7.0-korean-bundled-vulkan-windows-x64-setup.exe.part-000"), ("0.7.6", "../../file"), ("0.7.6", "https://evil.example/x"), ("0.7.6", "Stream-Record-0.7.6-korean-bundled-vulkan-windows-x64-setup.exe.part-005")] {
            assert!(artifact_url(version, name).is_err());
        }
    }
}

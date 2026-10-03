//! Stream-Record's pinned Whisper distribution policy (MIT).
//! Source: https://huggingface.co/ggerganov/whisper.cpp
//! Repository revision and each file's SHA256 were checked on 2026-09-16.
//! These are file SHA256 values, NOT the model card's SHA1 or Xet chunk hashes.
use anyhow::{anyhow, bail, Result};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::io::AsyncReadExt;

pub const REVISION: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";
pub const REPOSITORY: &str = "https://huggingface.co/ggerganov/whisper.cpp";
pub const MAX_MODEL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const MODEL_SHA256: &[(&str, &str)] = &[
    (
        "tiny",
        "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    ),
    (
        "base",
        "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    ),
    (
        "small",
        "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    ),
    (
        "medium",
        "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    ),
    (
        "large-v3",
        "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
    ),
    (
        "large-v3-turbo",
        "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    ),
    (
        "tiny-q5_1",
        "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7",
    ),
    (
        "base-q5_1",
        "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    ),
    (
        "small-q5_1",
        "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    ),
    (
        "medium-q5_0",
        "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
    ),
    (
        "large-v3-q5_0",
        "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
    ),
    (
        "large-v3-turbo-q5_0",
        "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    ),
];

pub fn expected_sha256(model: &str) -> Result<&'static str> {
    MODEL_SHA256
        .iter()
        .find(|(name, _)| *name == model)
        .map(|(_, hash)| *hash)
        .ok_or_else(|| anyhow!("Stream-Record에서 검증한 다운로드 목록에 없는 모델입니다: {model}"))
}

pub fn pinned_url(model: &str) -> Result<String> {
    expected_sha256(model)?;
    Ok(format!("{REPOSITORY}/resolve/{REVISION}/ggml-{model}.bin"))
}

/// Validate a legacy catalog entry before converting it to the immutable revision.
/// An accidental catalog edit to a vendor mirror or another repository fails closed.
pub fn pin_catalog_url(model: &str, catalog_url: &str) -> Result<String> {
    let pinned = pinned_url(model)?;
    let legacy = format!("{REPOSITORY}/resolve/main/ggml-{model}.bin");
    if catalog_url != legacy && catalog_url != pinned {
        bail!("승인되지 않은 음성 모델 다운로드 출처입니다. 파일은 받지 않았습니다.");
    }
    Ok(pinned)
}

/// Hugging Face's actual large-file transport hosts. No suffix/wildcard matching.
/// New CDN endpoints must be reviewed here; do not fall back to an arbitrary URL.
/// Reviewed 2026-09-17: https://huggingface.co/.well-known/meta.json
/// Includes every exact cdnDomains/lfsDomains entry, not their parent domains as wildcards.
/// Hub aliases, inference servers and third-party mirrors are deliberately not authorized.
pub const HF_TRANSPORT_HOSTS: &[&str] = &[
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cas-bridge.xethub.hf.co",
    "cdn-lfs.hf.co",
    "cdn-lfs-us-1.hf.co",
    "cdn-lfs-eu-1.hf.co",
    "transfer.xethub.hf.co",
    "transfer.xethub-eu.hf.co",
    "aws.cdn.hf.co",
    "us.aws.cdn.hf.co",
    "us-east-1.aws.cdn.hf.co",
    "us-west-2.aws.cdn.hf.co",
    "eu-west-3.aws.cdn.hf.co",
    "ap-southeast-1.aws.cdn.hf.co",
    "us.gcp.cdn.hf.co",
    "us-east1.us.gcp.cdn.hf.co",
    "us-central1.us.gcp.cdn.hf.co",
    "us-west4.us.gcp.cdn.hf.co",
    "europe-west4.us.gcp.cdn.hf.co",
    "asia-southeast1.us.gcp.cdn.hf.co",
];

pub fn allowed_transport_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url
            .host_str()
            .map(|host| HF_TRANSPORT_HOSTS.contains(&host))
            .unwrap_or(false)
}

fn blocked_redirect_message(url: &reqwest::Url) -> String {
    // Never include signed URL queries, credentials or file paths in diagnostic messages.
    format!("승인되지 않은 모델 다운로드 리다이렉트를 차단했습니다 (호스트: {}). 공식 배포 경유지 지원 여부를 확인하세요.",
        url.host_str().unwrap_or("호스트 없음"))
}

pub fn download_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent("Stream-Record-model-downloader")
        .no_proxy()
        .referer(false)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(1800))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("모델 다운로드 리다이렉트 횟수 초과")
            } else if allowed_transport_url(attempt.url()) {
                attempt.follow()
            } else {
                let message = blocked_redirect_message(attempt.url());
                attempt.error(message)
            }
        }))
        .build()?)
}

pub fn verify_digest(expected: &str, actual: &str) -> Result<()> {
    if expected.len() != 64
        || !expected.bytes().all(|b| b.is_ascii_hexdigit())
        || expected != actual
    {
        bail!("음성 모델 SHA-256 검증에 실패했습니다. 손상되었거나 승인한 파일과 다릅니다. 기존 파일은 자동으로 덮어쓰지 않습니다.");
    }
    Ok(())
}

/// Bounded-memory hashing also verifies models installed before the policy existed.
/// No telemetry, network request, file deletion or settings write occurs here.
pub async fn verify_file(model: &str, path: &Path) -> Result<()> {
    let expected = expected_sha256(model)?;
    let mut file = crate::review_paths::async_fs::open_file(path).await?;
    let size = file.metadata().await?.len();
    if size == 0 || size > MAX_MODEL_BYTES {
        bail!("음성 모델 파일 크기가 허용 범위를 벗어났습니다.");
    }
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut hash = Sha256::new();
    let mut read_size = 0u64;
    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        read_size += n as u64;
        if read_size > MAX_MODEL_BYTES {
            bail!("음성 모델 파일 크기 한도 초과");
        }
        hash.update(&buffer[..n]);
    }
    if read_size != size {
        bail!("검증 중 음성 모델 파일 크기가 변경되었습니다.");
    }
    verify_digest(expected, &format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stream_record_manifest_is_complete_and_pinned() {
        assert_eq!(MODEL_SHA256.len(), 12);
        assert_eq!(REVISION.len(), 40);
        let mut names = std::collections::HashSet::new();
        for (name, hash) in MODEL_SHA256 {
            assert!(names.insert(*name));
            assert!(!name.contains(".en"));
            assert_eq!(hash.len(), 64);
            assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
            assert!(pinned_url(name).unwrap().contains(REVISION));
        }
    }
    #[test]
    fn stream_record_catalog_rejects_vendor_and_unknown_paths() {
        assert!(pinned_url("../../secret").is_err());
        assert!(pinned_url("tiny.en").is_err());
        assert!(pin_catalog_url("tiny", "https://meetily.ai/model.bin").is_err());
        assert!(pin_catalog_url("tiny", "https://huggingface.co/vendor/tiny.bin").is_err());
        assert!(
            pin_catalog_url("tiny", &format!("{REPOSITORY}/resolve/main/ggml-tiny.bin")).is_ok()
        );
    }
    #[test]
    fn stream_record_redirects_are_exact_https_hosts_only() {
        for good in [
            "https://huggingface.co/file",
            "https://cas-bridge.xethub.hf.co/x?signature=test",
            "https://cdn-lfs-us-1.hf.co/file",
        ] {
            assert!(allowed_transport_url(&reqwest::Url::parse(good).unwrap()));
        }
        for bad in [
            "http://huggingface.co/file",
            "https://huggingface.co.evil.test/file",
            "https://evil.huggingface.co/file",
            "https://meetily.ai/file",
            "https://huggingface.co:8443/file",
            "https://user:pass@huggingface.co/file",
            "https://127.0.0.1/file",
        ] {
            assert!(!allowed_transport_url(&reqwest::Url::parse(bad).unwrap()));
        }
    }
    #[test]
    fn stream_record_hash_verification_rejects_changed_content() {
        let hash = format!("{:x}", Sha256::digest(b"abc"));
        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(verify_digest(&hash, &hash).is_ok());
        assert!(verify_digest(&hash, &format!("{:x}", Sha256::digest(b"abd"))).is_err());
        assert!(verify_digest("", "").is_err());
    }
    #[test]
    fn stream_record_current_hf_cdn_hosts_are_explicitly_supported() {
        assert_eq!(HF_TRANSPORT_HOSTS.len(), 20);
        let unique: std::collections::HashSet<_> = HF_TRANSPORT_HOSTS.iter().collect();
        assert_eq!(unique.len(), HF_TRANSPORT_HOSTS.len());
        for host in HF_TRANSPORT_HOSTS {
            let url = reqwest::Url::parse(&format!(
                "https://{host}/xet-bridge-us/file?Signature=example"
            ))
            .unwrap();
            assert!(
                allowed_transport_url(&url),
                "Documented CDN was rejected: {host}"
            );
            for bad in [
                format!("http://{host}/file"),
                format!("https://{host}.example.invalid/file"),
                format!("https://{host}:8443/file"),
                format!("https://user@{host}/file"),
            ] {
                assert!(!allowed_transport_url(&reqwest::Url::parse(&bad).unwrap()));
            }
        }
        assert!(!allowed_transport_url(
            &reqwest::Url::parse("https://other.aws.cdn.hf.co/file").unwrap()
        ));
        assert!(!allowed_transport_url(
            &reqwest::Url::parse("https://huggingface.cn/file").unwrap()
        ));
        assert!(!allowed_transport_url(
            &reqwest::Url::parse("https://api-inference.huggingface.co/file").unwrap()
        ));
    }
    #[test]
    fn stream_record_redirect_error_does_not_disclose_signed_urls() {
        let url = reqwest::Url::parse(
            "https://unlisted.example.invalid/private-path?Signature=private-signature-test",
        )
        .unwrap();
        let message = blocked_redirect_message(&url);
        assert!(message.contains("unlisted.example.invalid"));
        assert!(!message.contains("private-path"));
        assert!(!message.contains("Signature"));
        assert!(!message.contains("private-signature-test"));
    }
    #[tokio::test]
    #[ignore = "Explicit network approval required: downloads and hashes the public small-q5_1 model without installing it"]
    async fn stream_record_live_small_q5_1_download_uses_production_policy() {
        assert_eq!(
            std::env::var("STREAM_RECORD_NETWORK_TEST").as_deref(),
            Ok("1"),
            "This test requires explicit opt-in; it is not an offline unit test"
        );
        let model = "small-q5_1";
        let mut response = download_client()
            .unwrap()
            .get(pinned_url(model).unwrap())
            .send()
            .await
            .expect("Production download redirect policy rejected the live download")
            .error_for_status()
            .expect("Model server did not return a successful response");
        assert!(allowed_transport_url(response.url()));
        let final_host = response.url().host_str().unwrap_or("").to_owned();
        let declared_size = response.content_length();
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .expect("Live model download was interrupted")
        {
            bytes += chunk.len() as u64;
            assert!(bytes <= MAX_MODEL_BYTES);
            hash.update(&chunk);
        }
        assert!(bytes > 0);
        if let Some(size) = declared_size {
            assert_eq!(bytes, size);
        }
        verify_digest(
            expected_sha256(model).unwrap(),
            &format!("{:x}", hash.finalize()),
        )
        .unwrap();
        println!("LIVE_MODEL_DOWNLOAD_VERIFIED host={final_host} bytes={bytes} sha256_verified=true model={model}");
    }
    #[tokio::test]
    async fn stream_record_invalid_file_is_rejected_but_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ggml-tiny.bin");
        crate::review_paths::async_fs::write(&path, b"lmggthis-is-not-the-model")
            .await
            .unwrap();
        assert!(verify_file("tiny", &path).await.is_err());
        assert!(path.exists());
    }
}

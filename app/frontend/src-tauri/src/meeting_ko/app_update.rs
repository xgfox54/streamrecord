//! Stream-Record update channel.
//!
//! Each GitLab release uploads `latest.json` and its minisign signature to a fixed generic-package path.
//! The manifest names the release's small online installer (with size and SHA-256); that installer already
//! pins the size and SHA-256 of every installer part it downloads. The app only accepts a manifest signed by
//! the Stream-Record update key, so a changed server response cannot make it run another program.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Runtime};

const CHANNEL: &str = "https://gitlab.aigov.go.kr/api/v4/projects/1092/packages/generic/stream-record-update/stable/";
const INSTALLER_PREFIX: &str = "https://gitlab.aigov.go.kr/api/v4/projects/1092/packages/generic/stream-record-online/";
/// Public half of the Stream-Record update signing key (the private key never leaves the release PC).
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFDNkVBQkE5QzBDMEYzNjcKUldSbjg4REFxYXR1ckQ0ZEFpbjJ6Rmw4NXZOS29JWitRZUN1YjdnWVpUYkw2aWtuQlRhNDJkcm8K";
const MAX_MANIFEST: usize = 64 * 1024;
const MAX_INSTALLER: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    version: String,
    notes: String,
    release_url: String,
    online_installer: Artifact,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    name: String,
    url: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    current_version: String,
    version: String,
    notes: String,
    release_url: String,
}

fn version(value: &str) -> Option<[u64; 3]> {
    let mut parts = value.split('.');
    let parsed = [parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?];
    parts.next().is_none().then_some(parsed)
}

fn newer(candidate: &str, current: &str) -> bool {
    matches!((version(candidate), version(current)), (Some(a), Some(b)) if a > b)
}

fn verify(json: &[u8], signature: &str, public_key: &str) -> Result<Manifest, String> {
    let text = |value: &str| -> Result<String, String> {
        let bytes = STANDARD.decode(value.trim()).map_err(|_| "업데이트 서명 형식이 올바르지 않습니다.".to_string())?;
        String::from_utf8(bytes).map_err(|_| "업데이트 서명 형식이 올바르지 않습니다.".to_string())
    };
    let key = minisign_verify::PublicKey::decode(&text(public_key)?).map_err(|_| "업데이트 확인 키를 읽지 못했습니다.")?;
    let signature = minisign_verify::Signature::decode(&text(signature)?).map_err(|_| "업데이트 서명 형식이 올바르지 않습니다.")?;
    key.verify(json, &signature, true).map_err(|_| "업데이트 서명이 맞지 않아 설치하지 않습니다.")?;
    let manifest: Manifest = serde_json::from_slice(json).map_err(|_| "업데이트 정보 형식이 올바르지 않습니다.")?;
    let installer = &manifest.online_installer;
    let name = format!("Stream-Record-{}-online-cpu-win10-win11-setup.exe", manifest.version);
    let allowed = version(&manifest.version).is_some()
        && installer.name == name
        && installer.url == format!("{INSTALLER_PREFIX}{}/{name}", manifest.version)
        && (1..=MAX_INSTALLER).contains(&installer.bytes)
        && installer.sha256.len() == 64
        && installer.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && manifest.release_url.starts_with("https://gitlab.aigov.go.kr/memory365/streamrecord/-/releases/");
    if !allowed {
        return Err("업데이트 정보가 허용 범위를 벗어났습니다.".into());
    }
    Ok(manifest)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| "업데이트 연결을 준비하지 못했습니다.".to_string())
}

async fn fetch(client: &reqwest::Client, url: &str, limit: u64) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().await.map_err(|_| "업데이트 서버에 연결하지 못했습니다.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("업데이트 서버 응답 오류 (HTTP {}).", response.status().as_u16()));
    }
    if response.content_length().is_some_and(|length| length > limit) {
        return Err("업데이트 파일 크기가 허용 범위를 벗어났습니다.".into());
    }
    let bytes = response.bytes().await.map_err(|_| "업데이트를 받는 중 연결이 끊겼습니다.".to_string())?;
    if bytes.len() as u64 > limit {
        return Err("업데이트 파일 크기가 허용 범위를 벗어났습니다.".into());
    }
    Ok(bytes.to_vec())
}

async fn latest(client: &reqwest::Client) -> Result<Manifest, String> {
    let json_url = format!("{CHANNEL}latest.json");
    let signature_url = format!("{CHANNEL}latest.json.sig");
    let (json, signature) = tokio::try_join!(fetch(client, &json_url, MAX_MANIFEST as u64), fetch(client, &signature_url, MAX_MANIFEST as u64))?;
    verify(&json, &String::from_utf8_lossy(&signature), PUBLIC_KEY)
}

/// Returns the newer signed release, or none when this build is current.
#[tauri::command]
pub async fn ko_update_check<R: Runtime>(app: AppHandle<R>) -> Result<Option<AvailableUpdate>, String> {
    let current = app.package_info().version.to_string();
    let manifest = latest(&client()?).await?;
    Ok(newer(&manifest.version, &current).then(|| AvailableUpdate {
        current_version: current,
        version: manifest.version,
        notes: manifest.notes,
        release_url: manifest.release_url,
    }))
}

/// Downloads and verifies the online installer of `version`, then starts it. The installer waits for this app to
/// exit, so the caller saves the session and calls `ko_exit_app` next.
#[tauri::command]
pub async fn ko_update_install<R: Runtime>(app: AppHandle<R>, version: String) -> Result<(), String> {
    super::ensure_exit_ready(
        crate::audio::recording_commands::is_recording().await,
        crate::audio::import::is_import_in_progress(),
        super::GENERATING.load(Ordering::SeqCst),
    )?;
    let current = app.package_info().version.to_string();
    let client = client()?;
    let manifest = latest(&client).await?;
    if manifest.version != version || !newer(&manifest.version, &current) {
        return Err("업데이트 정보가 바뀌었습니다. 다시 확인해 주세요.".into());
    }
    let installer = &manifest.online_installer;
    let bytes = fetch(&client, &installer.url, installer.bytes).await?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    if bytes.len() as u64 != installer.bytes || digest != installer.sha256 {
        return Err("내려받은 업데이트 설치 파일이 서명된 정보와 다릅니다. 설치하지 않습니다.".into());
    }
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LocalAppData 경로를 찾지 못했습니다.")?;
    let folder = PathBuf::from(local).join("StreamRecordInstaller").join("app-update").join(&manifest.version);
    std::fs::create_dir_all(&folder).map_err(|e| format!("업데이트 폴더를 만들지 못했습니다: {e}"))?;
    let file = folder.join(&installer.name);
    let partial = folder.join(format!("{}.partial", installer.name));
    std::fs::write(&partial, &bytes).map_err(|e| format!("업데이트 설치 파일을 저장하지 못했습니다: {e}"))?;
    std::fs::rename(&partial, &file).map_err(|e| format!("업데이트 설치 파일을 저장하지 못했습니다: {e}"))?;
    let mut command = std::process::Command::new(&file);
    command.arg("--after-app-exit");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map_err(|e| format!("업데이트 설치 프로그램을 시작하지 못했습니다: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const TEST_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEVEMzczOUExODU4QTBGRDAKUldUUUQ0cUZvVGszN2ZJWjhDWXFiM2ZTdit2cTJ6ajNpYWsvdnhXbmR2aWRsUms3NE0wYWlVd1UK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUUUQ0cUZvVGszN2V3ZmFuS2ZSYjZsZWxiZHh5a0wrWis3czZ2QVk5WnlrazJoYnBtcjVhbjI5Szh2RWVoMW9IS1hHQU5TN0p2bGF3UFR1OUtxSmFWajc3QnZ5NXlmVXdNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxMTE5NTIyCWZpbGU6bWFuaWZlc3QuanNvbgpNemFiVkZibkZNWWlVSTRiYWJuOTVCTjQrQU5DV0Z6MnJyZXliaE9BL0VlU2wzTlgvbkhZbGJTbWpWTlExZEVIWmZsd0RsY1JIb20xZ2w4Uk40T2xCZz09Cg==";
    const TEST_MANIFEST: &str = r#"{"version":"0.6.99","notes":"테스트","releaseUrl":"https://gitlab.aigov.go.kr/memory365/streamrecord/-/releases/v0.6.99","onlineInstaller":{"name":"Stream-Record-0.6.99-online-cpu-win10-win11-setup.exe","url":"https://gitlab.aigov.go.kr/api/v4/projects/1092/packages/generic/stream-record-online/0.6.99/Stream-Record-0.6.99-online-cpu-win10-win11-setup.exe","bytes":4418048,"sha256":"3cab6e263af0c1c7d34551eb1c1775916a4f87b93748bc5631828dfc29d25ea4"}}"#;

    #[test]
    fn signed_manifest_is_accepted() {
        let manifest = verify(TEST_MANIFEST.as_bytes(), TEST_SIGNATURE, TEST_KEY).unwrap();
        assert_eq!(manifest.version, "0.6.99");
        assert_eq!(manifest.online_installer.bytes, 4418048);
    }

    #[test]
    fn changed_manifest_or_other_key_is_refused() {
        let changed = TEST_MANIFEST.replace("4418048", "4418049");
        assert!(verify(changed.as_bytes(), TEST_SIGNATURE, TEST_KEY).is_err());
        assert!(verify(TEST_MANIFEST.as_bytes(), TEST_SIGNATURE, PUBLIC_KEY).is_err());
        assert!(verify(TEST_MANIFEST.as_bytes(), "not-a-signature", TEST_KEY).is_err());
    }

    #[test]
    fn versions_compare_numerically_and_reject_other_forms() {
        assert!(newer("0.6.13", "0.6.12"));
        assert!(newer("0.10.0", "0.9.9"));
        assert!(!newer("0.6.12", "0.6.12"));
        assert!(!newer("0.6.11", "0.6.12"));
        assert!(!newer("0.6.13-rc.1", "0.6.12"));
        assert!(!newer("1.0", "0.6.12"));
    }

    #[test]
    fn production_key_decodes() {
        let text = String::from_utf8(STANDARD.decode(PUBLIC_KEY).unwrap()).unwrap();
        assert!(minisign_verify::PublicKey::decode(&text).is_ok());
    }
}

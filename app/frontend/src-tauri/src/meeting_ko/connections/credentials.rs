//! User-scoped encrypted storage. Plaintext is never written to disk.
use sha2::{Digest, Sha256};
use std::{io::Write, path::PathBuf};

fn path(key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || key.len() > 120 {
        return Err("인증 정보 식별자가 올바르지 않습니다.".into());
    }
    let root = crate::review_paths::data_local_dir().ok_or("사용자 저장 경로를 찾지 못했습니다.")?;
    Ok(root
        .join("Stream-Record")
        .join("credentials")
        .join(format!("{:x}.dpapi", Sha256::digest(key.as_bytes()))))
}

#[cfg(windows)]
pub fn read(key: &str) -> Result<Option<String>, String> {
    #[cfg(feature = "review-isolation")] { let _ = key; return Ok(None); }
    let encrypted = match crate::review_paths::fs::read(path(key)?) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("보호된 인증 정보를 읽지 못했습니다.".into()),
    };
    let decrypted =
        windows_dpapi::decrypt_data(&encrypted, windows_dpapi::Scope::User, Some(key.as_bytes()))
            .map_err(|_| "현재 Windows 사용자로 인증 정보를 복호화하지 못했습니다.")?;
    String::from_utf8(decrypted)
        .map(Some)
        .map_err(|_| "인증 정보 형식이 올바르지 않습니다.".into())
}

#[cfg(windows)]
pub fn write(key: &str, value: &str) -> Result<(), String> {
    #[cfg(feature = "review-isolation")] { let _ = (key,value); return Err("Credential encryption is disabled in review mode".into()); }
    if value.len() > 1024 * 1024 {
        return Err("인증 정보가 저장 한도를 초과했습니다.".into());
    }
    let target = path(key)?;
    let parent = target.parent().ok_or("인증 저장 경로 오류")?;
    crate::review_paths::fs::create_dir_all(parent).map_err(|_| "인증 저장 폴더를 만들지 못했습니다.")?;
    let ciphertext = windows_dpapi::encrypt_data(
        value.as_bytes(),
        windows_dpapi::Scope::User,
        Some(key.as_bytes()),
    )
    .map_err(|_| "Windows 인증 정보 보호에 실패했습니다.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "인증 저장 파일을 만들지 못했습니다.")?;
    temporary
        .write_all(&ciphertext)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "인증 정보를 저장하지 못했습니다.")?;
    temporary
        .persist(target)
        .map_err(|_| "인증 정보를 안전하게 교체하지 못했습니다.")?;
    Ok(())
}

#[cfg(not(windows))]
pub fn read(_key: &str) -> Result<Option<String>, String> {
    Err("이 빌드는 Windows 보안 저장소가 필요합니다.".into())
}
#[cfg(not(windows))]
pub fn write(_key: &str, _value: &str) -> Result<(), String> {
    Err("이 빌드는 Windows 보안 저장소가 필요합니다.".into())
}

pub fn remove(key: &str) -> Result<(), String> {
    match crate::review_paths::fs::remove_file(path(key)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("인증 정보를 삭제하지 못했습니다.".into()),
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn large_secret_survives_atomic_replacement() {
        // Given a separate test credential larger than Credential Manager permits.
        let key = format!("test-{}", uuid::Uuid::new_v4());
        let secret = "not-a-real-secret".repeat(1000);
        // When encrypted and replaced in the real Windows user scope.
        super::write(&key, "old").unwrap();
        super::write(&key, &secret).unwrap();
        let result = super::read(&key).unwrap();
        let bytes = crate::review_paths::fs::read(super::path(&key).unwrap()).unwrap();
        super::remove(&key).unwrap();
        // Then the complete replacement is readable and disk contains no plaintext.
        assert_eq!(result.as_deref(), Some(secret.as_str()));
        assert!(!bytes
            .windows(b"not-a-real-secret".len())
            .any(|b| b == b"not-a-real-secret"));
    }
}

use serde::Deserialize;
use serde_json::Value;
use std::path::Path;

#[derive(Deserialize)]
struct LegacyFile {
    endpoint: Option<Value>,
}

/// Missing files identify new installs; existing empty files identify the implicit old default.
pub(super) fn read(path: &Path) -> Result<Option<Value>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("이전 연결 설정을 읽지 못했습니다.".into()),
    };
    let value: LegacyFile =
        serde_json::from_slice(&bytes).map_err(|_| "이전 연결 설정 형식이 올바르지 않습니다.")?;
    let endpoint = value
        .endpoint
        .unwrap_or_else(|| serde_json::json!({"base":"http://127.0.0.1:10100/v1"}));
    if endpoint.get("connectionId").is_some() && endpoint.get("apiKey").is_none() {
        return Ok(None);
    }
    Ok(Some(endpoint))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn existing_empty_file_preserves_implicit_opencodex_default() {
        // Given the exact observed installed configuration shape: an existing two-byte {} file.
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("stream_record_proxy.json");
        std::fs::write(&path, b"{}").unwrap();
        // When startup reads the old connection, then it obtains the previous implicit default.
        let value = read(&path)
            .unwrap()
            .expect("existing empty legacy store must migrate its implicit default");
        assert_eq!(value["base"], "http://127.0.0.1:10100/v1");
        assert!(value.get("apiKey").is_none());
    }

    #[test]
    fn fresh_install_without_legacy_file_has_no_connection() {
        // Given a new install directory, when read, then no file or profile is manufactured.
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("stream_record_proxy.json");
        assert_eq!(read(&path).unwrap(), None);
        assert!(!path.exists());
    }

    #[test]
    fn migrated_marker_survives_profile_deletion_and_restart() {
        // Given migration marker still present after the user removed the new profile.
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("stream_record_proxy.json");
        let marker = json!({"base":"http://127.0.0.1:10100/v1","connectionId":"migrated"});
        std::fs::write(
            &path,
            serde_json::to_vec(&json!({"endpoint":marker})).unwrap(),
        )
        .unwrap();
        // When read on restart, then migration is skipped even though the profile no longer exists.
        assert_eq!(read(&path).unwrap(), None);
    }

    #[test]
    fn explicit_endpoint_retains_authentication_and_destination() {
        // Given an explicitly saved endpoint with a synthetic credential.
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("stream_record_proxy.json");
        let endpoint = json!({"base":"https://example.test/v1","apiKey":"fixture-secret"});
        std::fs::write(
            &path,
            serde_json::to_vec(&json!({"endpoint":endpoint})).unwrap(),
        )
        .unwrap();
        // When read, then the explicit migration input is unchanged.
        assert_eq!(read(&path).unwrap(), Some(endpoint));
    }
}

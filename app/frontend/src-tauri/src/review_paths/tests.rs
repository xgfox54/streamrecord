use super::*;
fn policy() -> Policy { context().unwrap().clone() }
#[test]
fn rejects_missing_root_and_nonce() {
    let parent = PathBuf::from(PARENT);
    assert!(parse_root(None,Some("a".repeat(32)),&parent).is_err());
    assert!(parse_root(Some(parent.join(format!("v063-{}","a".repeat(32)))),None,&parent).is_err());
}
#[test]
fn rejects_existing_user_home_and_sibling_prefix() {
    let p=policy();
    assert!(p.check(Path::new("C:/Users/Rumans/AppData/Local/private.db"),true).is_err());
    assert!(p.check(&PathBuf::from(format!("{}-sibling/file.json",p.root.display())),true).is_err());
}
#[test]
fn rejects_relative_parent_stream_device_and_ambiguous_paths() {
    let p=policy();
    for path in [PathBuf::from("relative.json"),p.root.join("../escape.json"),p.root.join("Temp/../../escape.json"),p.root.join("Temp/file.txt:stream"),p.root.join("Temp/NUL"),p.root.join("Temp/trailing. "),PathBuf::from(r"\\server\share\file"),PathBuf::from(r"\\.\C:\file")] {
        assert!(p.check(&path,true).is_err(),"{}",path.display());
    }
}
#[test]
fn permits_new_nested_sinks_and_internal_canonical_paths() {
    let p=policy();
    assert!(p.check(&p.root.join("Temp/new/nested/file.json"),true).is_ok());
    let native=p.root.canonicalize().unwrap();
    assert!(p.check(&native.join("Temp/new/file.json"),true).is_ok());
}
#[test]
fn resource_files_are_read_only_and_root_cannot_be_deleted() {
    let p=policy();assert!(p.check(&p.resources.join("bundled-models/model.bin"),false).is_ok());
    assert!(p.check(&p.resources.join("bundled-models/model.bin"),true).is_err());
    assert!(p.check(&p.root,true).is_err());
}
#[test]
fn std_constructors_and_options_fail_closed_before_mutation() {
    let outside=policy().root.parent().unwrap().join("forbidden-write-test.txt");
    assert!(!outside.exists());
    assert!(fs::write(&outside,b"private").is_err());
    assert!(fs::create_file(&outside).is_err());
    assert!(fs::OpenOptions::new().write(true).create(true).open(&outside).is_err());
    assert!(fs::open_file(&outside).is_err());
    assert!(!outside.exists());
}
#[tokio::test]
async fn async_constructors_and_options_fail_closed_before_mutation() {
    let outside=policy().root.parent().unwrap().join("forbidden-async-write-test.txt");
    assert!(!outside.exists());
    assert!(async_fs::write(&outside,b"private").await.is_err());
    assert!(async_fs::create_file(&outside).await.is_err());
    assert!(async_fs::OpenOptions::new().write(true).create(true).open(&outside).await.is_err());
    assert!(!outside.exists());
}
#[test]
fn rename_copy_delete_and_hardlink_cannot_escape() {
    let p=policy();let file=p.root.join("Temp/mutation-source.txt");fs::write(&file,b"synthetic").unwrap();
    let outside=p.root.parent().unwrap().join("forbidden-mutation-test.txt");
    assert!(fs::copy(&file,&outside).is_err());assert!(fs::rename(&file,&outside).is_err());
    assert!(fs::hard_link(&file,&outside).is_err());assert!(fs::remove_file(&outside).is_err());
    assert_eq!(fs::read(&file).unwrap(),b"synthetic");assert!(!outside.exists());fs::remove_file(file).unwrap();
}
#[test]
fn rejects_store_path_escape_and_missing_payload_paths() {
    assert!(store_path("analytics.json").is_ok());
    for path in ["", "../analytics.json","C:/Users/Rumans/private.json","settings.json:stream"] { assert!(store_path(path).is_err(),"{path}"); }
    assert!(check_payload(&serde_json::json!({"args":{"directory":"C:/Users/Rumans"}})).is_err());
    assert!(check_payload(&serde_json::json!({"path":37})).is_err());
    assert!(check_payload(&serde_json::json!({"rows":[{"path":"../escape"}]})).is_err());
}
#[test]
fn model_fallbacks_and_credentials_use_the_explicit_root() {
    let p=policy();
    assert_eq!(home_dir().unwrap(),p.root);
    for name in ["whisper","parakeet","summary"] { assert!(model_directory(None,name).unwrap().unwrap().starts_with(&p.root)); }
    assert!(model_directory(Some(PathBuf::from("C:/Users/Rumans/models")),"whisper").is_err());
    assert!(data_local_dir().unwrap().join("Stream-Record/credentials").starts_with(&p.root));
}
#[cfg(windows)]
#[test]
fn rejects_junction_escape_even_when_the_link_points_to_a_synthetic_directory() {
    let link=std::env::var_os("STREAM_RECORD_REVIEW_TEST_JUNCTION").map(PathBuf::from).expect("test runner must create a real synthetic junction");
    let outside=std::env::var_os("STREAM_RECORD_REVIEW_TEST_JUNCTION_TARGET").map(PathBuf::from).unwrap();
    assert!(link.exists());assert!(plain(&link).is_err());
    assert!(fs::write(link.join("escape.txt"),b"synthetic").is_err());
    assert!(!outside.join("escape.txt").exists());
}

#[tokio::test]
async fn sqlite_cannot_create_or_migrate_outside_the_review_root() {
    let p=policy();
    let outside=p.root.parent().unwrap().join("forbidden-sqlite-test.sqlite");
    let foreign=outside.to_str().unwrap();
    assert!(crate::database::manager::DatabaseManager::new(foreign,foreign).await.is_err());
    assert!(!outside.exists());
    let inside=p.root.join("Temp/isolated-synthetic-test.sqlite");
    let legacy=p.root.join("Temp/nonexistent-synthetic-legacy.db");
    let db=crate::database::manager::DatabaseManager::new(inside.to_str().unwrap(),legacy.to_str().unwrap()).await.unwrap();
    assert!(inside.is_file());
    db.cleanup().await.unwrap();
}

#[test]
fn review_document_and_audio_sinks_are_explicit_and_foreign_known_folders_stay_denied() {
    let p = policy();
    assert_eq!(document_dir(), Some(p.root.join("Documents")));
    assert_eq!(audio_dir(), Some(p.root.join("Music")));
    for path in [document_dir().unwrap(), audio_dir().unwrap()] {
        let probe = path.join("review-directory-wrapper-test.tmp");
        fs::write(&probe, b"synthetic").unwrap();
        assert_eq!(fs::read(&probe).unwrap(), b"synthetic");
        fs::remove_file(probe).unwrap();
    }
    for path in [dirs::document_dir(), dirs::audio_dir(), dirs_tauri::document_dir(), dirs_tauri::audio_dir()].into_iter().flatten() {
        if !path.starts_with(&p.root) {
            assert!(p.check(&path, true).is_err());
            assert!(p.check(&path, false).is_err());
        }
    }
    assert!(p.check(Path::new("C:/Users/USER/Documents/review-forbidden.tmp"), true).is_err());
}

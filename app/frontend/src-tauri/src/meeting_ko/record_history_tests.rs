use super::*;
use serde_json::json;

fn snapshot(id: &str) -> Value {
    json!({"version":1,"recordId":id,"title":"회의","rows":[{"text":"원문","reviewed_text":"검토","speaker_id":"speaker_0","ai_correction":{"text":"보정"}}],"minutes":"회의록","audioPath":"audio.wav","summaryDraft":{"key":"k"},"futureField":{"kept":true}})
}

#[test]
fn complete_snapshot_survives_record_switch_and_overwrite() {
    let dir = tempfile::tempdir().expect("fixture");
    let first = snapshot("record-one");
    save(dir.path(), &first.to_string()).expect("first save");
    save(dir.path(), &snapshot("record-two").to_string()).expect("second save");
    assert_eq!(load(dir.path(), "record-one").expect("load"), first);
    assert_eq!(list(dir.path()).expect("list").records.len(), 2);
    let mut changed = first.clone(); changed["title"] = json!("수정된 제목");
    save(dir.path(), &changed.to_string()).expect("overwrite");
    assert_eq!(load(dir.path(), "record-one").expect("load changed"), changed);
    assert_eq!(list(dir.path()).expect("list").records.len(), 2);
}

#[test]
fn migration_preserves_original_bytes_and_is_idempotent() {
    let dir = tempfile::tempdir().expect("fixture");
    let content = "{\"version\":1, \"title\":\"기존 94구간\",\"rows\":[],\"minutes\":\"원본\"}";
    fs::write(dir.path().join("last-session.json"), content).expect("seed");
    let first = current(dir.path()).expect("migration").expect("snapshot");
    let second = current(dir.path()).expect("repeat").expect("snapshot");
    assert_eq!(first, second);
    assert_eq!(fs::read_to_string(dir.path().join("last-session.json")).expect("original"), content);
    assert_eq!(list(dir.path()).expect("list").records.len(), 1);
}

#[test]
fn traversal_and_invalid_saves_leave_last_record_intact() {
    let dir = tempfile::tempdir().expect("fixture");
    let first = snapshot("safe-record");
    save(dir.path(), &first.to_string()).expect("save");
    assert!(load(dir.path(), "../last-session").is_err());
    assert!(save(dir.path(), &snapshot("../../outside").to_string()).is_err());
    assert!(save(dir.path(), "{\"version\":2,\"rows\":[],\"title\":\"x\"}").is_err());
    assert_eq!(current(dir.path()).expect("current"), Some(first));
}

#[test]
fn corrupt_record_does_not_hide_valid_records() {
    let dir = tempfile::tempdir().expect("fixture");
    save(dir.path(), &snapshot("safe-record").to_string()).expect("save");
    fs::write(dir.path().join("records/broken.json"), "{").expect("corrupt");
    let listing = list(dir.path()).expect("list");
    assert_eq!(listing.records.len(), 1);
    assert_eq!(listing.warnings.len(), 1);
    assert!(load(dir.path(), "broken").is_err());
}

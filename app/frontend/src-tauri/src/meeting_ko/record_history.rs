use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::Write, path::Path, sync::Mutex};

const LIMIT: u64 = 8_000_000;
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub row_count: usize,
}

#[derive(Serialize, Deserialize)]
struct Record {
    summary: RecordSummary,
    snapshot: Value,
}

#[derive(Serialize)]
pub struct RecordList {
    records: Vec<RecordSummary>,
    warnings: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn parse_snapshot(content: &str) -> Result<Value, String> {
    if content.len() > LIMIT as usize {
        return Err("기록 크기가 8MB를 초과합니다.".into());
    }
    let value: Value = serde_json::from_str(content).map_err(|e| format!("기록 형식 오류: {e}"))?;
    if value["version"] != 1 || !value["rows"].is_array() || !value["title"].is_string() {
        return Err("지원하지 않는 기록 형식입니다. 원본은 변경하지 않았습니다.".into());
    }
    Ok(value)
}

fn read_text(path: &Path) -> Result<String, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > LIMIT + 4096 {
        return Err("기록 크기가 한도를 초과합니다.".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true)
        .open(&temp).map_err(|e| e.to_string())?;
    file.write_all(content).and_then(|()| file.sync_all()).map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(temp, path).map_err(|e| e.to_string())
}

fn record_snapshot(dir: &Path, snapshot: &Value) -> Result<(), String> {
    let id = snapshot["recordId"].as_str().filter(|id| valid_id(id))
        .ok_or("기록 식별자가 올바르지 않습니다.")?;
    let summary = RecordSummary {
        id: id.to_owned(),
        title: snapshot["title"].as_str().unwrap_or("새 기록").to_owned(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        row_count: snapshot["rows"].as_array().map_or(0, Vec::len),
    };
    let records = dir.join("records");
    fs::create_dir_all(&records).map_err(|e| e.to_string())?;
    let record = Record { summary, snapshot: snapshot.clone() };
    atomic_write(&records.join(format!("{id}.json")), &serde_json::to_vec(&record).map_err(|e| e.to_string())?)
}

pub fn save(dir: &Path, content: &str) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut snapshot = parse_snapshot(content)?;
    if snapshot.get("recordId").is_none() {
        snapshot["recordId"] = Value::String(legacy_id(content));
    }
    record_snapshot(dir, &snapshot)?;
    atomic_write(&dir.join("last-session.json"), &serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?)
}

fn legacy_id(content: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("legacy-{:x}", Sha256::digest(content.as_bytes()))
}

pub fn current(dir: &Path) -> Result<Option<Value>, String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = dir.join("last-session.json");
    if !path.try_exists().map_err(|e| e.to_string())? { return Ok(None); }
    let content = read_text(&path)?;
    let mut snapshot = parse_snapshot(&content)?;
    if snapshot.get("recordId").is_none() {
        snapshot["recordId"] = Value::String(legacy_id(&content));
        record_snapshot(dir, &snapshot)?;
    }
    Ok(Some(snapshot))
}

pub fn load(dir: &Path, id: &str) -> Result<Value, String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    if !valid_id(id) { return Err("기록 식별자가 올바르지 않습니다.".into()); }
    let record: Record = serde_json::from_str(&read_text(&dir.join("records").join(format!("{id}.json")))?)
        .map_err(|e| format!("기록을 열 수 없습니다: {e}"))?;
    if record.summary.id != id || record.snapshot["recordId"] != id {
        return Err("기록 식별자가 일치하지 않습니다.".into());
    }
    parse_snapshot(&serde_json::to_string(&record.snapshot).map_err(|e| e.to_string())?)
}

pub fn list(dir: &Path) -> Result<RecordList, String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let records_dir = dir.join("records");
    let mut result = RecordList { records: Vec::new(), warnings: Vec::new() };
    if !records_dir.try_exists().map_err(|e| e.to_string())? { return Ok(result); }
    for entry in fs::read_dir(records_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        let record = read_text(&path).and_then(|text| serde_json::from_str::<Record>(&text).map_err(|e| e.to_string()));
        match record {
            Ok(record) if valid_id(&record.summary.id) && path.file_stem().and_then(|s| s.to_str()) == Some(&record.summary.id) => result.records.push(record.summary),
            Ok(_) | Err(_) => result.warnings.push("읽지 못한 기록이 있습니다. 원본 파일은 보존되어 있습니다.".into()),
        }
    }
    result.records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
    Ok(result)
}

#[cfg(test)]
#[path = "record_history_tests.rs"]
mod tests;

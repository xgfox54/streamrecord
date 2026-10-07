//! Stream-Record workspace (MIT). Explicit capture input; local and opt-in proxy summaries.
mod generation;
pub mod connections;
pub mod chatgpt;
pub mod diarization;
pub mod diarization_commands;
pub mod recovery_commands;
pub mod app_update;
mod builtin;
mod model_catalog;
mod record_history;
mod recording_source;

use serde_json::{json, Value};
use crate::review_paths::fs::OpenOptions;
use std::{io::Write, sync::atomic::{AtomicBool, Ordering}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, Runtime};

static GENERATING: AtomicBool = AtomicBool::new(false);
static RECORDING_TRANSITION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static EXITING: AtomicBool = AtomicBool::new(false);
const DEFAULT_PROXY_BASE: &str = "http://127.0.0.1:10100/v1";
const OLLAMA_BASE: &str = "http://127.0.0.1:11434";
const VIDEO_WINDOW_LABEL: &str = "ko-video";

const DATA_DIR_NAME: &str = "Stream-Record";
const LEGACY_DATA_DIR_NAME: &str = "Meetily-Korean";

fn ko_data_dir<R: Runtime>(_app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    #[cfg(feature = "review-isolation")]
    let documents = crate::review_paths::document_dir().ok_or("Missing review documents directory")?;
    #[cfg(not(feature = "review-isolation"))]
    let documents = _app.path().document_dir().map_err(|e| e.to_string())?;
    ko_data_dir_from_documents(documents)
}

fn ko_data_dir_from_documents(documents: std::path::PathBuf) -> Result<std::path::PathBuf, String> {
    let current = documents.join(DATA_DIR_NAME);
    let legacy = documents.join(LEGACY_DATA_DIR_NAME);
    if !current.exists() && legacy.is_dir() {
        if crate::review_paths::fs::rename(&legacy, &current).is_err() {
            return Ok(legacy);
        }
    }
    Ok(current)
}

#[cfg(all(test, feature = "review-isolation"))]
mod review_export_tests {
    use super::*;

    #[test]
    fn export_directory_and_file_stay_in_review_documents() {
        crate::review_paths::initialize().unwrap();
        let documents = crate::review_paths::document_dir().unwrap();
        let dir = ko_data_dir_from_documents(documents.clone()).unwrap().join("Exports");
        assert_eq!(dir, crate::review_paths::home_dir().unwrap().join("Documents/Stream-Record/Exports"));
        crate::review_paths::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("review-export-regression.txt");
        let mut file = OpenOptions::new().write(true).create_new(true).open(&path).unwrap();
        file.write_all(b"synthetic export").unwrap();
        file.sync_all().unwrap();
        drop(file);
        assert_eq!(crate::review_paths::fs::read(&path).unwrap(), b"synthetic export");
        crate::review_paths::fs::remove_file(path).unwrap();
        assert!(crate::review_paths::guard_write("C:/Users/USER/Documents/Stream-Record/Exports/forbidden.txt").is_err());
    }
}

pub fn load_proxy_endpoint<R: Runtime>(app: &AppHandle<R>) {
    if connections::migrate_legacy(app).is_err() {
        log::warn!("Legacy connection migration incomplete; original settings retained");
    }
}

#[tauri::command]
pub async fn ko_get_proxy_endpoint<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let profile = connections::list(&app)?.into_iter().find(|p| p.profile.id == connections::legacy_id());
    Ok(match profile {
        Some(profile) => json!({"base":profile.profile.base,"hasApiKey":profile.has_api_key}),
        None => json!({"base":DEFAULT_PROXY_BASE,"hasApiKey":false}),
    })
}

#[tauri::command]
pub async fn ko_set_proxy_endpoint<R: Runtime>(
    app: AppHandle<R>,
    base: String,
    api_key: Option<String>,
) -> Result<Value, String> {
    let profile = connections::upsert(&app, connections::ProfileInput {
        id:Some(connections::legacy_id().into()), label:"OpenCodex 연결".into(),
        kind:connections::ConnectionKind::Opencodex,
        base:if base.trim().is_empty() { DEFAULT_PROXY_BASE.into() } else {base},
        enabled:true, manual_model_ids:Vec::new(), text_only_confirmed:false,
        username:String::new(), api_key,
    })?;
    Ok(json!({"base":profile.profile.base,"hasApiKey":profile.has_api_key}))
}
struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) {
        GENERATING.store(false, Ordering::SeqCst);
    }
}

fn local_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("로컬 연결 초기화 실패: {e}"))
}
fn valid_model(model: &str) -> bool {
    !model.trim().is_empty()
        && model.len() <= 200
        && !model.contains(":cloud")
        && !model.contains("://")
}

#[tauri::command]
pub async fn ko_start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_name: Option<String>,
    system_name: Option<String>,
    title: String,
) -> Result<(), String> {
    let _transition = RECORDING_TRANSITION
        .try_lock()
        .map_err(|_| "녹음 상태를 변경하고 있습니다. 잠시 기다려 주세요.")?;
    if EXITING.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    if crate::audio::recording_commands::is_recording().await {
        return Err("이미 녹음 중입니다.".into());
    }
    let config = crate::api::api_get_transcript_config(app.clone(), app.state(), None)
        .await
        .map_err(|e| format!("받아쓰기 설정 조회 실패: {e}"))?;
    if config.as_ref().map(|c| c.provider.as_str()) != Some("localWhisper") {
        return Err("받아쓰기 모델 설정에서 Local Whisper 다국어 모델을 내려받고 선택하세요.".into());
    }
    if config
        .as_ref()
        .map(|c| c.model.contains(".en"))
        .unwrap_or(false)
    {
        return Err("영어 전용 .en 모델은 한국어 받아쓰기에 사용할 수 없습니다.".into());
    }
    let devices = crate::get_audio_devices().await?;
    let (mic, system) = recording_source::capture_devices(&devices, mic_name.as_deref(), system_name.as_deref())?;
    crate::set_language_preference("ko".to_string()).await?;
    let clean_title: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let name = if clean_title.trim().is_empty() {
        "한국어 회의".to_owned()
    } else {
        clean_title
    };
    let result = crate::start_recording(
        app,
        Some(mic),
        Some(system),
        Some(name),
    )
    .await;
    result
}

#[tauri::command]
pub async fn ko_stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _transition = RECORDING_TRANSITION
        .try_lock()
        .map_err(|_| "녹음 상태를 변경하고 있습니다. 잠시 기다려 주세요.")?;
    let dir = ko_data_dir(&app)?;
    crate::review_paths::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let args = crate::RecordingArgs {
        save_path: dir
            .join(format!("recording-{stamp}.wav"))
            .to_string_lossy()
            .into_owned(),
    };
    let result = crate::stop_recording(app, args).await;
    result
}

#[tauri::command]
pub async fn ko_exit_app<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _transition = RECORDING_TRANSITION
        .try_lock()
        .map_err(|_| "녹음 준비 또는 마지막 오디오 처리가 끝난 뒤 종료해 주세요.")?;
    ensure_exit_ready(
        crate::audio::recording_commands::is_recording().await,
        crate::audio::import::is_import_in_progress(),
        GENERATING.load(Ordering::SeqCst),
    )?;
    EXITING.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

fn ensure_exit_ready(recording: bool, importing: bool, generating: bool) -> Result<(), String> {
    if recording {
        return Err("녹음을 중지하고 마지막 오디오와 받아쓰기 저장을 마친 뒤 종료해 주세요.".into());
    }
    if importing {
        return Err("파일 가져오기 작업이 끝난 뒤 종료해 주세요.".into());
    }
    if generating {
        return Err("진행 중인 요약 요청이 끝난 뒤 종료해 주세요.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn ko_stereo_mix_status() -> Result<crate::stereo_mix::StereoMixStatus, String> {
    tauri::async_runtime::spawn_blocking(crate::stereo_mix::status).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ko_enable_stereo_mix() -> Result<crate::stereo_mix::StereoMixStatus, String> {
    use crate::stereo_mix::{enable, status, StereoMixState};
    tauri::async_runtime::spawn_blocking(|| {
        let current = status()?;
        match (current.state, current.id.clone()) {
            (StereoMixState::Active, _) => Ok(current),
            (StereoMixState::Disabled, Some(id)) => enable(&id),
            (StereoMixState::Unplugged, _) => Err("스테레오 믹스가 연결되지 않은 상태입니다. 오디오 장치를 다시 연결한 뒤 시도해 주세요.".into()),
            _ => Err("이 PC의 소리 장치는 스테레오 믹스를 제공하지 않습니다. 'PC 소리'의 스피커·헤드폰 녹음을 사용하세요.".into()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn ko_default_playback_device() -> Option<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    cpal::default_host().default_output_device().and_then(|device| device.name().ok())
}

#[tauri::command]
pub fn ko_app_info<R: Runtime>(app: AppHandle<R>) -> Value {
    json!({
        "name": "Stream-Record",
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[tauri::command]
pub fn ko_open_exports_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = ko_data_dir(&app)?.join("Exports");
    crate::review_paths::fs::create_dir_all(&dir).map_err(|e| format!("저장 폴더 생성 실패: {e}"))?;
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("저장 폴더 열기 실패: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod exit_tests {
    use super::ensure_exit_ready;

    #[test]
    fn stream_record_exit_rejects_each_active_operation() {
        // Given a recording (including its stop tail), import, or summary request.
        for active in [
            (true, false, false),
            (false, true, false),
            (false, false, true),
        ] {
            // When exit readiness is evaluated, then no active operation permits exit.
            assert!(ensure_exit_ready(active.0, active.1, active.2).is_err());
        }
    }

    #[test]
    fn stream_record_exit_allows_idle_state() {
        // Given all native operations have completed, when checked, then exit is permitted.
        assert!(ensure_exit_ready(false, false, false).is_ok());
    }
}

fn youtube_watch_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("유튜브 링크를 입력하세요.".into());
    }
    if trimmed.len() > 500 {
        return Err("링크가 너무 깁니다.".into());
    }
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or("https:// 로 시작하는 유튜브 링크를 입력하세요.")?;
    let (authority, tail) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i + 1..]),
        None => (rest, ""),
    };
    if authority.contains('@') || authority.contains(':') {
        return Err("지원하지 않는 링크 형식입니다.".into());
    }
    let host = authority.to_ascii_lowercase();
    let (path, query) = match tail.find('?') {
        Some(i) => (&tail[..i], &tail[i + 1..]),
        None => (tail, ""),
    };
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let from_query = || query.split('&').find_map(|pair| pair.strip_prefix("v="));
    let candidate = match host.as_str() {
        "youtu.be" | "www.youtu.be" => segments.first().copied(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" => match segments
            .first()
            .copied()
        {
            Some("shorts") | Some("live") | Some("embed") | Some("v") => segments.get(1).copied(),
            _ => from_query(),
        },
        _ => {
            return Err(
                "유튜브 링크만 재생합니다. youtube.com 또는 youtu.be 주소를 입력하세요.".into(),
            )
        }
    };
    let id = candidate
        .map(|s| s.split('#').next().unwrap_or(s))
        .unwrap_or("");
    if id.is_empty()
        || id.len() > 20
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "링크에서 영상 주소를 찾지 못했습니다. 재생 페이지 주소를 그대로 붙여넣으세요.".into(),
        );
    }
    Ok(format!("https://www.youtube.com/watch?v={id}"))
}

#[tauri::command]
pub fn ko_validate_video(url: String) -> Result<String, String> {
    youtube_watch_url(&url)
}

#[tauri::command]
pub async fn ko_open_video<R: Runtime>(app: AppHandle<R>, url: String) -> Result<String, String> {
    let watch = youtube_watch_url(&url)?;
    let target = tauri::Url::parse(&watch).map_err(|e| format!("링크 해석 실패: {e}"))?;
    if let Some(window) = app.get_webview_window(VIDEO_WINDOW_LABEL) {
        window
            .navigate(target)
            .map_err(|e| format!("영상 창 이동 실패: {e}"))?;
        window
            .set_focus()
            .map_err(|e| format!("영상 창 활성화 실패: {e}"))?;
        return Ok(watch);
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        VIDEO_WINDOW_LABEL,
        tauri::WebviewUrl::External(target),
    )
    .title("재생 영상 · 이 소리를 받아씁니다")
    .inner_size(980.0, 640.0)
    .build()
    .map_err(|e| format!("영상 창을 열지 못했습니다: {e}"))?;
    Ok(watch)
}

/// Reads the public title of a YouTube video through oEmbed. Council broadcasts usually name the meeting there,
/// which helps choose word sets. Any failure returns None so recording never waits on it.
#[tauri::command]
pub async fn ko_video_title(url: String) -> Result<Option<String>, String> {
    let watch = youtube_watch_url(&url)?;
    let endpoint = reqwest::Url::parse_with_params("https://www.youtube.com/oembed", &[("format", "json"), ("url", watch.as_str())])
        .map_err(|e| format!("영상 제목 주소 오류: {e}"))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| format!("영상 제목 조회 준비 실패: {e}"))?;
    let Ok(response) = client.get(endpoint).send().await else { return Ok(None) };
    if !response.status().is_success() {
        return Ok(None);
    }
    let Ok(bytes) = response.bytes().await else { return Ok(None) };
    if bytes.len() > 64 * 1024 {
        return Ok(None);
    }
    let Ok(body) = serde_json::from_slice::<Value>(&bytes) else { return Ok(None) };
    Ok(body.get("title").and_then(Value::as_str).map(clean_video_title).filter(|title| !title.is_empty()))
}

fn clean_video_title(raw: &str) -> String {
    let visible: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    visible.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(200).collect()
}

#[cfg(test)]
mod video_title_tests {
    #[test]
    fn video_title_is_single_line_and_bounded() {
        assert_eq!(super::clean_video_title(" 제454회 임시회\n\t제2차   행정자치위원회\u{0}"), "제454회 임시회 제2차 행정자치위원회");
        assert_eq!(super::clean_video_title(&"가".repeat(300)).chars().count(), 200);
        assert_eq!(super::clean_video_title(" \n "), "");
    }
}

#[tauri::command]
pub async fn ko_close_video<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    match app.get_webview_window(VIDEO_WINDOW_LABEL) {
        Some(window) => window
            .close()
            .map_err(|e| format!("영상 창을 닫지 못했습니다: {e}")),
        None => Ok(()),
    }
}

fn history_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("meeting-ko"))
}

#[tauri::command]
pub async fn ko_save_snapshot<R: Runtime>(app: AppHandle<R>, content: String) -> Result<(), String> {
    record_history::save(&history_dir(&app)?, &content)
}

#[tauri::command]
pub async fn ko_load_snapshot<R: Runtime>(app: AppHandle<R>) -> Result<Option<Value>, String> {
    record_history::current(&history_dir(&app)?)
}

#[tauri::command]
pub async fn ko_list_records<R: Runtime>(app: AppHandle<R>) -> Result<record_history::RecordList, String> {
    record_history::list(&history_dir(&app)?)
}

#[tauri::command]
pub async fn ko_load_record<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Value, String> {
    record_history::load(&history_dir(&app)?, &id)
}

async fn ollama_models(client: &reqwest::Client) -> Result<Vec<Value>, String> {
    let value: Value = client
        .get(format!("{OLLAMA_BASE}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("로컬 Ollama 모델 목록 연결 실패: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let rows = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or("Ollama 모델 목록 형식 오류")?;
    Ok(rows
        .iter()
        .filter_map(|m| m.get("name").and_then(Value::as_str))
        .filter(|s| valid_model(s))
        .map(|id| json!({"id": id, "provider": "local"}))
        .collect())
}

#[tauri::command]
pub async fn ko_models(app: AppHandle) -> Result<Vec<Value>, String> {
    model_catalog::list(&app).await
}

#[tauri::command]
pub async fn ko_generate(
    app: AppHandle,
    revision: Option<String>,
    model: String,
    text: String,
    stage: String,
    provider: String,
) -> Result<String, String> {
    generation::generate(&app, model, text, stage, provider, revision).await
}
#[tauri::command]
pub async fn ko_export<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    kind: String,
    content: String,
) -> Result<String, String> {
    let extension = match kind.as_str() {
        "transcript" => "txt",
        "minutes" => "md",
        "bundle" => "json",
        _ => return Err("잘못된 저장 형식".into()),
    };
    if content.len() > 8_000_000 {
        return Err("저장할 내용이 너무 큽니다.".into());
    }
    let dir = ko_data_dir(&app)?.join("Exports");
    crate::review_paths::fs::create_dir_all(&dir).map_err(|e| format!("저장 폴더 생성 실패: {e}"))?;
    let safe: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(60)
        .collect();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = dir.join(format!("meeting-{safe}-{stamp}-{kind}.{extension}"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    if extension == "txt" {
        file.write_all(b"\xEF\xBB\xBF").map_err(|e| e.to_string())?;
    }
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

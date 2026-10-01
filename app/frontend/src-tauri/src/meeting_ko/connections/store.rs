use super::{bound_credentials, credentials, endpoint, legacy_endpoint, types::*};
use serde_json::json;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;

static MUTATION: std::sync::Mutex<()> = std::sync::Mutex::new(());
const FILE: &str = "stream_record_connections.json";

fn read_profiles<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Profile>, String> {
    let store = app
        .store(FILE)
        .map_err(|_| "연결 설정을 읽지 못했습니다.")?;
    match store.get("profiles") {
        Some(value) => {
            serde_json::from_value(value).map_err(|_| "연결 설정 형식이 올바르지 않습니다.".into())
        }
        None => Ok(Vec::new()),
    }
}

fn persist<R: Runtime>(app: &AppHandle<R>, profiles: &[Profile]) -> Result<(), String> {
    let store = app
        .store(FILE)
        .map_err(|_| "연결 설정을 열지 못했습니다.")?;
    let value = serde_json::to_value(profiles).map_err(|_| "연결 설정을 변환하지 못했습니다.")?;
    let previous = store.get("profiles");
    store.set("profiles", value);
    if store.save().is_err() {
        match previous {
            Some(value) => store.set("profiles", value),
            None => {
                store.delete("profiles");
            }
        }
        return Err("연결 설정을 저장하지 못했습니다.".into());
    }
    Ok(())
}

pub fn list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ProfileDto>, String> {
    read_profiles(app)?
        .into_iter()
        .map(|profile| {
            let has_api_key = !bound_credentials::read(&profile)?.is_empty();
            Ok(ProfileDto {
                profile,
                has_api_key,
            })
        })
        .collect()
}

pub fn resolve<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<Profile, String> {
    let mut profile = read_profiles(app)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("선택한 연결이 삭제되었습니다.")?;
    if !profile.enabled {
        return Err("선택한 연결이 비활성화되어 있습니다.".into());
    }
    profile.base = endpoint::normalize(&profile.base)?;
    Ok(profile)
}

pub fn resolve_revision<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    expected: Option<&str>,
) -> Result<Profile, String> {
    let profile = resolve(app, id)?;
    if expected.is_some_and(|revision| revision != profile.revision) {
        return Err("연결 설정이 변경되었습니다. 모델을 다시 선택하세요.".into());
    }
    Ok(profile)
}

fn validate(input: &ProfileInput) -> Result<(), String> {
    if input.label.trim().is_empty()
        || input.label.chars().count() > 80
        || input.label.contains(char::is_control)
    {
        return Err("연결 이름은 1~80자여야 합니다.".into());
    }
    if input.manual_model_ids.len() > 200
        || input
            .manual_model_ids
            .iter()
            .any(|m| m.is_empty() || m.len() > 250 || m.contains(char::is_whitespace))
    {
        return Err("모델 식별자 형식이 올바르지 않습니다.".into());
    }
    if input.username.len() > 120
        || input.username.contains([':', '\r', '\n'])
        || input
            .api_key
            .as_ref()
            .is_some_and(|k| k.len() > 32000 || k.contains(['\r', '\n']))
    {
        return Err("인증 정보 형식이 올바르지 않습니다.".into());
    }
    Ok(())
}

pub fn upsert<R: Runtime>(app: &AppHandle<R>, input: ProfileInput) -> Result<ProfileDto, String> {
    let _guard = MUTATION.lock().map_err(|_| "연결 설정이 사용 중입니다.")?;
    validate(&input)?;
    let base = endpoint::normalize(&input.base)?;
    let mut profiles = read_profiles(app)?;
    let id = match input.id {
        Some(id) => {
            uuid::Uuid::parse_str(&id).map_err(|_| "연결 ID 형식이 올바르지 않습니다.")?;
            id
        }
        None => uuid::Uuid::new_v4().to_string(),
    };
    let key = format!("connection-{id}");
    let previous_record = credentials::read(&key)?;
    let old = profiles.iter().find(|p| p.id == id);
    let previous_secret = match (old, input.api_key.as_ref()) {
        (Some(profile), None) => Some(bound_credentials::read(profile)?),
        (Some(_), Some(_)) | (None, _) => None,
    };
    if let Some(old) = profiles.iter().find(|p| p.id == id) {
        if (old.base != base || old.kind != input.kind || old.username != input.username)
            && previous_secret
                .as_ref()
                .is_some_and(|secret| !secret.is_empty())
            && input.api_key.is_none()
        {
            return Err(
                "연결 주소 또는 종류 변경 시 인증 키를 다시 입력하거나 명시적으로 지워 주세요."
                    .into(),
            );
        }
    }
    let profile = Profile {
        id: id.clone(),
        label: input.label.trim().to_owned(),
        kind: input.kind,
        base,
        enabled: input.enabled,
        manual_model_ids: input.manual_model_ids,
        text_only_confirmed: input.text_only_confirmed,
        username: input.username,
        revision: uuid::Uuid::new_v4().to_string(),
    };
    let secret = input.api_key.or(previous_secret.clone());
    bound_credentials::write(&profile, secret.as_deref().unwrap_or_default())?;
    profiles.retain(|p| p.id != id);
    profiles.push(profile.clone());
    if let Err(error) = persist(app, &profiles) {
        let rollback = match previous_record {
            Some(value) => credentials::write(&key, &value),
            None => credentials::remove(&key),
        };
        return Err(match rollback {
            Ok(()) => error,
            Err(_) => {
                "연결 저장 실패 후 인증 정보 복원도 실패했습니다. 인증 키를 다시 설정해 주세요."
                    .into()
            }
        });
    }
    Ok(ProfileDto {
        profile,
        has_api_key: secret.is_some_and(|k| !k.is_empty()),
    })
}

pub fn remove<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), String> {
    let _guard = MUTATION.lock().map_err(|_| "연결 설정이 사용 중입니다.")?;
    let mut profiles = read_profiles(app)?;
    let profile = profiles
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("연결을 찾지 못했습니다.")?;
    profiles.retain(|p| p.id != id);
    persist(app, &profiles)?;
    credentials::remove(&profile.credential_key())
}

/// The plaintext legacy entry is cleared only after encrypted secret and metadata both persist.
pub fn migrate_legacy<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "이전 연결 저장 경로를 찾지 못했습니다.")?
        .join("stream_record_proxy.json");
    let Some(value) = legacy_endpoint::read(&path)? else {
        return Ok(());
    };
    let legacy = app
        .store("stream_record_proxy.json")
        .map_err(|_| "이전 연결 설정을 읽지 못했습니다.")?;
    let previous = legacy.get("endpoint");
    let base = value
        .get("base")
        .and_then(|v| v.as_str())
        .unwrap_or("http://127.0.0.1:10100/v1");
    let secret = value
        .get("apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let id = "dfc10000-0000-4000-8000-000000000001";
    if !read_profiles(app)?.iter().any(|p| p.id == id) {
        upsert(
            app,
            ProfileInput {
                id: Some(id.into()),
                label: "OpenCodex 연결".into(),
                kind: ConnectionKind::Opencodex,
                base: base.into(),
                enabled: true,
                manual_model_ids: Vec::new(),
                text_only_confirmed: false,
                username: String::new(),
                api_key: Some(secret.into()),
            },
        )?;
    } else if !secret.is_empty() && credentials::read(&format!("connection-{id}"))?.is_none() {
        let existing = read_profiles(app)?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or("이전 연결을 찾지 못했습니다.")?;
        if existing.kind != ConnectionKind::Opencodex || existing.base != endpoint::normalize(base)?
        {
            return Err(
                "기존 연결 주소가 변경되어 이전 인증 키를 자동 이관하지 않았습니다.".into(),
            );
        }
        bound_credentials::write(&existing, secret)?;
    }
    legacy.set("endpoint", json!({"base":base,"connectionId":id}));
    if legacy.save().is_err() {
        match previous {
            Some(value) => legacy.set("endpoint", value),
            None => {
                legacy.delete("endpoint");
            }
        }
        return Err("이전 평문 인증 정보 정리를 완료하지 못했습니다.".into());
    }
    Ok(())
}

pub const fn legacy_id() -> &'static str {
    "dfc10000-0000-4000-8000-000000000001"
}

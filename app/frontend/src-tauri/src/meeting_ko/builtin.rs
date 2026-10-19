use crate::summary::summary_engine::{
    self,
    client::{generate_bounded, BuiltinGeneration},
    ModelManagerState, ModelStatus,
};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::Manager;

pub(super) async fn catalog(app: &tauri::AppHandle) -> Result<Vec<Value>, String> {
    let state = app
        .try_state::<ModelManagerState>()
        .ok_or("내장 AI 모델 관리자가 준비되지 않았습니다.")?;
    let models = summary_engine::builtin_ai_list_models(app.clone(), state).await?;
    Ok(models
        .into_iter()
        .filter_map(|model| match model.status {
            ModelStatus::Available => {
                Some(json!({"id":model.name,"provider":"builtin","displayName":model.display_name}))
            }
            ModelStatus::NotDownloaded
            | ModelStatus::Downloading { .. }
            | ModelStatus::Corrupted { .. }
            | ModelStatus::Error(_) => None,
        })
        .collect())
}

// The arguments mirror the provider adapter contract shared with the generation router.
pub(super) async fn generate(
    app: &tauri::AppHandle,
    model: &str,
    system: &str,
    prompt: &str,
    limit: u32,
) -> Result<String, String> {
    let available = catalog(app).await?;
    if !available
        .iter()
        .any(|item| item.get("id").and_then(Value::as_str) == Some(model))
    {
        return Err("선택한 내장 요약 모델이 설치되지 않았거나 준비 중입니다. 설정에서 다운로드 상태를 확인하세요.".into());
    }
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let max_tokens = i32::try_from(limit).map_err(|_| "내장 AI 출력 한도가 잘못되었습니다.")?;
    let input = BuiltinGeneration {
        model_name: model,
        system_prompt: system,
        user_prompt: prompt,
        max_tokens,
        timeout: Duration::from_secs(600),
    };
    let text = generate_bounded(&app_dir, &input, None)
        .await
        .map_err(|error| error.to_string())?;
    if text.trim().is_empty() {
        return Err("내장 AI가 빈 응답을 반환했습니다.".into());
    }
    Ok(text)
}

pub(super) async fn release() -> Result<(), String> {
    summary_engine::force_shutdown_sidecar()
        .await
        .map_err(|error| error.to_string())
}

pub(super) async fn cancel() -> Result<(), String> {
    summary_engine::client::abort_generation().await.map_err(|error| error.to_string())
}

mod adapters;
mod bound_credentials;
pub mod credentials;
pub mod endpoint;
mod opencode;
mod legacy_endpoint;
mod store;
mod transport;
mod types;

pub use adapters::{generate, list_models};
use serde::Serialize;
pub use store::{legacy_id, list, migrate_legacy, remove, resolve, resolve_revision, upsert};
use tauri::{AppHandle, Runtime};
pub use types::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTest {
    models: Vec<ModelBinding>,
    catalog: bool,
    inference: bool,
}

#[tauri::command]
pub async fn ko_list_connections<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ProfileDto>, String> {
    list(&app)
}
#[tauri::command]
pub async fn ko_save_connection<R: Runtime>(
    app: AppHandle<R>,
    profile: ProfileInput,
) -> Result<ProfileDto, String> {
    upsert(&app, profile)
}
#[tauri::command]
pub async fn ko_remove_connection<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    remove(&app, &id)
}
#[tauri::command]
pub async fn ko_test_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<CatalogTest, String> {
    let profile = resolve(&app, &id)?;
    Ok(CatalogTest {
        models: list_models(&profile).await?,
        catalog: true,
        inference: false,
    })
}
#[tauri::command]
pub async fn ko_probe_connection<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    model: String,
) -> Result<serde_json::Value, String> {
    let profile = resolve(&app, &id)?;
    let input = GenerationInput {
        model: &model,
        system: "Return a brief greeting, using text only.",
        text: "Hello",
        max_tokens: 1000,
        timeout: std::time::Duration::from_secs(60),
    };
    let answer = generate(&profile, &input).await?;
    Ok(
        serde_json::json!({"inference":true,"destination":profile.base,"responseCharacters":answer.chars().count()}),
    )
}

#[cfg(test)]
mod race_tests;
#[cfg(test)]
mod test_profile;
#[cfg(test)]
mod tests;

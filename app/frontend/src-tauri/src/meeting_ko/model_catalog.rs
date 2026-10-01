use super::{builtin, chatgpt, connections, ollama_models};
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

pub async fn list(app: &AppHandle) -> Result<Vec<Value>, String> {
    let client = reqwest::Client::builder().no_proxy()
        .redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(5)).build().map_err(|e|e.to_string())?;
    let (local, builtin) = tokio::join!(ollama_models(&client), builtin::catalog(app));
    let mut models = local.unwrap_or_default();
    models.extend(builtin.unwrap_or_default());
    // Catalog failures remain visible in each connection card; they cannot hide local models.
    let profiles = connections::list(app).unwrap_or_default();
    let futures = profiles.into_iter().filter(|p|p.profile.enabled).map(|p|async move {
        connections::list_models(&p.profile).await.unwrap_or_else(|_|p.profile.manual_model_ids.iter().map(|id|p.profile.binding(id.clone())).collect())
    });
    for items in futures_util::future::join_all(futures).await {
        for item in items { models.push(serde_json::to_value(item).map_err(|e|e.to_string())?); }
    }
    if let Ok(items) = chatgpt::ko_chatgpt_models().await { models.extend(items); }
    let mut seen=std::collections::HashSet::new();
    models.retain(|m|seen.insert(format!("{}:{}",m["provider"],m["id"])));
    Ok(models)
}

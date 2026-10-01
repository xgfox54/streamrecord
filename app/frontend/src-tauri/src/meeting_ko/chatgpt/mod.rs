mod diagnostics;
mod http;
mod identity;
mod inference;
mod login;
mod protocol;
#[cfg(test)]
mod protocol_tests;
mod registry;
mod request;
mod stream;
#[cfg(test)]
mod stream_tests;
mod transport;
pub use inference::generate;
use once_cell::sync::Lazy;
use protocol::PLAN_SCOPE;
use registry::Registry;
use serde::Serialize;
use tokio::sync::Mutex;

static STATE: Lazy<Mutex<Session>> = Lazy::new(|| Mutex::new(Session::default()));
#[derive(Default)]
struct Session {
    pending: Option<(String, tokio::task::JoinHandle<()>)>,
    error: Option<String>,
    requests: tokio_util::sync::CancellationToken,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pending: bool,
    error: Option<String>,
    active_account_id: Option<String>,
    accounts: Vec<AccountStatus>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountStatus {
    id: String,
    label: String,
    connected: bool,
    plan_enabled: bool,
}

fn status(session: &Session, registry: Registry) -> ConnectionStatus {
    ConnectionStatus {
        pending: session.pending.is_some(),
        error: session.error.clone(),
        active_account_id: registry.active,
        accounts: registry
            .accounts
            .into_iter()
            .map(|a| {
                let suffix: String = a
                    .client_id
                    .chars()
                    .rev()
                    .take(8)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
                AccountStatus {
                    label: format!("{} · {}", a.email.as_deref().unwrap_or("ChatGPT"), suffix),
                    connected: a.tokens.is_some(),
                    plan_enabled: a
                        .tokens
                        .as_ref()
                        .is_some_and(|t| t.scopes.iter().any(|s| s == PLAN_SCOPE)),
                    id: a.client_id,
                }
            })
            .collect(),
    }
}

#[tauri::command]
pub async fn ko_chatgpt_status() -> Result<ConnectionStatus, String> {
    let session = STATE.lock().await;
    Ok(status(&session, Registry::load()?))
}

#[tauri::command]
pub async fn ko_chatgpt_login(
    account_id: Option<String>,
    request_consent: bool,
) -> Result<ConnectionStatus, String> {
    let mut session = STATE.lock().await;
    if session.pending.is_some() {
        return Err("이미 ChatGPT 로그인이 진행 중입니다.".into());
    }
    let registry = Registry::load()?;
    registry.save()?;
    let account = match account_id {
        Some(id) => Some(
            registry
                .accounts
                .iter()
                .find(|a| a.client_id == id)
                .cloned()
                .ok_or("저장된 ChatGPT 계정이 없습니다.")?,
        ),
        None => None,
    };
    let (listener, attempt, url) = login::prepare(account, &registry, request_consent).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let task_id = id.clone();
    let task = tokio::spawn(async move {
        let result = login::complete(listener, attempt).await;
        let mut current = STATE.lock().await;
        if current.pending.as_ref().map(|(id, _)| id) != Some(&task_id) {
            return;
        }
        let stored = result.and_then(|account| {
            let mut registry = Registry::load()?;
            if registry
                .accounts
                .iter()
                .any(|a| a.client_id == account.client_id && a.subject != account.subject)
            {
                return Err("ChatGPT 계정 등록 정보가 일치하지 않습니다.".into());
            }
            registry.active = Some(account.client_id.clone());
            registry
                .accounts
                .retain(|a| a.client_id != account.client_id);
            registry.accounts.push(account);
            registry.save()
        });
        if stored.is_ok() {
            current.requests.cancel();
            current.requests = tokio_util::sync::CancellationToken::new();
        }
        current.error = stored.err();
        current.pending = None;
    });
    session.error = None;
    session.pending = Some((id, task));
    if webbrowser::open(url.as_str()).is_err() {
        if let Some((_, task)) = session.pending.take() {
            task.abort();
        }
        return Err("기본 브라우저를 열지 못했습니다. 기본 브라우저 설정을 확인하세요.".into());
    }
    Ok(status(&session, registry))
}

#[tauri::command]
pub async fn ko_chatgpt_cancel() {
    let mut session = STATE.lock().await;
    if let Some((_, task)) = session.pending.take() {
        task.abort();
    }
    session.error = None;
}

#[tauri::command]
pub async fn ko_chatgpt_select(account_id: String) -> Result<ConnectionStatus, String> {
    let mut session = STATE.lock().await;
    let mut registry = Registry::load()?;
    if !registry
        .accounts
        .iter()
        .any(|a| a.client_id == account_id && a.tokens.is_some())
    {
        return Err("해당 ChatGPT 계정에 먼저 로그인하세요.".into());
    }
    session.requests.cancel();
    session.requests = tokio_util::sync::CancellationToken::new();
    registry.active = Some(account_id);
    registry.save()?;
    Ok(status(&session, registry))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectResult {
    remote_revoked: bool,
}
#[tauri::command]
pub async fn ko_chatgpt_disconnect(account_id: String) -> Result<DisconnectResult, String> {
    let mut session = STATE.lock().await;
    if let Some((_, task)) = session.pending.take() {
        task.abort();
    }
    session.requests.cancel();
    session.requests = tokio_util::sync::CancellationToken::new();
    let mut registry = Registry::load()?;
    let account = registry
        .accounts
        .iter()
        .find(|a| a.client_id == account_id)
        .cloned()
        .ok_or("ChatGPT 계정을 찾지 못했습니다.")?;
    let mut remote_revoked = account
        .tokens
        .as_ref()
        .map_or(true, |t| t.refresh_token.is_empty());
    if let Some(tokens) = account.tokens.filter(|t| !t.refresh_token.is_empty()) {
        if let Ok(metadata) = http::discovery().await {
            for delay in [0, 1, 2] {
                if delay > 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                }
                let result = http::client()?
                    .post(&metadata.revocation_endpoint)
                    .timeout(std::time::Duration::from_secs(10))
                    .form(&[
                        ("token", tokens.refresh_token.as_str()),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", &account_id),
                    ])
                    .send()
                    .await;
                match result {
                    Ok(response) if response.status() == reqwest::StatusCode::OK => {
                        remote_revoked = true;
                        break;
                    }
                    Ok(response) if !response.status().is_server_error() => break,
                    Ok(_) | Err(_) => {}
                }
            }
        }
    }
    registry.replace_tokens(&account_id, None)?;
    Ok(DisconnectResult { remote_revoked })
}

#[tauri::command]
pub async fn ko_chatgpt_models() -> Result<Vec<serde_json::Value>, String> {
    inference::models().await
}

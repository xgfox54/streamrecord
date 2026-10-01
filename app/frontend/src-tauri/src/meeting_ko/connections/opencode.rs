use super::{adapters::nonempty, transport, types::*};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Providers {
    all: Vec<Provider>,
    connected: Vec<String>,
}
#[derive(Deserialize)]
struct Provider {
    id: String,
    models: BTreeMap<String, Model>,
}
#[derive(Deserialize)]
struct Model {
    id: String,
}
#[derive(Deserialize)]
struct Session {
    id: String,
    #[serde(default)]
    permission: Vec<Permission>,
}
#[derive(Deserialize)]
struct Permission {
    permission: String,
    pattern: String,
    action: String,
}
#[derive(Deserialize)]
struct Reply {
    info: ReplyInfo,
    parts: Vec<Part>,
}
#[derive(Deserialize)]
struct ReplyInfo {
    #[serde(default)]
    error: Option<serde::de::IgnoredAny>,
    #[serde(default)]
    finish: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Part {
    Text {
        text: String,
    },
    #[serde(other)]
    Other,
}

pub async fn models(profile: &Profile, client: &Client) -> Result<Vec<String>, String> {
    let response: Providers = transport::decode(transport::authorize(
        client.get(format!("{}/provider", profile.base)),
        profile,
    )?)
    .await?;
    Ok(response
        .all
        .into_iter()
        .filter(|p| response.connected.contains(&p.id))
        .flat_map(|p| {
            p.models
                .into_values()
                .map(move |m| format!("{}/{}", p.id, m.id))
        })
        .collect())
}

pub async fn generate(
    profile: &Profile,
    input: &GenerationInput<'_>,
    client: &Client,
) -> Result<String, String> {
    let (provider, model) = input
        .model
        .split_once('/')
        .filter(|(p, m)| !p.is_empty() && !m.is_empty())
        .ok_or("OpenCode 모델은 provider/model 형식이어야 합니다.")?;
    let authorization = transport::Authorization::new(profile)?;
    // A separate session isolates transcripts from the user's existing coding conversations.
    let create = json!({"title":"Stream-Record text processing","permission":[{"permission":"*","pattern":"*","action":"deny"}]});
    let session: Session = transport::decode(
        authorization
            .apply(client.post(format!("{}/session", profile.base)))
            .json(&create),
    )
    .await?;
    if !session
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
        || session.id.is_empty()
    {
        return Err("OpenCode 세션 ID 형식이 올바르지 않습니다.".into());
    }
    if !matches!(session.permission.as_slice(), [rule] if rule.permission == "*" && rule.pattern == "*" && rule.action == "deny")
    {
        let cleanup = authorization
            .apply(client.delete(format!("{}/session/{}", profile.base, session.id)))
            .send()
            .await;
        return Err(if cleanup.is_ok_and(|r| r.status().is_success()) {
            "OpenCode 서버에서 도구 차단 정책을 확인하지 못해 요청을 중단했습니다."
        } else {
            "OpenCode 도구 차단 확인 및 임시 세션 정리에 실패했습니다."
        }
        .into());
    }
    let payload = json!({"model":{"providerID":provider,"modelID":model},"system":input.system,
        "tools":{"*":false},"parts":[{"type":"text","text":input.text}]});
    let request = authorization
        .apply(client.post(format!("{}/session/{}/message", profile.base, session.id)))
        .timeout(input.timeout)
        .json(&payload);
    let result: Result<Reply, String> = transport::decode(request).await;
    // Only this request's isolated session is removed, including on model failure.
    let cleanup = authorization
        .apply(client.delete(format!("{}/session/{}", profile.base, session.id)))
        .send()
        .await;
    let cleaned = cleanup.is_ok_and(|response| response.status().is_success());
    let reply = result?;
    if !cleaned {
        return Err("OpenCode 응답은 받았지만 임시 세션 정리에 실패했습니다. OpenCode에서 Stream-Record 세션을 확인하세요.".into());
    }
    if reply.info.error.is_some() {
        return Err("OpenCode 모델 처리에 실패했습니다.".into());
    }
    if reply.info.finish.as_deref() == Some("length") {
        return Err("출력 길이 제한으로 응답이 잘렸습니다.".into());
    }
    nonempty(
        reply
            .parts
            .into_iter()
            .filter_map(|p| match p {
                Part::Text { text } => Some(text),
                Part::Other => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

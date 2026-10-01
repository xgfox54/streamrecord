use super::{opencode, transport, types::*};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Catalog {
    data: Vec<CatalogModel>,
}
#[derive(Deserialize)]
struct CatalogModel {
    id: String,
}
#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    message: Message,
    finish_reason: Option<String>,
}
#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}
#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<Content>,
    stop_reason: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Content {
    Text {
        text: String,
    },
    #[serde(other)]
    Other,
}

pub async fn list_models(profile: &Profile) -> Result<Vec<ModelBinding>, String> {
    let client = transport::client()?;
    let mut ids = match profile.kind {
        ConnectionKind::Opencode => opencode::models(profile, &client).await?,
        ConnectionKind::Opencodex
        | ConnectionKind::Openclaw
        | ConnectionKind::Openrouter
        | ConnectionKind::OpenaiCompatible
        | ConnectionKind::OpenaiApi
        | ConnectionKind::AnthropicApi => {
            let request =
                transport::authorize(client.get(format!("{}/models", profile.base)), profile)?;
            let catalog: Catalog = transport::decode(request).await?;
            catalog.data.into_iter().map(|m| m.id).collect()
        }
    };
    ids.extend(profile.manual_model_ids.iter().cloned());
    ids.retain(|id| !id.is_empty() && id.len() <= 250 && !id.contains(char::is_whitespace));
    ids.sort();
    ids.dedup();
    Ok(ids.into_iter().map(|id| profile.binding(id)).collect())
}

pub async fn generate(profile: &Profile, input: &GenerationInput<'_>) -> Result<String, String> {
    if input.model.is_empty() || input.model.len() > 250 || input.text.len() > 1000000 {
        return Err("모델 또는 입력 크기가 올바르지 않습니다.".into());
    }
    let client = transport::client()?;
    match profile.kind {
        ConnectionKind::Opencode => opencode::generate(profile, input, &client).await,
        ConnectionKind::AnthropicApi => {
            let payload = json!({"model":input.model,"system":input.system,"max_tokens":input.max_tokens,"messages":[{"role":"user","content":input.text}]});
            let request =
                transport::authorize(client.post(format!("{}/messages", profile.base)), profile)?
                    .timeout(input.timeout)
                    .json(&payload);
            let response: AnthropicResponse = transport::decode(request).await?;
            if response.stop_reason.as_deref() == Some("max_tokens") {
                return Err("출력 길이 제한으로 응답이 잘렸습니다.".into());
            }
            let text = response
                .content
                .into_iter()
                .filter_map(|part| match part {
                    Content::Text { text } => Some(text),
                    Content::Other => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            nonempty(text)
        }
        ConnectionKind::Opencodex
        | ConnectionKind::Openclaw
        | ConnectionKind::Openrouter
        | ConnectionKind::OpenaiCompatible
        | ConnectionKind::OpenaiApi => {
            if profile.kind == ConnectionKind::Openclaw && !profile.text_only_confirmed {
                return Err(
                    "OpenClaw는 도구가 차단된 별도 에이전트 설정을 확인한 뒤 사용할 수 있습니다."
                        .into(),
                );
            }
            let mut payload = json!({"model":input.model,"stream":false,"messages":[{"role":"system","content":input.system},{"role":"user","content":input.text}]});
            match profile.kind {
                ConnectionKind::OpenaiApi => {
                    payload["max_completion_tokens"] = json!(input.max_tokens)
                }
                ConnectionKind::Openclaw => {
                    payload["max_completion_tokens"] = json!(input.max_tokens);
                    payload["tools"] = json!([]);
                    payload["tool_choice"] = json!("none");
                }
                ConnectionKind::Opencodex
                | ConnectionKind::Openrouter
                | ConnectionKind::OpenaiCompatible => {
                    payload["max_tokens"] = json!(input.max_tokens)
                }
                ConnectionKind::Opencode | ConnectionKind::AnthropicApi => {
                    return Err("연결 프로토콜 선택 오류입니다.".into())
                }
            }
            let request = transport::authorize(
                client.post(format!("{}/chat/completions", profile.base)),
                profile,
            )?
            .timeout(input.timeout)
            .json(&payload);
            let response: ChatResponse = transport::decode(request).await?;
            let choice = response
                .choices
                .into_iter()
                .next()
                .ok_or("서버가 응답을 반환하지 않았습니다.")?;
            if choice.finish_reason.as_deref() == Some("length") {
                return Err("출력 길이 제한으로 응답이 잘렸습니다.".into());
            }
            nonempty(choice.message.content.unwrap_or_default())
        }
    }
}

pub(super) fn nonempty(text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        Err("모델이 빈 응답을 반환했습니다.".into())
    } else {
        Ok(text)
    }
}

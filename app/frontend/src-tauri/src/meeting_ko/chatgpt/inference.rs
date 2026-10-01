use super::stream::StreamDecoder;
use super::{http, registry::Registry, STATE};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

#[derive(Deserialize)]
struct Catalog {
    models: Vec<Model>,
}
#[derive(Deserialize)]
struct Model {
    slug: String,
    display_name: String,
    visibility: String,
}

async fn credential() -> Result<(String, tokio_util::sync::CancellationToken, String), String> {
    let session = STATE.lock().await;
    let mut registry = Registry::load()?;
    let account = registry.selected()?;
    let revision = format!(
        "{:x}",
        Sha256::digest(format!("{}:{}", account.client_id, account.subject).as_bytes())
    );
    let access = registry.access().await?;
    Ok((access, session.requests.child_token(), revision))
}

async fn catalog(access: &str) -> Result<Vec<Model>, String> {
    let result: Catalog = http::json(
        http::client()?
            .get("https://api.openai.com/v1/models")
            .bearer_auth(access)
            .send()
            .await
            .map_err(|_| "ChatGPT 모델 조회 연결 실패")?,
    )
    .await?;
    Ok(result
        .models
        .into_iter()
        .filter(|m| m.visibility == "list")
        .collect())
}

pub async fn models() -> Result<Vec<Value>, String> {
    let (access, cancel, revision) = credential().await?;
    let models = tokio::select! {
        _=cancel.cancelled()=>return Err("ChatGPT 연결이 변경되어 요청을 취소했습니다.".into()),
        result=catalog(&access)=>result?,
    };
    if cancel.is_cancelled() {
        return Err("ChatGPT 연결이 변경되어 요청을 취소했습니다.".into());
    }
    Ok(models
        .into_iter()
        .map(
            |m| json!({"id":m.slug,"name":m.display_name,"provider":"chatgpt","revision":revision,"destination":"https://api.openai.com/v1","connectionLabel":"ChatGPT 공식 OAuth"}),
        )
        .collect())
}

pub async fn generate(
    model: &str,
    system: &str,
    prompt: &str,
    max_output_tokens: u32,
    expected_revision: Option<&str>,
) -> Result<String, String> {
    if model.is_empty() || model.len() > 200 || system.len() + prompt.len() > 200_000 {
        return Err("ChatGPT 입력 크기 또는 모델을 확인하세요.".into());
    }
    let (access, cancel, revision) = credential().await?;
    if expected_revision.is_some_and(|expected| expected != revision) {
        return Err("ChatGPT 계정이 변경되었습니다. 현재 계정의 모델을 다시 선택하세요.".into());
    }
    let result = tokio::select! {
        _=cancel.cancelled()=>Err("ChatGPT 연결이 변경되어 요청을 취소했습니다.".into()),
        result=async {
            if !catalog(&access).await?.iter().any(|m|m.slug==model) {
                return Err("이 ChatGPT 계정에서 제공되는 모델을 다시 선택하세요.".into());
            }
            let response=http::client()?.post("https://api.openai.com/v1/responses")
                .timeout(Duration::from_secs(600)).bearer_auth(&access)
                .json(&super::request::payload(model,system,prompt,max_output_tokens))
                .send().await.map_err(|_| "ChatGPT 추론 연결 실패")?;
            if !response.status().is_success() {
                let _:Value=http::json(response).await?;
                return Err("ChatGPT 추론 요청이 거절되었습니다.".into());
            }
            consume(response).await
        }=>result,
    };
    if cancel.is_cancelled() {
        return Err("ChatGPT 연결이 변경되어 요청을 취소했습니다.".into());
    }
    result
}

async fn consume(mut response: reqwest::Response) -> Result<String, String> {
    let mut decoder = StreamDecoder::default();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "ChatGPT 응답 스트림이 중단되었습니다.")?
    {
        decoder.push(&chunk)?;
    }
    decoder.finish()
}

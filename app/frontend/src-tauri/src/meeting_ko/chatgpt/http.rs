use super::protocol::{TokenResponse, ISSUER};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::time::Duration;

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "ChatGPT 연결 클라이언트를 준비하지 못했습니다.".into())
}

pub async fn json<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T, String> {
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|h| h.to_str().ok())
        .filter(|s| {
            s.len() <= 128
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
        .unwrap_or("unknown")
        .to_owned();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "ChatGPT 응답 수신 실패")?
    {
        if bytes.len() + chunk.len() > 2_000_000 {
            return Err("ChatGPT 응답 크기 제한을 초과했습니다.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        let diagnostic = super::diagnostics::describe(&bytes);
        return Err(format!(
            "ChatGPT HTTP {} / {} / 매개변수 {} / 응답 {} / 요청 {}",
            status.as_u16(),
            diagnostic.code,
            diagnostic.parameter,
            diagnostic.shape,
            request_id
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| "ChatGPT 응답 형식이 올바르지 않습니다.".into())
}

#[derive(Deserialize)]
pub struct Discovery {
    pub issuer: String,
    pub jwks_uri: String,
    pub revocation_endpoint: String,
}

pub async fn discovery() -> Result<Discovery, String> {
    let metadata: Discovery = json(
        client()?
            .get(format!("{ISSUER}/.well-known/openid-configuration"))
            .send()
            .await
            .map_err(|_| "ChatGPT 인증 정보 조회 실패")?,
    )
    .await?;
    if metadata.issuer != ISSUER {
        return Err("ChatGPT 발급자 검증 실패".into());
    }
    for endpoint in [&metadata.jwks_uri, &metadata.revocation_endpoint] {
        let url = url::Url::parse(endpoint).map_err(|_| "ChatGPT 인증 주소 오류")?;
        if url.scheme() != "https"
            || url.host_str() != Some("auth.openai.com")
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("ChatGPT 인증 주소 검증 실패".into());
        }
    }
    Ok(metadata)
}

pub async fn exchange(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    json(
        client()?
            .post(super::protocol::TOKEN)
            .form(form)
            .send()
            .await
            .map_err(|_| "ChatGPT 토큰 연결 실패. 다시 로그인해 주세요.")?,
    )
    .await
}

use super::{
    bound_credentials,
    types::{ConnectionKind, Profile},
};
use reqwest::{Client, RequestBuilder};
use serde::de::DeserializeOwned;
use std::time::Duration;

pub fn client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .resolve("localhost", std::net::SocketAddr::from(([127, 0, 0, 1], 0)))
        .no_proxy()
        .build()
        .map_err(|_| "연결 클라이언트를 만들지 못했습니다.".into())
}

pub fn authorize(request: RequestBuilder, profile: &Profile) -> Result<RequestBuilder, String> {
    Ok(Authorization::new(profile)?.apply(request))
}

pub struct Authorization<'a> {
    profile: &'a Profile,
    key: String,
}
impl<'a> Authorization<'a> {
    pub fn new(profile: &'a Profile) -> Result<Self, String> {
        Ok(Self {
            profile,
            key: bound_credentials::read(profile)?,
        })
    }
    pub fn apply(&self, request: RequestBuilder) -> RequestBuilder {
        let profile = self.profile;
        let key = &self.key;
        match profile.kind {
            ConnectionKind::Opencode if !key.is_empty() => request.basic_auth(
                if profile.username.is_empty() {
                    "opencode"
                } else {
                    &profile.username
                },
                Some(key),
            ),
            ConnectionKind::AnthropicApi => request
                .header("anthropic-version", "2023-06-01")
                .header("x-api-key", key),
            ConnectionKind::Opencodex
            | ConnectionKind::Openclaw
            | ConnectionKind::Openrouter
            | ConnectionKind::OpenaiCompatible
            | ConnectionKind::OpenaiApi
            | ConnectionKind::Opencode => {
                if key.is_empty() {
                    request
                } else {
                    request.bearer_auth(key)
                }
            }
        }
    }
}

pub async fn decode<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, String> {
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "연결 시간이 초과되었습니다."
        } else {
            "서버 연결에 실패했습니다. 주소와 실행 상태를 확인하세요."
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "연결 서버 응답 오류 (HTTP {}). 인증 및 서버 설정을 확인하세요.",
            status.as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > 4 * 1024 * 1024)
    {
        return Err("서버 응답이 허용 크기를 초과했습니다.".into());
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "서버 응답을 읽지 못했습니다.")?
    {
        if body.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("서버 응답이 허용 크기를 초과했습니다.".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "서버 응답 형식이 올바르지 않습니다.".into())
}

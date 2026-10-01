use super::{http, protocol::ISSUER};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
pub struct Identity {
    pub sub: String,
    pub email: Option<String>,
    pub nonce: Option<String>,
    pub azp: Option<String>,
}

pub async fn verify(token: &str, client_id: &str, nonce: Option<&str>) -> Result<Identity, String> {
    let header = decode_header(token).map_err(|_| "ChatGPT ID 토큰 헤더 오류")?;
    if header.alg != Algorithm::RS256 {
        return Err("ChatGPT ID 토큰 서명 방식 오류".into());
    }
    let kid = header.kid.ok_or("ChatGPT ID 토큰 키 ID 누락")?;
    let metadata = http::discovery().await?;
    let keys: jsonwebtoken::jwk::JwkSet = http::json(
        http::client()?
            .get(metadata.jwks_uri)
            .send()
            .await
            .map_err(|_| "ChatGPT 서명 키 조회 실패")?,
    )
    .await?;
    let jwk = keys
        .find(&kid)
        .ok_or("ChatGPT 서명 키를 찾지 못했습니다.")?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| "ChatGPT 서명 키 형식 오류")?;
    verify_with_key(token, client_id, nonce, &key)
}

pub(super) fn verify_with_key(
    token: &str,
    client_id: &str,
    nonce: Option<&str>,
    key: &DecodingKey,
) -> Result<Identity, String> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.validate_nbf = true;
    validation.leeway = 30;
    let identity = decode::<Identity>(token, key, &validation)
        .map_err(|_| "ChatGPT ID 토큰 서명·발급자·대상·유효기간 검증 실패")?
        .claims;
    if identity.sub.is_empty()
        || identity.azp.as_deref().is_some_and(|azp| azp != client_id)
        || nonce.is_some_and(|n| identity.nonce.as_deref() != Some(n))
    {
        return Err("ChatGPT 계정 또는 nonce 검증 실패".into());
    }
    Ok(identity)
}

#[cfg(test)]
#[path = "identity_tests.rs"]
mod tests;

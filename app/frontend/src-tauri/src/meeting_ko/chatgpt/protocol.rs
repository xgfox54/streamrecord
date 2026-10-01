use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

pub const ISSUER: &str = "https://auth.openai.com";
pub const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
pub const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
pub const RESOURCE: &str = "https://api.openai.com/v1";
pub const SCOPE: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";

pub struct Attempt {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub redirect: String,
    pub account: Option<Account>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Account {
    pub client_id: String,
    pub subject: String,
    pub email: Option<String>,
    pub tokens: Option<Tokens>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub scopes: Vec<String>,
    pub expires_at: u64,
    pub earliest_refresh_at: u64,
}

#[derive(Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    pub id_token: Option<String>,
    pub token_type: String,
    pub expires_in: u64,
    pub scope: String,
    #[serde(default)]
    pub earliest_refresh_at: u64,
}

impl TokenResponse {
    pub fn tokens(self, retained_id: Option<&str>) -> Result<Tokens, String> {
        if !self.token_type.eq_ignore_ascii_case("bearer")
            || self.access_token.is_empty()
            || self.expires_in == 0
            || self.expires_in > 86400
        {
            return Err("ChatGPT 토큰 응답이 유효하지 않습니다.".into());
        }
        let id_token = self
            .id_token
            .or_else(|| retained_id.map(str::to_owned))
            .filter(|value| !value.is_empty())
            .ok_or("ChatGPT ID 토큰이 없습니다.")?;
        Ok(Tokens {
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            id_token,
            scopes: self.scope.split_whitespace().map(str::to_owned).collect(),
            expires_at: now()?.saturating_add(self.expires_in),
            earliest_refresh_at: self.earliest_refresh_at,
        })
    }
}

pub fn now() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|_| "시스템 시간을 확인하세요.".into())
}

pub fn random_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn authorize_url(attempt: &Attempt, host: &str, consent: bool) -> Result<Url, String> {
    let mut url = Url::parse(AUTHORIZE).map_err(|_| "ChatGPT 인증 주소 오류")?;
    let mut query = url.query_pairs_mut();
    let client = attempt
        .account
        .as_ref()
        .map_or("dynamic_agent_client", |a| a.client_id.as_str());
    query.extend_pairs([
        ("client_id", client),
        ("ext_agent_host_id", host),
        ("response_type", "code"),
        ("redirect_uri", &attempt.redirect),
        ("scope", SCOPE),
        ("resource", RESOURCE),
        ("state", &attempt.state),
        ("nonce", &attempt.nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge(&attempt.verifier)),
    ]);
    match &attempt.account {
        None => {
            query.append_pair("agent_name_hint", "Stream-Record");
        }
        Some(account) => {
            if let Some(tokens) = &account.tokens {
                query.append_pair("id_token_hint", &tokens.id_token);
            }
            if let Some(email) = &account.email {
                query.append_pair("login_hint", email);
            }
        }
    }
    if consent {
        query.append_pair("prompt", "consent");
    }
    drop(query);
    Ok(url)
}

pub struct AuthorizationCode {
    pub code: String,
    pub client_id: String,
}

pub fn callback(target: &str, attempt: &Attempt) -> Result<AuthorizationCode, String> {
    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "잘못된 로그인 콜백입니다.")?;
    if url.path() != "/auth/callback" {
        return Err("잘못된 로그인 콜백 경로입니다.".into());
    }
    let mut values = std::collections::HashMap::new();
    for (key, value) in url.query_pairs() {
        if values
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err("중복된 로그인 콜백 값입니다.".into());
        }
    }
    if values.get("state") != Some(&attempt.state) {
        return Err("로그인 상태 검증에 실패했습니다.".into());
    }
    if values.contains_key("error") {
        return Err("ChatGPT 로그인이 거절되거나 취소되었습니다.".into());
    }
    let code = values
        .remove("code")
        .filter(|v| !v.is_empty())
        .ok_or("인증 코드가 없습니다.")?;
    let client_id = match (&attempt.account, values.remove("client_id")) {
        (None, Some(id))
            if id.len() <= 256
                && id.strip_prefix("oaiapp_").is_some_and(|suffix| {
                    !suffix.is_empty()
                        && suffix
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                }) =>
        {
            id
        }
        (Some(account), Some(id)) if id == account.client_id => id,
        (Some(account), None) => account.client_id.clone(),
        _ => return Err("발급된 ChatGPT 클라이언트 ID 검증에 실패했습니다.".into()),
    };
    Ok(AuthorizationCode { code, client_id })
}

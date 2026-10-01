use super::super::connections::credentials;
use super::{
    http, identity,
    protocol::{Account, Tokens, RESOURCE},
};
use serde::{Deserialize, Serialize};

const KEY: &str = "chatgpt-accounts";
#[derive(Default, Serialize, Deserialize)]
pub struct Registry {
    pub host_id: String,
    pub active: Option<String>,
    pub accounts: Vec<Account>,
}

impl Registry {
    pub fn load() -> Result<Self, String> {
        match credentials::read(KEY)? {
            Some(raw) => serde_json::from_str(&raw)
                .map_err(|_| "ChatGPT 계정 저장 정보가 손상되었습니다.".into()),
            None => Ok(Self {
                host_id: format!("urn:uuid:{}", uuid::Uuid::new_v4()),
                ..Self::default()
            }),
        }
    }
    pub fn save(&self) -> Result<(), String> {
        let raw = serde_json::to_string(self).map_err(|_| "ChatGPT 계정 저장 형식 오류")?;
        credentials::write(KEY, &raw)
    }
    pub fn selected(&self) -> Result<&Account, String> {
        self.accounts
            .iter()
            .find(|a| Some(&a.client_id) == self.active.as_ref())
            .ok_or_else(|| "ChatGPT 계정을 연결하고 선택하세요.".into())
    }
    pub async fn access(&mut self) -> Result<String, String> {
        let account = self.selected()?.clone();
        let tokens = account
            .tokens
            .as_ref()
            .ok_or("ChatGPT에 다시 로그인해 주세요.")?;
        if !tokens
            .scopes
            .iter()
            .any(|s| s == super::protocol::PLAN_SCOPE)
        {
            return Err(
                "ChatGPT 요금제 사용 권한이 없습니다. 권한을 허용해 다시 로그인하세요.".into(),
            );
        }
        let now = super::protocol::now()?;
        if tokens.expires_at > now + 60 {
            return Ok(tokens.access_token.clone());
        }
        if tokens.refresh_token.is_empty() {
            return Err("ChatGPT 세션을 갱신하려면 다시 로그인하세요.".into());
        }
        if now < tokens.earliest_refresh_at {
            return Err("ChatGPT 토큰 갱신 가능 시각 전입니다. 잠시 후 다시 시도하세요.".into());
        }
        let response = match http::exchange(&[
            ("grant_type", "refresh_token"),
            ("client_id", &account.client_id),
            ("refresh_token", &tokens.refresh_token),
            ("resource", RESOURCE),
        ])
        .await
        {
            Ok(response) => response,
            Err(error) => {
                if [
                    "invalid_grant",
                    "invalid_refresh_token",
                    "token_expired",
                    "refresh_token_expired",
                    "refresh_token_invalidated",
                    "refresh_token_reused",
                ]
                .iter()
                .any(|code| error.contains(&format!(" / {code} / ")))
                {
                    self.replace_tokens(&account.client_id, None)?;
                }
                return Err(error);
            }
        };
        if let Some(id_token) = &response.id_token {
            let verified = identity::verify(id_token, &account.client_id, None).await?;
            if verified.sub != account.subject {
                return Err("ChatGPT 갱신 계정이 일치하지 않습니다.".into());
            }
        }
        let next = response.tokens(Some(&tokens.id_token))?;
        let access = next.access_token.clone();
        let enabled = next.scopes.iter().any(|s| s == super::protocol::PLAN_SCOPE);
        self.replace_tokens(&account.client_id, Some(next))?;
        if !enabled {
            return Err("ChatGPT 요금제 사용 권한이 해제되었습니다.".into());
        }
        Ok(access)
    }
    pub fn replace_tokens(
        &mut self,
        client_id: &str,
        tokens: Option<Tokens>,
    ) -> Result<(), String> {
        let account = self
            .accounts
            .iter_mut()
            .find(|a| a.client_id == client_id)
            .ok_or("ChatGPT 계정을 찾지 못했습니다.")?;
        account.tokens = tokens;
        self.save()
    }
}

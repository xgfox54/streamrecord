use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    Opencodex,
    Openclaw,
    Openrouter,
    Opencode,
    OpenaiCompatible,
    OpenaiApi,
    AnthropicApi,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub label: String,
    pub kind: ConnectionKind,
    pub base: String,
    pub enabled: bool,
    #[serde(default)]
    pub manual_model_ids: Vec<String>,
    #[serde(default)]
    pub text_only_confirmed: bool,
    #[serde(default)]
    pub username: String,
    pub revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileInput {
    pub id: Option<String>,
    pub label: String,
    pub kind: ConnectionKind,
    pub base: String,
    pub enabled: bool,
    #[serde(default)]
    pub manual_model_ids: Vec<String>,
    #[serde(default)]
    pub text_only_confirmed: bool,
    #[serde(default)]
    pub username: String,
    pub api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    #[serde(flatten)]
    pub profile: Profile,
    pub has_api_key: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBinding {
    pub id: String,
    pub provider: String,
    pub connection_id: String,
    pub connection_label: String,
    pub destination: String,
    pub revision: String,
}

impl Profile {
    pub fn binding(&self, model: String) -> ModelBinding {
        ModelBinding {
            id: model,
            provider: format!("connection:{}", self.id),
            connection_id: self.id.clone(),
            connection_label: self.label.clone(),
            destination: self.base.clone(),
            revision: self.revision.clone(),
        }
    }
    pub fn credential_key(&self) -> String {
        format!("connection-{}", self.id)
    }
}

pub struct GenerationInput<'a> {
    pub model: &'a str,
    pub system: &'a str,
    pub text: &'a str,
    pub max_tokens: u32,
    pub timeout: Duration,
}

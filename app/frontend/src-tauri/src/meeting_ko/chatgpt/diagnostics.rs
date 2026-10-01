use serde::Deserialize;

const FIELDS: &[&str] = &[
    "model",
    "input",
    "instructions",
    "store",
    "stream",
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
    "previous_response_id",
    "tools",
];

#[derive(Deserialize)]
struct Envelope {
    error: Option<ErrorBody>,
    detail: Option<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum ErrorBody {
    Code(String),
    Object {
        code: Option<String>,
        #[serde(rename = "type")]
        kind: Option<String>,
        param: Option<String>,
        message: Option<String>,
    },
}

pub(super) struct Diagnostic {
    pub code: String,
    pub parameter: &'static str,
    pub shape: &'static str,
}

pub(super) fn describe(bytes: &[u8]) -> Diagnostic {
    let parsed = serde_json::from_slice::<Envelope>(bytes);
    let (code, param, message, shape) = match parsed {
        Ok(Envelope {
            error: Some(ErrorBody::Code(code)),
            ..
        }) => (Some(code), None, None, "oauth_error"),
        Ok(Envelope {
            error:
                Some(ErrorBody::Object {
                    code,
                    kind,
                    param,
                    message,
                }),
            ..
        }) => (code.or(kind), param, message, "error_object"),
        Ok(Envelope {
            error: None,
            detail: Some(serde_json::Value::String(text)),
        }) => (None, None, Some(text), "detail_string"),
        Ok(Envelope {
            error: None,
            detail: Some(serde_json::Value::Array(_)),
        }) => (None, None, None, "detail_array"),
        Ok(_) => (None, None, None, "other_json"),
        Err(_) => (None, None, None, "unrecognized_body"),
    };
    let parameter = FIELDS
        .iter()
        .copied()
        .find(|field| param.as_deref() == Some(*field))
        .or_else(|| {
            message
                .as_ref()
                .filter(|text| {
                    text.len() < 1024
                        && (text.to_ascii_lowercase().contains("unsupported")
                            || text.to_ascii_lowercase().contains("not supported"))
                })
                .and_then(|text| FIELDS.iter().copied().find(|field| text.contains(field)))
        })
        .unwrap_or("unknown");
    let code = code
        .filter(|value| {
            value.len() <= 100 && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
        .unwrap_or_else(|| {
            if parameter != "unknown" {
                "unsupported_parameter".into()
            } else {
                "request_failed".into()
            }
        });
    Diagnostic {
        code,
        parameter,
        shape,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn stream_record_chatgpt_preserves_safe_unsupported_field_diagnostic() {
        // Given direct-route detail rejection. When classifying. Then retain the known rejected field without raw text.
        let d = super::describe(br#"{"detail":"Unsupported parameter: max_output_tokens"}"#);
        assert_eq!(d.parameter, "max_output_tokens");
        assert_eq!(d.code, "unsupported_parameter");
        assert_eq!(d.shape, "detail_string");
    }
    #[test]
    fn stream_record_chatgpt_error_diagnostics_never_reflect_arbitrary_message_or_param() {
        // Given a server echo containing secret-like data. When classifying. Then neither message nor unrecognized param escapes.
        let d=super::describe(br#"{"error":{"type":"invalid_request_error","param":"secret-from-input","message":"Bearer private-test-value"}}"#);
        assert_eq!(d.parameter, "unknown");
        assert_eq!(d.code, "invalid_request_error");
    }
}

use serde_json::{json, Value};

// SIWC preview forbids max_output_tokens; client-side stream/event bounds remain enforced.
// https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations (2026-10-01)
pub(super) fn payload(model: &str, system: &str, prompt: &str, _max_output_tokens: u32) -> Value {
    json!({"model":model,"input":[{"role":"developer","content":system},{"role":"user","content":prompt}],
        "store":false,"stream":true})
}

#[cfg(test)]
mod tests {
    #[test]
    fn stream_record_chatgpt_direct_request_omits_unsupported_output_limit() {
        // Given a stage token budget. When building a direct plan request. Then it contains only supported route fields.
        let body = super::payload("test-model", "test-system", "test-input", 3000);
        assert!(
            body.get("max_output_tokens").is_none(),
            "SIWC rejects max_output_tokens before inference"
        );
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert_eq!(body["input"][0]["role"], "developer");
        assert_eq!(body["input"][1]["content"], "test-input");
    }
}

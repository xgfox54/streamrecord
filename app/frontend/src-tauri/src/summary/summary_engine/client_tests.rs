use super::*;

#[test]
fn test_request_serialization() {
    let request = Request::Generate {
        prompt: "test prompt".to_string(),
        max_tokens: Some(512),
        context_size: Some(2048),
        model_path: Some("/path/to/model.gguf".to_string()),
        temperature: Some(1.0),
        top_k: Some(64),
        top_p: Some(0.95),
        presence_penalty: Some(0.3),
        frequency_penalty: Some(0.0),
        repeat_penalty: Some(1.05),
        penalty_last_n: Some(256),
        stop_tokens: Some(vec!["<end_of_turn>".to_string()]),
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("\"type\":\"generate\""));
    assert!(json.contains("\"prompt\":\"test prompt\""));
    assert!(json.contains("\"max_tokens\":512"));
    assert!(json.contains("\"temperature\":1.0"));
    assert!(json.contains("\"presence_penalty\":0.3"));
    assert!(json.contains("\"frequency_penalty\":0.0"));
    assert!(json.contains("\"repeat_penalty\":1.05"));
    assert!(json.contains("\"penalty_last_n\":256"));
}

#[test]
fn test_response_deserialization() {
    let json = r#"{"type":"response","text":"generated text","error":null}"#;
    let response: Response = serde_json::from_str(json).unwrap();

    match response {
        Response::Response { text, error } => {
            assert_eq!(text, "generated text");
            assert!(error.is_none());
        }
        _ => panic!("Wrong response type"),
    }
}

#[test]
fn test_error_response_deserialization() {
    let json = r#"{"type":"error","message":"something went wrong"}"#;
    let response: Response = serde_json::from_str(json).unwrap();

    match response {
        Response::Error { message } => {
            assert_eq!(message, "something went wrong");
        }
        _ => panic!("Wrong response type"),
    }
}

#[tokio::test]
async fn bounded_generation_rejects_invalid_limits_before_loading_model() {
    let path = PathBuf::from("unused-test-model-directory");
    for limit in [0, -1, 4097] {
        let input = BuiltinGeneration {
            model_name: "missing",
            system_prompt: "",
            user_prompt: "test",
            max_tokens: limit,
            timeout: Duration::from_secs(1),
        };
        let error = generate_bounded(&path, &input, None).await.unwrap_err();
        assert!(error.to_string().contains("limits"));
    }
}

#[tokio::test]
async fn bounded_generation_respects_cancellation_before_starting_sidecar() {
    let token = CancellationToken::new();
    token.cancel();
    let input = BuiltinGeneration {
        model_name: "missing",
        system_prompt: "",
        user_prompt: "test",
        max_tokens: 16,
        timeout: Duration::from_secs(1),
    };
    let error = generate_bounded(
        &PathBuf::from("unused-test-model-directory"),
        &input,
        Some(&token),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("cancelled before"));
}

#[tokio::test]
#[ignore = "requires explicitly supplied isolated GGUF and llama-helper"]
async fn stream_record_builtin_real_inference() {
    let dir = PathBuf::from(
        std::env::var("STREAM_RECORD_BUILTIN_TEST_DIR").expect("isolated model directory"),
    );
    let input = BuiltinGeneration {
        model_name: "qwen3.5:2b",
        system_prompt: "짧게 한국어로 답하세요.",
        user_prompt: "회의는 금요일 오후 두 시입니다. 회의 시간을 한 문장으로 알려주세요.",
        max_tokens: 96,
        timeout: Duration::from_secs(180),
    };
    let result = generate_bounded(&dir, &input, None).await;
    force_shutdown_sidecar().await.expect("sidecar shutdown");
    let text = result.expect("real GGUF generation");
    assert!(!text.trim().is_empty());
    assert!(text.chars().any(|ch| ('가'..='힣').contains(&ch)));
    println!(
        "BUILTIN_INFERENCE_VERIFIED model=qwen3.5:2b chars={}",
        text.chars().count()
    );
}

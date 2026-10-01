use super::test_profile::profile;
use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    time::Duration,
};

fn server(
    replies: Vec<(u16, &'static str)>,
) -> (String, mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (send, receive) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        for (status, body) in replies {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut data = Vec::new();
            loop {
                let mut chunk = [0u8; 4096];
                let count = socket.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                data.extend_from_slice(&chunk[..count]);
                if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&data[..pos]);
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .map(|v| v.parse::<usize>().unwrap())
                        .unwrap_or(0);
                    if data.len() >= pos + 4 + length {
                        break;
                    }
                }
            }
            send.send(String::from_utf8(data).unwrap()).unwrap();
            write!(socket,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
    });
    (base, receive, handle)
}

fn input(model: &str) -> GenerationInput<'_> {
    GenerationInput {
        model,
        system: "test",
        text: "hello",
        max_tokens: 100,
        timeout: Duration::from_secs(5),
    }
}

#[tokio::test]
async fn catalog_binds_duplicate_model_names_to_correct_connection() {
    // Given a real local HTTP catalog with a duplicate and a manual model.
    let (base, requests, worker) = server(vec![(200, r#"{"data":[{"id":"same"},{"id":"same"}]}"#)]);
    let mut profile = profile(base, ConnectionKind::Opencodex);
    profile.manual_model_ids.push("manual".into());
    // When the typed adapter lists it.
    let rows = list_models(&profile).await.unwrap();
    worker.join().unwrap();
    // Then each model carries this connection identity without losing manual entries.
    assert!(requests.recv().unwrap().starts_with("GET /models "));
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .all(|m| m.provider == format!("connection:{}", profile.id)));
}

#[tokio::test]
async fn unauthorized_response_redacts_echoed_secret() {
    // Given a server that echoes a secret in its failed response.
    let (base, _requests, worker) = server(vec![(401, r#"{"error":"secret-never-show"}"#)]);
    // When listing fails, then only a status category crosses the boundary.
    let error = list_models(&profile(base, ConnectionKind::Openrouter))
        .await
        .err()
        .unwrap();
    worker.join().unwrap();
    assert!(error.contains("401"));
    assert!(!error.contains("secret-never-show"));
}

#[tokio::test]
async fn truncated_generation_is_rejected() {
    // Given a valid but truncated chat response.
    let (base, _requests, worker) = server(vec![(
        200,
        r#"{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}"#,
    )]);
    // When generated, then truncated text is not returned as success.
    let result = generate(
        &profile(base, ConnectionKind::Opencodex),
        &input("test-model"),
    )
    .await;
    worker.join().unwrap();
    assert!(result.is_err());
}

#[tokio::test]
async fn anthropic_uses_native_messages_and_text_parts() {
    // Given an Anthropic protocol server.
    let (base, requests, worker) = server(vec![(
        200,
        r#"{"content":[{"type":"text","text":"complete"}],"stop_reason":"end_turn"}"#,
    )]);
    // When native generation runs.
    let result = generate(
        &profile(base, ConnectionKind::AnthropicApi),
        &input("claude-test"),
    )
    .await
    .unwrap();
    worker.join().unwrap();
    // Then endpoint, version header and structured response are honored.
    let request = requests.recv().unwrap();
    assert!(request.starts_with("POST /messages "));
    assert!(request.contains("anthropic-version: 2023-06-01"));
    assert_eq!(result, "complete");
}

#[tokio::test]
async fn openclaw_requires_confirmed_tool_isolation_before_request() {
    // Given an unconfirmed agent gateway, when requested, then no inference starts.
    let result = generate(
        &profile("http://127.0.0.1:1/v1".into(), ConnectionKind::Openclaw),
        &input("openclaw/default"),
    )
    .await;
    assert!(result.err().unwrap().contains("OpenClaw"));
}

#[tokio::test]
async fn opencode_uses_isolated_native_session_and_denies_tools() {
    // Given a native server that accepts a temporary session, message and deletion.
    let (base, requests, worker) = server(vec![
        (
            200,
            r#"{"id":"ses_test","permission":[{"permission":"*","pattern":"*","action":"deny"}]}"#,
        ),
        (
            200,
            r#"{"info":{"finish":"stop"},"parts":[{"type":"text","text":"native result"}]}"#,
        ),
        (200, "true"),
    ]);
    // When model provider/test receives text.
    let result = generate(
        &profile(base, ConnectionKind::Opencode),
        &input("provider/test"),
    )
    .await
    .unwrap();
    worker.join().unwrap();
    // Then only the isolated native endpoints are used and deny policy is explicit.
    let create = requests.recv().unwrap();
    let message = requests.recv().unwrap();
    let delete = requests.recv().unwrap();
    let payload: serde_json::Value =
        serde_json::from_str(create.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(payload["permission"][0]["action"], "deny");
    assert!(message.starts_with("POST /session/ses_test/message "));
    assert!(delete.starts_with("DELETE /session/ses_test "));
    assert_eq!(result, "native result");
}

#[tokio::test]
async fn opencode_refuses_server_that_ignores_permission_policy() {
    // Given a server that creates a session without confirming requested tool denial.
    let (base, requests, worker) = server(vec![(200, r#"{"id":"ses_legacy"}"#), (200, "true")]);
    // When generation is requested, then only create and cleanup occur.
    let result = generate(
        &profile(base, ConnectionKind::Opencode),
        &input("provider/test"),
    )
    .await;
    worker.join().unwrap();
    assert!(result.is_err());
    assert!(requests.recv().unwrap().starts_with("POST /session "));
    assert!(requests
        .recv()
        .unwrap()
        .starts_with("DELETE /session/ses_legacy "));
    assert!(requests.try_recv().is_err());
}

#[tokio::test]
async fn redirect_does_not_forward_bearer_secret() {
    // Given two local endpoints where the first attempts a redirect to the second.
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let source = TcpListener::bind("127.0.0.1:0").unwrap();
    let target_url = format!("http://{}/stolen", target.local_addr().unwrap());
    let source_url = format!("http://{}", source.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = source.accept().unwrap();
        let mut request = [0u8; 4096];
        let count = stream.read(&mut request).unwrap();
        assert!(count > 0);
        write!(stream,"HTTP/1.1 302 Found\r\nLocation: {target_url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    let connection = profile(source_url, ConnectionKind::Opencodex);
    bound_credentials::write(&connection, "disposable-test-key").unwrap();
    // When catalog request is redirected, then status is returned without following it.
    let result = list_models(&connection).await;
    credentials::remove(&connection.credential_key()).unwrap();
    worker.join().unwrap();
    assert!(result.err().unwrap().contains("302"));
    assert_eq!(
        target.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

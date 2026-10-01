use super::{
    bound_credentials, credentials, generate, test_profile::profile, ConnectionKind,
    GenerationInput,
};
use std::{net::TcpListener, time::Duration};

#[tokio::test]
async fn old_profile_never_sends_replacement_secret_to_old_destination() {
    // Given an in-flight profile snapshot and a subsequent destination/key replacement.
    let old_server = TcpListener::bind("127.0.0.1:0").unwrap();
    let new_server = TcpListener::bind("127.0.0.1:0").unwrap();
    old_server.set_nonblocking(true).unwrap();
    new_server.set_nonblocking(true).unwrap();
    let old = profile(
        format!("http://{}", old_server.local_addr().unwrap()),
        ConnectionKind::Opencodex,
    );
    bound_credentials::write(&old, "old-destination-secret").unwrap();
    let mut new = (*old).clone();
    new.base = format!("http://{}", new_server.local_addr().unwrap());
    new.revision = "replacement-revision".into();
    bound_credentials::write(&new, "new-destination-secret").unwrap();
    // When the stale request tries to obtain authorization after that atomic replacement.
    let input = GenerationInput {
        model: "test",
        system: "test",
        text: "sensitive transcript",
        max_tokens: 10,
        timeout: Duration::from_secs(1),
    };
    let result = generate(&old, &input).await;
    // Then neither destination receives text or credentials and the replacement stays usable.
    assert!(result.is_err());
    assert_eq!(
        old_server.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(
        new_server.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(
        bound_credentials::read(&new).unwrap(),
        "new-destination-secret"
    );
}

#[test]
fn deleted_credential_is_not_treated_as_anonymous_connection() {
    // Given a saved profile whose encrypted record has been removed.
    let old = profile("http://127.0.0.1:1".into(), ConnectionKind::Opencodex);
    credentials::remove(&old.credential_key()).unwrap();
    // When authorizing, then missing state is rejected, not silently converted to no auth.
    assert!(bound_credentials::read(&old).is_err());
}

#[test]
fn native_session_cleanup_retains_original_authorization_after_profile_change() {
    // Given an authorized native session and a later profile credential replacement.
    let old = profile("http://127.0.0.1:4096".into(), ConnectionKind::Opencode);
    bound_credentials::write(&old, "old-session-password").unwrap();
    let authorization = super::transport::Authorization::new(&old).unwrap();
    let mut changed = (*old).clone();
    changed.base = "https://new.example.test".into();
    changed.revision = "changed".into();
    bound_credentials::write(&changed, "replacement-password").unwrap();
    // When cleanup is built for the original session, it uses only the original binding.
    let request = authorization
        .apply(
            super::transport::client()
                .unwrap()
                .delete("http://127.0.0.1:4096/session/ses_test"),
        )
        .build()
        .unwrap();
    // Then the old server never receives the replacement password.
    assert_eq!(request.url().host_str(), Some("127.0.0.1"));
    assert_eq!(
        request.headers()["authorization"],
        "Basic b3BlbmNvZGU6b2xkLXNlc3Npb24tcGFzc3dvcmQ="
    );
}

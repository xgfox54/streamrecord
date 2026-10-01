use super::protocol::*;
fn pending() -> Attempt {
    Attempt {
        state: "state".into(),
        nonce: "nonce".into(),
        verifier: "verifier".into(),
        redirect: "http://127.0.0.1:12345/auth/callback".into(),
        account: None,
    }
}
#[test]
fn stream_record_chatgpt_challenge_matches_rfc7636_vector() {
    // Given the RFC 7636 verifier. When computing S256. Then the published challenge matches.
    assert_eq!(
        challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}
#[test]
fn stream_record_chatgpt_callback_rejects_state_and_missing_registration() {
    // Given an initial attempt. When receiving unbound callbacks. Then reject both.
    let a = pending();
    assert!(callback("/auth/callback?state=other&code=x&client_id=oaiapp_1", &a).is_err());
    assert!(callback("/auth/callback?state=state&code=x", &a).is_err());
    assert!(callback(
        "/auth/callback?state=state&state=state&code=x&client_id=oaiapp_1",
        &a
    )
    .is_err());
}
#[test]
fn stream_record_chatgpt_callback_preserves_returning_client_and_rejects_replacement() {
    // Given an existing registration. When receiving a callback. Then its client cannot change.
    let mut a = pending();
    a.account = Some(Account {
        client_id: "oaiapp_a".into(),
        subject: "sub".into(),
        email: None,
        tokens: None,
    });
    assert_eq!(
        callback("/auth/callback?state=state&code=x", &a)
            .unwrap()
            .client_id,
        "oaiapp_a"
    );
    assert!(callback("/auth/callback?state=state&code=x&client_id=oaiapp_b", &a).is_err());
}
#[test]
fn stream_record_chatgpt_initial_authorization_has_direct_scopes_and_exact_callback() {
    // Given an initial attempt. When producing browser URL. Then use public client PKCE contract.
    let a = pending();
    let url = authorize_url(&a, "urn:uuid:host", false).unwrap();
    let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(q.get("client_id").unwrap(), "dynamic_agent_client");
    assert_eq!(q.get("redirect_uri").unwrap(), &a.redirect);
    assert!(q
        .get("scope")
        .unwrap()
        .split_whitespace()
        .any(|s| s == PLAN_SCOPE));
    assert!(!q.contains_key("prompt"));
}

#[test]
fn stream_record_chatgpt_identity_only_grant_remains_signed_in_without_inference_scope() {
    // Given an identity-only consent grant. When storing validated tokens. Then retain identity with plan disabled.
    let response:TokenResponse=serde_json::from_str(r#"{"access_token":"test-only","id_token":"validated-by-caller","token_type":"Bearer","expires_in":3600,"scope":"openid email"}"#).unwrap();
    let tokens = response.tokens(None).unwrap();
    assert!(!tokens.scopes.iter().any(|s| s == PLAN_SCOPE));
    assert!(tokens.refresh_token.is_empty());
}

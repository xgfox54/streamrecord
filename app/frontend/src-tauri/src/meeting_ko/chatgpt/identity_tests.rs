use super::*;
use aws_lc_rs::{
    rand::SystemRandom,
    rsa::{KeyPair, KeySize},
    signature::{KeyPair as _, RSA_PKCS1_SHA256},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::sync::OnceLock;

fn signing_key() -> &'static KeyPair {
    static KEY: OnceLock<KeyPair> = OnceLock::new();
    KEY.get_or_init(|| KeyPair::generate(KeySize::Rsa2048).unwrap())
}
fn claims() -> Value {
    let now = super::super::protocol::now().unwrap();
    json!({"iss":ISSUER,"aud":"oaiapp_test","sub":"test-only-account","nonce":"expected","exp":now+3600})
}
fn signed(claims: Value) -> String {
    let header =
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"alg":"RS256","typ":"JWT"})).unwrap());
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
    let content = format!("{header}.{payload}");
    let mut signature = vec![0_u8; signing_key().public_modulus_len()];
    signing_key()
        .sign(
            &RSA_PKCS1_SHA256,
            &SystemRandom::new(),
            content.as_bytes(),
            &mut signature,
        )
        .unwrap();
    format!("{content}.{}", URL_SAFE_NO_PAD.encode(signature))
}
fn verify(claims: Value) -> Result<Identity, String> {
    let public = DecodingKey::from_rsa_der(signing_key().public_key().as_ref());
    verify_with_key(&signed(claims), "oaiapp_test", Some("expected"), &public)
}

#[test]
fn stream_record_chatgpt_accepts_runtime_signed_bound_identity() {
    // Given a fresh in-memory RSA key and valid claims. When verifying. Then the bound subject is returned.
    assert_eq!(verify(claims()).unwrap().sub, "test-only-account");
}
#[test]
fn stream_record_chatgpt_rejects_wrong_issuer() {
    // Given a valid signature from another issuer. When verifying. Then reject.
    let mut c = claims();
    c["iss"] = json!("https://example.invalid");
    assert!(verify(c).is_err());
}
#[test]
fn stream_record_chatgpt_rejects_wrong_audience() {
    // Given a token for another client. When verifying. Then reject.
    let mut c = claims();
    c["aud"] = json!("oaiapp_other");
    assert!(verify(c).is_err());
}
#[test]
fn stream_record_chatgpt_rejects_expired_identity() {
    // Given an expired signed token. When verifying. Then reject.
    let mut c = claims();
    c["exp"] = json!(1);
    assert!(verify(c).is_err());
}
#[test]
fn stream_record_chatgpt_rejects_wrong_nonce() {
    // Given a token from another authorization attempt. When verifying. Then reject.
    let mut c = claims();
    c["nonce"] = json!("other");
    assert!(verify(c).is_err());
}
#[test]
fn stream_record_chatgpt_rejects_modified_signature() {
    // Given a signed identity with altered signature bytes. When verifying. Then reject.
    let mut token = signed(claims()).into_bytes();
    let index = token.len() - 20;
    token[index] = if token[index] == b'A' { b'B' } else { b'A' };
    let public = DecodingKey::from_rsa_der(signing_key().public_key().as_ref());
    assert!(verify_with_key(
        std::str::from_utf8(&token).unwrap(),
        "oaiapp_test",
        Some("expected"),
        &public
    )
    .is_err());
}
#[test]
fn stream_record_chatgpt_rejects_malformed_optional_nbf_type() {
    // Given the advisory's malformed optional time claim. When nbf validation is enabled. Then it must not be treated as absent.
    let mut c = claims();
    c["nbf"] = json!("99999999999");
    assert!(
        verify(c).is_err(),
        "GHSA-h395-gr6q-cpjc: malformed nbf must not bypass validation"
    );
}
#[test]
fn stream_record_chatgpt_rejects_future_numeric_nbf() {
    // Given a signed identity valid only in the future. When verifying now. Then reject.
    let mut c = claims();
    c["nbf"] = json!(super::super::protocol::now().unwrap() + 7200);
    assert!(verify(c).is_err());
}
#[test]
fn stream_record_chatgpt_rejects_malformed_exp_type() {
    // Given an expiration claim with the wrong JSON type. When verifying. Then reject.
    let mut c = claims();
    c["exp"] = json!("99999999999");
    assert!(verify(c).is_err());
}

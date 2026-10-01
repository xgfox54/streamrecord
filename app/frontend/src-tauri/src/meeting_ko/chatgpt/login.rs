use super::{
    http, identity,
    protocol::{self, Account, Attempt, RESOURCE},
    registry::Registry,
};
use tokio::net::TcpListener;

pub async fn prepare(
    account: Option<Account>,
    registry: &Registry,
    consent: bool,
) -> Result<(TcpListener, Attempt, url::Url), String> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "로그인 콜백 포트를 열지 못했습니다.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "로그인 포트 확인 실패")?
        .port();
    let attempt = Attempt {
        state: protocol::random_secret(),
        nonce: protocol::random_secret(),
        verifier: protocol::random_secret(),
        redirect: format!("http://127.0.0.1:{port}/auth/callback"),
        account,
    };
    let url = protocol::authorize_url(&attempt, &registry.host_id, consent)?;
    Ok((listener, attempt, url))
}

pub async fn complete(listener: TcpListener, attempt: Attempt) -> Result<Account, String> {
    let authorization = super::transport::receive(listener, &attempt).await?;
    let response = http::exchange(&[
        ("grant_type", "authorization_code"),
        ("client_id", &authorization.client_id),
        ("code", &authorization.code),
        ("code_verifier", &attempt.verifier),
        ("redirect_uri", &attempt.redirect),
        ("resource", RESOURCE),
    ])
    .await?;
    let token = response.id_token.as_deref().ok_or("ChatGPT ID 토큰 누락")?;
    let verified = identity::verify(token, &authorization.client_id, Some(&attempt.nonce)).await?;
    if attempt
        .account
        .as_ref()
        .is_some_and(|a| a.subject != verified.sub)
    {
        return Err("선택한 ChatGPT 계정과 로그인 계정이 일치하지 않습니다.".into());
    }
    Ok(Account {
        client_id: authorization.client_id,
        subject: verified.sub,
        email: verified.email,
        tokens: Some(response.tokens(None)?),
    })
}

use super::protocol::{self, Attempt, AuthorizationCode};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

pub async fn receive(
    listener: TcpListener,
    attempt: &Attempt,
) -> Result<AuthorizationCode, String> {
    let expected_host = attempt
        .redirect
        .strip_prefix("http://")
        .and_then(|v| v.split('/').next())
        .ok_or("로그인 콜백 주소 오류")?;
    tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let (mut stream,peer)=listener.accept().await.map_err(|_| "로그인 콜백 연결 실패")?;
            if !peer.ip().is_loopback(){continue;}
            let mut bytes=Vec::new();
            let read=tokio::time::timeout(Duration::from_secs(3),async {
                let mut chunk=[0_u8;1024];
                while !bytes.windows(4).any(|v|v==b"\r\n\r\n") {
                    let count=stream.read(&mut chunk).await?;
                    if count==0 || bytes.len()+count>16_384 {break;}
                    bytes.extend_from_slice(&chunk[..count]);
                }
                Ok::<(),std::io::Error>(())
            }).await;
            if !matches!(read,Ok(Ok(()))) || !bytes.windows(4).any(|v|v==b"\r\n\r\n"){continue;}
            let request=match std::str::from_utf8(&bytes){Ok(v)=>v,Err(_)=>continue};
            let mut words=request.lines().next().unwrap_or_default().split_whitespace();
            let method=words.next();
            let target=words.next().unwrap_or_default();
            let host=request.lines().skip(1).filter_map(|l|l.split_once(':'))
                .find(|(name,_)|name.eq_ignore_ascii_case("host")).map(|(_,v)|v.trim());
            if method!=Some("GET") || host!=Some(expected_host) || !target.starts_with("/auth/callback?"){continue;}
            let result=protocol::callback(target,attempt);
            let body=match &result {
                Ok(_)=>"Login received. You can return to Stream-Record.",
                Err(_)=>"Login was rejected. Return to Stream-Record and try again.",
            };
            let reply=format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",body.len());
            let _reply=tokio::time::timeout(Duration::from_secs(2),stream.write_all(reply.as_bytes())).await;
            return result;
        }
    }).await.map_err(|_| "로그인 시간이 만료되었습니다. 다시 시도하세요.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn stream_record_chatgpt_loopback_accepts_only_matching_host_and_state() {
        // Given a real ephemeral loopback listener. When a browser returns its bound code. Then receive the issued client.
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let attempt = Attempt {
            state: "test-state".into(),
            nonce: "test-nonce".into(),
            verifier: "test-verifier".into(),
            redirect: format!("http://{address}/auth/callback"),
            account: None,
        };
        let server = tokio::spawn(async move { receive(listener, &attempt).await });
        let mut wrong = tokio::net::TcpStream::connect(address).await.unwrap();
        wrong.write_all(b"GET /auth/callback?state=test-state&code=wrong&client_id=oaiapp_test HTTP/1.1\r\nHost: evil.invalid\r\n\r\n").await.unwrap();
        wrong.shutdown().await.unwrap();
        let mut browser = tokio::net::TcpStream::connect(address).await.unwrap();
        browser.write_all(format!("GET /auth/callback?state=test-state&code=accepted&client_id=oaiapp_test HTTP/1.1\r\nHost: {address}\r\n\r\n").as_bytes()).await.unwrap();
        let result = tokio::time::timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(result.code, "accepted");
        assert_eq!(result.client_id, "oaiapp_test");
    }
}

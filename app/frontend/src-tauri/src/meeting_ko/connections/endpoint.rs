use url::{Host, Url};

pub fn normalize(base: &str) -> Result<String, String> {
    let base = base.trim();
    if base.len() > 1000 || base.contains(char::is_whitespace) {
        return Err("연결 주소가 올바르지 않습니다.".into());
    }
    let url = Url::parse(base).map_err(|_| "연결 주소가 올바르지 않습니다.")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("주소에 사용자 정보, 쿼리 또는 조각을 넣을 수 없습니다.".into());
    }
    let loopback = match url.host() {
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        Some(Host::Domain(host)) => host == "localhost",
        None => return Err("연결 주소에 호스트가 필요합니다.".into()),
    };
    match url.scheme() {
        "https" => {}
        "http" if loopback => {}
        _ => {
            return Err(
                "외부 서버는 HTTPS가 필요합니다. HTTP는 이 PC의 루프백 주소만 허용됩니다.".into(),
            )
        }
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_plaintext_remote_and_embedded_credentials() {
        // Given unsafe user-supplied destinations, when parsed, then none is accepted.
        for input in [
            "http://127.0.0.1.evil.test/v1",
            "http://192.168.0.1/v1",
            "https://user:secret@example.com",
            "https://example.com/?key=secret",
            "https://example.com/#secret",
            "file:///tmp",
        ] {
            assert!(super::normalize(input).is_err(), "{input}");
        }
    }
    #[test]
    fn accepts_only_loopback_http_or_https() {
        // Given supported endpoints, when normalized, then paths remain intact.
        for input in [
            "http://127.0.0.1:10100/v1",
            "http://[::1]:4096",
            "http://localhost:4096",
            "https://openrouter.ai/api/v1",
        ] {
            assert_eq!(super::normalize(input).unwrap(), input);
        }
    }
}

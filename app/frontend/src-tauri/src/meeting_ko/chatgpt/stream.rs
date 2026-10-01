use serde::Deserialize;

#[derive(Default)]
pub(super) struct StreamDecoder {
    bytes: Vec<u8>,
    text: String,
    completed: bool,
}
#[derive(Deserialize)]
struct Event {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    delta: String,
    response: Option<Response>,
    code: Option<String>,
}
#[derive(Deserialize)]
struct Response {
    status: Option<String>,
    error: Option<ApiError>,
}
#[derive(Deserialize)]
struct ApiError {
    code: Option<String>,
}
impl StreamDecoder {
    pub(super) fn push(&mut self, chunk: &[u8]) -> Result<(), String> {
        if self.bytes.len() + chunk.len() > 2_000_000 {
            return Err("ChatGPT 스트림 이벤트 크기 제한 초과".into());
        }
        self.bytes.extend_from_slice(chunk);
        loop {
            let lf = self
                .bytes
                .windows(2)
                .position(|w| w == [10, 10])
                .map(|i| (i, 2));
            let crlf = self
                .bytes
                .windows(4)
                .position(|w| w == [13, 10, 13, 10])
                .map(|i| (i, 4));
            let boundary = lf.into_iter().chain(crlf).min_by_key(|(index, _)| *index);
            let Some((index, width)) = boundary else {
                break;
            };
            let event = std::str::from_utf8(&self.bytes[..index])
                .map_err(|_| "ChatGPT 스트림 문자 인코딩 오류")?
                .to_owned();
            self.bytes.drain(..index + width);
            self.event(&event)?;
        }
        Ok(())
    }
    fn event(&mut self, raw: &str) -> Result<(), String> {
        let data = raw
            .lines()
            .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            return Ok(());
        }
        let event: Event =
            serde_json::from_str(&data).map_err(|_| "ChatGPT 스트림 이벤트 형식 오류")?;
        match event.kind.as_str() {
            "response.output_text.delta" => {
                if self.completed || self.text.len() + event.delta.len() > 1_000_000 {
                    return Err("ChatGPT 응답 크기 또는 이벤트 순서 오류".into());
                }
                self.text.push_str(&event.delta);
            }
            "response.completed" => {
                if event
                    .response
                    .as_ref()
                    .is_some_and(|r| r.status.as_deref() == Some("completed") && r.error.is_none())
                {
                    self.completed = true;
                } else {
                    return Err("ChatGPT 완료 상태가 유효하지 않습니다.".into());
                }
            }
            "response.failed" | "response.incomplete" | "error" => {
                let code = event
                    .response
                    .and_then(|r| r.error)
                    .and_then(|e| e.code)
                    .or(event.code);
                let safe = code.filter(|c| {
                    c.len() <= 100 && c.chars().all(|v| v.is_ascii_alphanumeric() || v == '_')
                });
                return Err(format!(
                    "ChatGPT 응답 실패: {}",
                    safe.as_deref().unwrap_or("incomplete_response")
                ));
            }
            _ => {}
        }
        Ok(())
    }
    pub(super) fn finish(self) -> Result<String, String> {
        if !self.completed
            || !self.bytes.iter().all(u8::is_ascii_whitespace)
            || self.text.trim().is_empty()
        {
            return Err(
                "ChatGPT의 완료된 응답을 받지 못했습니다. 부분 응답은 사용하지 않았습니다.".into(),
            );
        }
        Ok(self.text)
    }
}

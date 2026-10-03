//! Per-recording Korean STT hints. No global cross-meeting decoder history.
use once_cell::sync::Lazy;
use std::sync::Mutex;

#[derive(Default)]
struct LiveContext {
    active: bool,
    glossary: String,
}

#[derive(Clone)]
pub struct PromptTicket {
    pub text: String,
}

static LIVE: Lazy<Mutex<LiveContext>> = Lazy::new(|| Mutex::new(LiveContext::default()));

pub fn clean_hint(value: &str, max_chars: usize) -> String {
    let clean: String = value.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    clean.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max_chars).collect()
}

impl LiveContext {
    fn begin(&mut self, glossary: &str) {
        self.active = true;
        self.glossary = clean_hint(glossary, 300);
    }
    fn ticket(&self, start: f64, end: f64) -> Option<PromptTicket> {
        if !self.active || self.glossary.is_empty() || !start.is_finite() || !end.is_finite() || start < 0.0 || end < start {
            return None;
        }
        Some(PromptTicket { text: self.glossary.clone() })
    }
}

pub fn begin(glossary: &str) -> Result<(), String> {
    LIVE.lock().map_err(|_| "전사 문맥 잠금 오류".to_string())?.begin(glossary);
    Ok(())
}
pub fn end() {
    if let Ok(mut state) = LIVE.lock() {
        state.active = false;
        state.glossary.clear();
    }
}
pub fn for_chunk(start: f64, duration: f64) -> Option<PromptTicket> {
    LIVE.lock().ok()?.ticket(start, start + duration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_record_hint_is_bounded_unicode_and_nul_free() {
        let hint = clean_hint(&format!("제주\0가치\n{}", "돌봄".repeat(500)), 300);
        assert_eq!(hint.chars().count(), 300);
        assert!(!hint.chars().any(char::is_control));
        assert!(hint.starts_with("제주 가치 "));
    }

    #[test]
    fn stream_record_hints_contain_only_user_glossary() {
        let mut state = LiveContext::default();
        state.begin("제주가치돌봄");
        let first = state.ticket(0.0, 12.0).unwrap().text;
        let next = state.ticket(12.0, 24.0).unwrap().text;
        assert_eq!(first, "제주가치돌봄");
        assert_eq!(first, next);
        state.begin("새회의");
        let fresh = state.ticket(0.0, 12.0).unwrap().text;
        assert!(!fresh.contains("제주가치돌봄"));
        assert!(fresh.contains("새회의"));
        state.begin(" \n\0 ");
        assert!(state.ticket(0.0, 12.0).is_none());
    }

    #[test]
    fn stream_record_inactive_or_invalid_audio_gets_no_hint() {
        let mut state = LiveContext::default();
        assert!(state.ticket(0.0, 12.0).is_none());
        state.begin("제주");
        for (start, end) in [(f64::NAN, 12.0), (0.0, f64::INFINITY), (-1.0, 12.0), (12.0, 0.0)] {
            assert!(state.ticket(start, end).is_none());
        }
    }
}

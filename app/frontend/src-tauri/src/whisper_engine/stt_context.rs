//! Per-recording Korean STT hints. No global cross-meeting decoder history.
use once_cell::sync::Lazy;
use std::sync::Mutex;

#[derive(Default)]
struct LiveContext {
    generation: u64,
    active: bool,
    glossary: String,
    tail: Option<(u64, f64, String)>,
}

#[derive(Clone)]
pub struct PromptTicket {
    generation: u64,
    sequence: u64,
    end: f64,
    pub text: String,
}

static LIVE: Lazy<Mutex<LiveContext>> = Lazy::new(|| Mutex::new(LiveContext::default()));

pub fn clean_hint(value: &str, max_chars: usize) -> String {
    let clean: String = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    clean
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn tail_hint(value: &str) -> String {
    let clean = clean_hint(value, 20_000);
    let chars: Vec<char> = clean.chars().collect();
    chars[chars.len().saturating_sub(160)..].iter().collect()
}

impl LiveContext {
    fn begin(&mut self, glossary: &str) {
        self.generation = self.generation.wrapping_add(1);
        self.active = true;
        self.glossary = clean_hint(glossary, 300);
        self.tail = None;
    }
    fn ticket(&self, sequence: u64, start: f64, end: f64) -> Option<PromptTicket> {
        if !self.active || !start.is_finite() || !end.is_finite() || start < 0.0 || end < start {
            return None;
        }
        let mut text = "한국어 회의 발언.".to_string();
        if !self.glossary.is_empty() {
            text.push_str(&format!(" 용어: {}.", self.glossary));
        }
        if let Some((previous, previous_end, tail)) = &self.tail {
            // Parallel workers may finish out of order. Only use the immediately
            // preceding audio window and never bridge a long silent interval.
            if previous.checked_add(1) == Some(sequence)
                && start >= *previous_end - 0.1
                && start - *previous_end <= 2.0
                && !tail.is_empty()
            {
                text.push_str(&format!(" 이전 발언: {tail}"));
            }
        }
        Some(PromptTicket {
            generation: self.generation,
            sequence,
            end,
            text,
        })
    }
    fn finish(&mut self, ticket: &PromptTicket, text: &str, partial: bool) {
        if !self.active || self.generation != ticket.generation || partial {
            return;
        }
        if self
            .tail
            .as_ref()
            .map(|t| ticket.sequence <= t.0)
            .unwrap_or(false)
        {
            return;
        }
        self.tail = Some((ticket.sequence, ticket.end, tail_hint(text)));
    }
}

pub fn begin(glossary: &str) -> Result<(), String> {
    LIVE.lock()
        .map_err(|_| "전사 문맥 잠금 오류".to_string())?
        .begin(glossary);
    Ok(())
}
pub fn end() {
    if let Ok(mut state) = LIVE.lock() {
        state.active = false;
        state.tail = None;
        state.glossary.clear();
        state.generation = state.generation.wrapping_add(1);
    }
}
pub fn for_chunk(sequence: u64, start: f64, duration: f64) -> Option<PromptTicket> {
    LIVE.lock().ok()?.ticket(sequence, start, start + duration)
}
pub fn completed(ticket: &Option<PromptTicket>, text: &str, partial: bool) {
    if let (Some(ticket), Ok(mut state)) = (ticket, LIVE.lock()) {
        state.finish(ticket, text, partial);
    }
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
    fn stream_record_context_uses_only_adjacent_completed_audio() {
        let mut state = LiveContext::default();
        state.begin("제주가치돌봄");
        let first = state.ticket(0, 0.0, 12.0).unwrap();
        state.finish(&first, "사업을 검토합니다.", false);
        assert!(state
            .ticket(1, 12.0, 24.0)
            .unwrap()
            .text
            .contains("사업을 검토합니다"));
        assert!(!state
            .ticket(2, 12.0, 24.0)
            .unwrap()
            .text
            .contains("사업을 검토합니다"));
        assert!(!state
            .ticket(1, 30.0, 42.0)
            .unwrap()
            .text
            .contains("사업을 검토합니다"));
    }
    #[test]
    fn stream_record_new_meeting_rejects_old_worker_context() {
        let mut state = LiveContext::default();
        state.begin("이전회의");
        let old = state.ticket(0, 0.0, 12.0).unwrap();
        state.begin("새회의");
        state.finish(&old, "이전 비공개 발언", false);
        let now = state.ticket(1, 12.0, 24.0).unwrap();
        assert!(!now.text.contains("이전"));
        assert!(now.text.contains("새회의"));
    }
    #[test]
    fn stream_record_out_of_order_and_partial_results_do_not_poison_context() {
        let mut state = LiveContext::default();
        state.begin("");
        let early = state.ticket(0, 0.0, 12.0).unwrap();
        let late = state.ticket(1, 12.0, 24.0).unwrap();
        state.finish(&late, "나중 발언", false);
        state.finish(&early, "처음 발언", false);
        assert!(state
            .ticket(2, 24.0, 36.0)
            .unwrap()
            .text
            .contains("나중 발언"));
        let partial = state.ticket(2, 24.0, 36.0).unwrap();
        state.finish(&partial, "미확정", true);
        assert!(!state.ticket(3, 36.0, 48.0).unwrap().text.contains("미확정"));
    }
}

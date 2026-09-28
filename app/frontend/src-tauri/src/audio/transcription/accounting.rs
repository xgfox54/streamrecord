use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkStatus {
    Succeeded,
    NoSpeech,
    Failed,
    Cancelled,
    Deferred,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct TranscriptionCounts {
    pub total: u64,
    pub pending: u64,
    pub processing: u64,
    pub succeeded: u64,
    pub no_speech: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub deferred: u64,
    pub result_committed: u64,
}

impl TranscriptionCounts {
    pub fn terminal(&self) -> u64 {
        self.succeeded + self.no_speech + self.failed + self.cancelled + self.deferred
    }

    pub fn explained(&self) -> u64 {
        self.terminal() + self.pending + self.processing
    }

    pub fn completion_state(&self) -> &'static str {
        if self.explained() != self.total
            || self.pending > 0
            || self.processing > 0
            || self.deferred > 0
        {
            "incomplete"
        } else if self.failed > 0 || self.cancelled > 0 || self.result_committed < self.succeeded {
            "completed_with_errors"
        } else {
            "complete"
        }
    }
}

#[derive(Debug, Default)]
pub struct TranscriptionAccounting {
    counts: Mutex<TranscriptionCounts>,
}

impl TranscriptionAccounting {
    pub fn queue(&self) {
        let mut counts = self
            .counts
            .lock()
            .expect("transcription accounting poisoned");
        counts.total += 1;
        counts.pending += 1;
    }

    pub fn start(&self) {
        let mut counts = self
            .counts
            .lock()
            .expect("transcription accounting poisoned");
        counts.pending = counts.pending.saturating_sub(1);
        counts.processing += 1;
    }

    pub fn finish(&self, status: ChunkStatus, result_committed: bool) {
        let mut counts = self
            .counts
            .lock()
            .expect("transcription accounting poisoned");
        counts.processing = counts.processing.saturating_sub(1);
        match status {
            ChunkStatus::Succeeded => counts.succeeded += 1,
            ChunkStatus::NoSpeech => counts.no_speech += 1,
            ChunkStatus::Failed => counts.failed += 1,
            ChunkStatus::Cancelled => counts.cancelled += 1,
            ChunkStatus::Deferred => counts.deferred += 1,
        }
        if result_committed {
            counts.result_committed += 1;
        }
    }

    pub fn snapshot(&self) -> TranscriptionCounts {
        self.counts
            .lock()
            .expect("transcription accounting poisoned")
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_and_silent_chunks_complete() {
        let accounting = TranscriptionAccounting::default();
        accounting.queue();
        accounting.start();
        accounting.finish(ChunkStatus::Succeeded, true);
        accounting.queue();
        accounting.start();
        accounting.finish(ChunkStatus::NoSpeech, false);
        let counts = accounting.snapshot();
        assert_eq!(counts.explained(), counts.total);
        assert_eq!(counts.completion_state(), "complete");
    }

    #[test]
    fn inference_and_commit_failures_are_not_successful_completion() {
        let accounting = TranscriptionAccounting::default();
        accounting.queue();
        accounting.start();
        accounting.finish(ChunkStatus::Failed, false);
        accounting.queue();
        accounting.start();
        accounting.finish(ChunkStatus::Succeeded, false);
        assert_eq!(
            accounting.snapshot().completion_state(),
            "completed_with_errors"
        );
    }

    #[test]
    fn deferred_or_unfinished_chunks_are_incomplete() {
        let accounting = TranscriptionAccounting::default();
        accounting.queue();
        accounting.start();
        accounting.finish(ChunkStatus::Deferred, false);
        accounting.queue();
        assert_eq!(accounting.snapshot().completion_state(), "incomplete");
    }
}

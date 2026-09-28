//! Stream-Record live-only bounded segmentation (MIT).
//!
//! Natural silence still closes speech within a window. Uninterrupted speech is
//! flushed at a hard 12-second input boundary. Import/retranscription retain their
//! original VAD policy. This is NOT overlapping or quietest-point segmentation.
//! Resetting a bounded VAD session also bounds its internal retained audio; model
//! reinitialization cost and recognition quality must be measured on real audio.
use super::vad::{ContinuousVadProcessor, SpeechSegment};
use anyhow::{anyhow, bail, Result};

pub const LIVE_WINDOW_SECONDS: usize = 12;

struct WindowClock {
    rate: u32,
    limit: usize,
    start: u64,
    count: usize,
}
impl WindowClock {
    fn new(rate: u32) -> Result<Self> {
        if !(8000..=384000).contains(&rate) {
            bail!("Unsupported live sample rate: {rate}");
        }
        let limit = (rate as usize)
            .checked_mul(LIVE_WINDOW_SECONDS)
            .ok_or_else(|| anyhow!("Live window size overflow"))?;
        Ok(Self {
            rate,
            limit,
            start: 0,
            count: 0,
        })
    }
    fn room(&self) -> usize {
        self.limit - self.count
    }
    fn advance(&mut self, count: usize) -> Result<()> {
        if count > self.room() {
            bail!("Live window overrun");
        }
        self.count += count;
        Ok(())
    }
    fn offset_ms(&self) -> f64 {
        self.start as f64 * 1000.0 / self.rate as f64
    }
    fn duration_ms(&self) -> f64 {
        self.count as f64 * 1000.0 / self.rate as f64
    }
    fn finish(&mut self) -> Result<()> {
        self.start = self
            .start
            .checked_add(self.count as u64)
            .ok_or_else(|| anyhow!("Live clock overflow"))?;
        self.count = 0;
        Ok(())
    }
}

trait WindowBackend: Sized {
    fn create(rate: u32, pause_ms: u32) -> Result<Self>;
    fn process(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>>;
    fn finish(&mut self) -> Result<Vec<SpeechSegment>>;
}
impl WindowBackend for ContinuousVadProcessor {
    fn create(rate: u32, pause_ms: u32) -> Result<Self> {
        Self::new(rate, pause_ms)
    }
    fn process(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        self.process_audio(samples)
    }
    fn finish(&mut self) -> Result<Vec<SpeechSegment>> {
        self.flush()
    }
}

struct WindowedVad<B: WindowBackend> {
    backend: Option<B>,
    clock: WindowClock,
    pause_ms: u32,
    failure: Option<String>,
}
impl<B: WindowBackend> WindowedVad<B> {
    fn new(rate: u32, pause_ms: u32) -> Result<Self> {
        let clock = WindowClock::new(rate)?;
        Ok(Self {
            backend: Some(B::create(rate, pause_ms)?),
            clock,
            pause_ms,
            failure: None,
        })
    }
    fn translate(&self, segments: Vec<SpeechSegment>) -> Result<Vec<SpeechSegment>> {
        let offset = self.clock.offset_ms();
        let end_limit = self.clock.duration_ms();
        segments
            .into_iter()
            .map(|mut segment| {
                if !segment.start_timestamp_ms.is_finite()
                    || !segment.end_timestamp_ms.is_finite()
                    || segment.start_timestamp_ms < 0.0
                    || segment.end_timestamp_ms < segment.start_timestamp_ms
                    || segment.start_timestamp_ms > end_limit + 1.0
                {
                    bail!("Invalid VAD interval in bounded live window");
                }
                // The final VAD frame may be zero padded. Do not expose a timestamp
                // beyond the real source endpoint. Audio sample content is untouched.
                segment.start_timestamp_ms = segment.start_timestamp_ms.min(end_limit) + offset;
                segment.end_timestamp_ms = segment.end_timestamp_ms.min(end_limit) + offset;
                Ok(segment)
            })
            .collect()
    }
    fn close_window(&mut self) -> Result<Vec<SpeechSegment>> {
        if self.clock.count == 0 {
            return Ok(Vec::new());
        }
        let segments = self
            .backend
            .as_mut()
            .ok_or_else(|| anyhow!("Missing live VAD"))?
            .finish()?;
        let segments = self.translate(segments)?;
        self.backend = None;
        self.clock.finish()?;
        Ok(segments)
    }
    fn process_inner(&mut self, mut samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        let mut output = Vec::new();
        while !samples.is_empty() {
            if self.backend.is_none() {
                self.backend = Some(B::create(self.clock.rate, self.pause_ms)?);
            }
            let count = samples.len().min(self.clock.room());
            let segments = self.backend.as_mut().unwrap().process(&samples[..count])?;
            self.clock.advance(count)?;
            output.extend(self.translate(segments)?);
            samples = &samples[count..];
            if self.clock.room() == 0 {
                output.extend(self.close_window()?);
            }
        }
        Ok(output)
    }
    fn process(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        if let Some(error) = &self.failure {
            bail!("Live VAD stopped after error: {error}");
        }
        let result = self.process_inner(samples);
        if let Err(error) = &result {
            self.failure = Some(error.to_string());
        }
        result
    }
    fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        if let Some(error) = &self.failure {
            bail!("Live VAD stopped after error: {error}");
        }
        let result = self.close_window();
        if let Err(error) = &result {
            self.failure = Some(error.to_string());
        }
        result
    }
}

pub struct BoundedLiveVad {
    inner: WindowedVad<ContinuousVadProcessor>,
}
impl BoundedLiveVad {
    pub fn new(rate: u32, pause_ms: u32) -> Result<Self> {
        Ok(Self {
            inner: WindowedVad::new(rate, pause_ms)?,
        })
    }
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        self.inner.process(samples)
    }
    pub fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Deterministic buffering backend: verifies partitioning/clock logic, not ASR.
    struct EchoWindow {
        rate: u32,
        samples: Vec<f32>,
    }
    impl WindowBackend for EchoWindow {
        fn create(rate: u32, _: u32) -> Result<Self> {
            Ok(Self {
                rate,
                samples: Vec::new(),
            })
        }
        fn process(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
            self.samples.extend_from_slice(samples);
            Ok(vec![])
        }
        fn finish(&mut self) -> Result<Vec<SpeechSegment>> {
            let samples = std::mem::take(&mut self.samples);
            if samples.is_empty() {
                return Ok(vec![]);
            }
            Ok(vec![SpeechSegment {
                start_timestamp_ms: 0.0,
                end_timestamp_ms: samples.len() as f64 * 1000.0 / self.rate as f64,
                samples,
                confidence: 1.0,
            }])
        }
    }
    #[test]
    fn stream_record_continuous_speech_emits_before_stop_without_duplicate_samples() {
        let samples: Vec<f32> = (0..(16000 * 29 + 17)).map(|n| (n % 1000) as f32).collect();
        let mut vad = WindowedVad::<EchoWindow>::new(16000, 500).unwrap();
        let mut rows = vec![];
        for chunk in samples.chunks(937) {
            rows.extend(vad.process(chunk).unwrap());
        }
        assert_eq!(rows.len(), 2, "24 seconds emitted before the final stop");
        rows.extend(vad.flush().unwrap());
        assert_eq!(rows.len(), 3);
        assert!(vad.flush().unwrap().is_empty());
        assert_eq!(rows[0].start_timestamp_ms, 0.0);
        assert_eq!(rows[1].start_timestamp_ms, 12000.0);
        assert_eq!(rows[2].start_timestamp_ms, 24000.0);
        let restored: Vec<f32> = rows
            .iter()
            .flat_map(|row| row.samples.iter().copied())
            .collect();
        assert_eq!(samples, restored);
        assert!(rows
            .iter()
            .all(|r| r.end_timestamp_ms - r.start_timestamp_ms <= 12000.0));
    }
    #[test]
    fn stream_record_exact_boundary_flush_is_idempotent_and_next_clock_continues() {
        let mut vad = WindowedVad::<EchoWindow>::new(16000, 500).unwrap();
        assert!(vad.flush().unwrap().is_empty());
        assert_eq!(vad.process(&vec![0.25; 192000]).unwrap().len(), 1);
        assert!(vad.flush().unwrap().is_empty());
        assert!(vad.process(&vec![0.5; 8000]).unwrap().is_empty());
        let tail = vad.flush().unwrap();
        assert_eq!(tail[0].start_timestamp_ms, 12000.0);
        assert_eq!(tail[0].end_timestamp_ms, 12500.0);
        assert_eq!(tail[0].samples.len(), 8000);
    }
    #[test]
    fn stream_record_three_hour_clock_has_no_reset_or_rounding_drift() {
        for rate in [16000, 44100, 48000, 96000] {
            let mut clock = WindowClock::new(rate).unwrap();
            let total = rate as u64 * 3 * 3600 + 17;
            let mut consumed = 0;
            while consumed < total {
                let n = (total - consumed).min(clock.room() as u64).min(7919) as usize;
                clock.advance(n).unwrap();
                consumed += n as u64;
                if clock.room() == 0 {
                    clock.finish().unwrap();
                }
            }
            clock.finish().unwrap();
            assert_eq!(clock.start, total);
            assert!((clock.offset_ms() - total as f64 * 1000.0 / rate as f64).abs() < 0.000001);
        }
    }
    #[test]
    fn stream_record_invalid_rate_and_clock_overrun_are_rejected() {
        assert!(WindowClock::new(0).is_err());
        let mut clock = WindowClock::new(16000).unwrap();
        assert!(clock.advance(clock.limit + 1).is_err());
        assert_eq!(clock.count, 0);
    }
}

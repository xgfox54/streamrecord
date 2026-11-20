use crate::audio::devices::configuration::{get_device_and_config, AudioDevice};
use cpal::traits::{DeviceTrait, StreamTrait};
use std::sync::{atomic::{AtomicBool, AtomicU32, Ordering}, Arc};
use std::time::Duration;

#[derive(Default)]
pub(crate) struct Peak(AtomicU32);

impl Peak {
    fn observe(&self, samples: impl Iterator<Item = f32>) {
        let peak = samples.map(f32::abs).reduce(f32::max);
        if let Some(value) = peak {
            self.0.fetch_max(1 + (value.min(1.0) * 65535.0) as u32, Ordering::Relaxed);
        }
    }

    fn take(&self) -> Option<f32> {
        self.0.swap(0, Ordering::Relaxed).checked_sub(1).map(|n| n as f32 / 65535.0)
    }
}

static RECORDING_PEAK: Peak = Peak(AtomicU32::new(0));

pub(crate) fn observe_recording(samples: &[f32]) {
    RECORDING_PEAK.observe(samples.iter().copied());
}

#[tauri::command]
pub fn ko_recording_peak() -> Option<f32> {
    RECORDING_PEAK.take()
}

#[tauri::command]
pub async fn ko_check_input_level(source: AudioDevice) -> Result<Option<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Option<f32>> {
        let (device, config) = tauri::async_runtime::block_on(get_device_and_config(&source))?;
        anyhow::ensure!(device.name()? == source.name, "선택한 장치를 찾을 수 없습니다.");
        let peak = Arc::new(Peak::default());
        let received = peak.clone();
        let failed = Arc::new(AtomicBool::new(false));
        let stream_error = failed.clone();
        let format = config.sample_format();
        let stream = device.build_input_stream_raw(&config.into(), format, move |data, _| {
            macro_rules! observe {
                ($t:ty) => {
                    if let Some(samples) = data.as_slice::<$t>() {
                        received.observe(samples.iter().map(|&s| cpal::Sample::to_sample::<f32>(s)));
                    }
                };
            }
            match format {
                cpal::SampleFormat::F32 => observe!(f32),
                cpal::SampleFormat::I32 => observe!(i32),
                cpal::SampleFormat::I16 => observe!(i16),
                cpal::SampleFormat::I8 => observe!(i8),
                _ => (),
            }
        }, move |_| { stream_error.store(true, Ordering::Relaxed); }, None)?;
        stream.play()?;
        std::thread::sleep(Duration::from_millis(1200));
        anyhow::ensure!(!failed.load(Ordering::Relaxed), "음량 측정 중에 장치 연결이 끊겼습니다.");
        Ok(peak.take())
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peak_distinguishes_missing_quiet_and_loud_samples() {
        let peak = Peak::default();
        assert_eq!(peak.take(), None);
        peak.observe([0.0].into_iter());
        assert_eq!(peak.take(), Some(0.0));
        peak.observe([-0.75, 0.25].into_iter());
        peak.observe([0.1].into_iter());
        assert!((peak.take().unwrap() - 0.75).abs() < 0.0001);
        assert_eq!(peak.take(), None);
    }
}

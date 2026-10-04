use crate::audio::devices::configuration::{AudioDevice, DeviceType};
use crate::audio::recording_commands::{DISABLED_MICROPHONE_DEVICE, DISABLED_SYSTEM_AUDIO_DEVICE, EXACT_MIC_DEVICE_PREFIX, EXACT_SYSTEM_DEVICE_PREFIX};

pub(super) fn capture_devices(devices: &[AudioDevice], mic: Option<&str>, system: Option<&str>) -> Result<(String, String), String> {
    let (name, kind) = match (mic, system) {
        (Some(name), None) if !name.trim().is_empty() => (name, DeviceType::Input),
        (None, Some(name)) if !name.trim().is_empty() => (name, DeviceType::Output),
        _ => return Err("녹음할 마이크 또는 스피커·헤드폰 한 개를 선택하세요.".into()),
    };
    if !devices.iter().any(|device| device.name == name && device.device_type == kind) {
        return Err("선택한 소리 장치가 없습니다. 목록을 새로고침하고 다시 선택하세요.".into());
    }
    Ok(match kind {
        DeviceType::Input => (format!("{EXACT_MIC_DEVICE_PREFIX}{name} (input)"), DISABLED_SYSTEM_AUDIO_DEVICE.into()),
        DeviceType::Output => (DISABLED_MICROPHONE_DEVICE.into(), format!("{EXACT_SYSTEM_DEVICE_PREFIX}{name} (output)")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn devices() -> Vec<AudioDevice> {
        vec![AudioDevice::new("Mic".into(), DeviceType::Input), AudioDevice::new("Speakers".into(), DeviceType::Output)]
    }
    #[test]
    fn pc_sound_needs_no_stereo_mix_and_never_opens_microphone() {
        let (mic, system) = capture_devices(&devices(), None, Some("Speakers")).unwrap();
        assert_eq!(mic, DISABLED_MICROPHONE_DEVICE);
        assert_eq!(system, format!("{EXACT_SYSTEM_DEVICE_PREFIX}Speakers (output)"));
    }
    #[test]
    fn microphone_never_captures_pc_sound() {
        let (mic, system) = capture_devices(&devices(), Some("Mic"), None).unwrap();
        assert_eq!(mic, format!("{EXACT_MIC_DEVICE_PREFIX}Mic (input)"));
        assert_eq!(system, DISABLED_SYSTEM_AUDIO_DEVICE);
    }
    #[test]
    fn missing_ambiguous_or_wrong_type_sources_fail_without_substitution() {
        for (mic, system) in [(None,None),(Some(""),None),(Some("Mic"),Some("Speakers")),(Some("Speakers"),None),(None,Some("Mic")),(None,Some("Disconnected"))] {
            assert!(capture_devices(&devices(), mic, system).is_err());
        }
    }
}

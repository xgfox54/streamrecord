//! Windows "Stereo Mix" (loopback capture endpoint) discovery and enabling.
//! Enabling goes through the undocumented but long-stable IPolicyConfig COM interface that the
//! Windows Sound control panel itself uses. It needs administrator rights on most systems, so the
//! app relaunches itself with a UAC prompt and a single validated endpoint id (see `run_helper_from_args`).
use serde::Serialize;

pub const HELPER_FLAG: &str = "--enable-stereo-mix";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StereoMixState { Active, Disabled, Unplugged, Unsupported }

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StereoMixStatus { pub state: StereoMixState, pub id: Option<String>, pub name: Option<String> }

/// Driver names for the "what you hear" loopback input. Localised and vendor variants.
pub fn is_stereo_mix_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    let squeezed: String = lower.chars().filter(|c| !c.is_whitespace()).collect();
    squeezed.contains("stereomix") || squeezed.contains("스테레오믹스") || squeezed.contains("whatuhear") || squeezed.contains("waveoutmix")
}

/// Picks the endpoint to use: any active one wins, then disabled, then unplugged. None means the driver exposes no such endpoint.
pub fn choose(entries: &[(String, String, StereoMixState)]) -> StereoMixStatus {
    for wanted in [StereoMixState::Active, StereoMixState::Disabled, StereoMixState::Unplugged] {
        if let Some((id, name, state)) = entries.iter().find(|entry| entry.2 == wanted) {
            return StereoMixStatus { state: *state, id: Some(id.clone()), name: Some(name.clone()) };
        }
    }
    StereoMixStatus { state: StereoMixState::Unsupported, id: None, name: None }
}

/// `--enable-stereo-mix <endpoint-id>` anywhere in the argument list.
pub fn helper_endpoint(args: &[String]) -> Option<String> {
    let position = args.iter().position(|arg| arg == HELPER_FLAG)?;
    args.get(position + 1).filter(|id| !id.is_empty() && id.len() < 200 && id.starts_with("{")).cloned()
}

#[cfg(windows)]
#[allow(non_snake_case)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use windows::core::{interface, IUnknown, IUnknown_Vtbl, BOOL, GUID, HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{eCapture, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATEMASK_ALL, DEVICE_STATE_ACTIVE, DEVICE_STATE_DISABLED, DEVICE_STATE_UNPLUGGED};
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED, STGM_READ};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    // Win7+ layout of the Sound control panel's policy interface. Only SetEndpointVisibility is called.
    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
        fn GetDeviceFormat(&self, device: PCWSTR, default: BOOL, format: *mut *mut c_void) -> HRESULT;
        fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
        fn SetDeviceFormat(&self, device: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
        fn GetProcessingPeriod(&self, device: PCWSTR, default: BOOL, default_period: *mut i64, min_period: *mut i64) -> HRESULT;
        fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
        fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn GetPropertyValue(&self, device: PCWSTR, store: BOOL, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetPropertyValue(&self, device: PCWSTR, store: BOOL, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetDefaultEndpoint(&self, device: PCWSTR, role: i32) -> HRESULT;
        fn SetEndpointVisibility(&self, device: PCWSTR, visible: BOOL) -> HRESULT;
    }
    const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    struct Com;
    impl Com {
        fn start() -> Result<Self, String> {
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|error| format!("Windows 소리 시스템을 시작하지 못했습니다: {error}"))?; }
            Ok(Com)
        }
    }
    impl Drop for Com { fn drop(&mut self) { unsafe { CoUninitialize(); } } }

    fn state_of(state: DEVICE_STATE) -> Option<StereoMixState> {
        match state {
            DEVICE_STATE_ACTIVE => Some(StereoMixState::Active),
            DEVICE_STATE_DISABLED => Some(StereoMixState::Disabled),
            DEVICE_STATE_UNPLUGGED => Some(StereoMixState::Unplugged),
            _ => None,
        }
    }

    fn entries() -> Result<Vec<(String, String, StereoMixState)>, String> {
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| format!("소리 장치 목록을 열지 못했습니다: {error}"))?;
            let collection = enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE(DEVICE_STATEMASK_ALL)).map_err(|error| format!("녹음 장치 목록을 읽지 못했습니다: {error}"))?;
            let mut found = Vec::new();
            for index in 0..collection.GetCount().map_err(|error| error.to_string())? {
                let device = collection.Item(index).map_err(|error| error.to_string())?;
                let Some(state) = device.GetState().ok().and_then(state_of) else { continue };
                let store = device.OpenPropertyStore(STGM_READ).map_err(|error| error.to_string())?;
                let value = store.GetValue(&PKEY_Device_FriendlyName).map_err(|error| error.to_string())?;
                let wide: PWSTR = PropVariantToStringAlloc(&value).map_err(|error| error.to_string())?;
                let name = wide.to_string().unwrap_or_default();
                CoTaskMemFree(Some(wide.0 as *const c_void));
                if !is_stereo_mix_name(&name) { continue; }
                let id_wide = device.GetId().map_err(|error| error.to_string())?;
                let id = id_wide.to_string().unwrap_or_default();
                CoTaskMemFree(Some(id_wide.0 as *const c_void));
                found.push((id, name, state));
            }
            Ok(found)
        }
    }

    pub fn status() -> Result<StereoMixStatus, String> {
        let _com = Com::start()?;
        Ok(choose(&entries()?))
    }

    /// Changes visibility of a Stereo Mix capture endpoint that is currently listed by Windows. Refuses any other id.
    pub fn set_enabled(id: &str, enabled: bool) -> Result<(), String> {
        let _com = Com::start()?;
        if !entries()?.iter().any(|entry| entry.0 == id) { return Err("선택한 장치는 스테레오 믹스가 아닙니다.".into()); }
        let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let policy: IPolicyConfig = CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL).map_err(|error| format!("Windows 소리 설정 기능을 열지 못했습니다: {error}"))?;
            policy.SetEndpointVisibility(PCWSTR(wide.as_ptr()), BOOL::from(enabled)).ok().map_err(|error| error.to_string())
        }
    }

    pub fn set_enabled_error_is_access_denied(message: &str) -> bool {
        message.contains("0x80070005") || message.contains("액세스가 거부") || message.to_lowercase().contains("access is denied")
    }

    /// Relaunches this executable elevated (UAC prompt) to enable one endpoint, then waits for the outcome.
    pub fn enable_elevated(id: &str) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        let exe_wide: Vec<u16> = exe.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
        let parameters: Vec<u16> = format!("{HELPER_FLAG} {id}").encode_utf16().chain(std::iter::once(0)).collect();
        let verb: Vec<u16> = "runas".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let mut info = SHELLEXECUTEINFOW { cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32, fMask: SEE_MASK_NOCLOSEPROCESS, lpVerb: PCWSTR(verb.as_ptr()), lpFile: PCWSTR(exe_wide.as_ptr()), lpParameters: PCWSTR(parameters.as_ptr()), nShow: SW_HIDE.0, ..Default::default() };
            if let Err(error) = ShellExecuteExW(&mut info) {
                return Err(if error.code().0 as u32 == 0x800704C7 { "관리자 권한 확인이 취소되어 스테레오 믹스를 켜지 못했습니다.".into() } else { format!("관리자 권한으로 설정 창을 열지 못했습니다: {error}") });
            }
            let process: HANDLE = info.hProcess;
            if process.is_invalid() { return Err("관리자 권한 작업을 시작하지 못했습니다.".into()); }
            let waited = WaitForSingleObject(process, 60_000);
            let mut code = 1u32;
            let got = GetExitCodeProcess(process, &mut code).is_ok();
            let _ = CloseHandle(process);
            if waited != WAIT_OBJECT_0 { return Err("관리자 권한 작업이 60초 안에 끝나지 않았습니다.".into()); }
            if !got || code != 0 { return Err("관리자 권한으로 스테레오 믹스를 켜지 못했습니다.".into()); }
        }
        Ok(())
    }

    pub fn enable(id: &str) -> Result<StereoMixStatus, String> {
        match set_enabled(id, true) {
            Ok(()) => {}
            Err(first) => {
                if !set_enabled_error_is_access_denied(&first) { return Err(first); }
                enable_elevated(id)?;
            }
        }
        let after = status()?;
        if after.state != StereoMixState::Active {
            return Err("Windows가 스테레오 믹스를 사용으로 바꾸지 않았습니다. 소리 설정 → 녹음에서 직접 확인해 주세요.".into());
        }
        Ok(after)
    }
}

#[cfg(windows)]
pub use platform::{enable, set_enabled, status};

#[cfg(not(windows))]
pub fn status() -> Result<StereoMixStatus, String> { Ok(StereoMixStatus { state: StereoMixState::Unsupported, id: None, name: None }) }
#[cfg(not(windows))]
pub fn enable(_id: &str) -> Result<StereoMixStatus, String> { Err("Windows에서만 사용할 수 있습니다.".into()) }
#[cfg(not(windows))]
pub fn set_enabled(_id: &str, _enabled: bool) -> Result<(), String> { Err("Windows에서만 사용할 수 있습니다.".into()) }

/// Entry point for the elevated helper process. Returns an exit code when the helper flag is present.
pub fn run_helper_from_args(args: &[String]) -> Option<i32> {
    let id = helper_endpoint(args)?;
    Some(match set_enabled(&id, true) { Ok(()) => 0, Err(_) => 3 })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(name: &str, state: StereoMixState) -> (String, String, StereoMixState) { (format!("{{id-{name}}}"), name.into(), state) }
    #[test]
    fn recognises_localised_and_vendor_names() {
        for name in ["스테레오 믹스(Realtek(R) Audio)", "Stereo Mix (Realtek High Definition Audio)", "StereoMix", "What U Hear (Sound Blaster)", "Wave Out Mix"] { assert!(is_stereo_mix_name(name), "{name}"); }
        for name in ["마이크(Realtek(R) Audio)", "Line In", "Microphone", "Subwoofer"] { assert!(!is_stereo_mix_name(name), "{name}"); }
    }
    #[test]
    fn prefers_active_then_disabled_and_reports_unsupported_when_absent() {
        assert_eq!(choose(&[]).state, StereoMixState::Unsupported);
        assert_eq!(choose(&[entry("b", StereoMixState::Unplugged), entry("a", StereoMixState::Disabled)]).state, StereoMixState::Disabled);
        let picked = choose(&[entry("a", StereoMixState::Disabled), entry("b", StereoMixState::Active)]);
        assert_eq!((picked.state, picked.name.as_deref()), (StereoMixState::Active, Some("b")));
    }
    #[test]
    fn helper_accepts_only_one_braced_endpoint_id() {
        let args = |values: &[&str]| values.iter().map(|value| value.to_string()).collect::<Vec<_>>();
        assert_eq!(helper_endpoint(&args(&["app", HELPER_FLAG, "{0.0.1.00000000}.{abc}"])).as_deref(), Some("{0.0.1.00000000}.{abc}"));
        assert_eq!(helper_endpoint(&args(&["app", HELPER_FLAG])), None);
        assert_eq!(helper_endpoint(&args(&["app", HELPER_FLAG, "C:\\evil.exe"])), None);
        assert_eq!(helper_endpoint(&args(&["app"])), None);
    }
}

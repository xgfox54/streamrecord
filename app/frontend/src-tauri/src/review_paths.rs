//! Review-only filesystem isolation. Production delegates to the existing APIs (MIT).
use std::{io, path::{Component, Path, PathBuf}};
pub mod fs;
pub mod async_fs;
#[cfg(feature = "review-isolation")]
pub mod guarded_store;
#[cfg(feature = "review-isolation")]
pub mod native_dialog;
#[cfg(feature = "review-isolation")]
pub mod capture;

pub const IDENTIFIER: &str = "local.meetily.korean.workspace.v063.live.review";
const PARENT: &str = "D:/Codex/Projects/2026-10-02/task/StreamRecord-validation/profiles";
#[derive(Clone)]
pub struct Policy { pub root: PathBuf, pub resources: PathBuf }
fn denied(message: impl Into<String>) -> io::Error { io::Error::new(io::ErrorKind::PermissionDenied, message.into()) }
fn plain(path: &Path) -> io::Result<()> {
    let text = path.to_string_lossy();
    if text.split(['\\','/']).any(|p| p == "." || p == ".." || p.ends_with(' ') || p.ends_with('.') || ["CON","PRN","AUX","NUL","COM1","LPT1"].contains(&p.split('.').next().unwrap_or("").to_ascii_uppercase().as_str())) { return Err(denied("Ambiguous Windows path component")); }
    if !path.is_absolute() || text.starts_with(r"\\") || text.contains('/') && text.starts_with("//") {
        return Err(denied("Review paths must be absolute local paths"));
    }
    if text.chars().filter(|c| *c == ':').count() > 1 || path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err(denied("Review path traversal/device/stream syntax is forbidden"));
    }
    let mut part = PathBuf::new();
    for component in path.components() {
        part.push(component);
        match std::fs::symlink_metadata(&part) {
            Ok(meta) => {
                #[cfg(windows)] {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 { return Err(denied("Review path contains a reparse point")); }
                }
                if meta.file_type().is_symlink() { return Err(denied("Review path contains a symbolic link")); }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(e) => return Err(e),
        }
    }
    Ok(())
}
impl Policy {
    pub fn check(&self, path: &Path, write: bool) -> io::Result<()> {
        let native = path.to_string_lossy();
        let cleaned = native.strip_prefix(r"\\?\").filter(|p| p.as_bytes().get(1) == Some(&b':')).map(PathBuf::from);
        let path = cleaned.as_deref().unwrap_or(path);
        plain(path)?;
        let under_root = path.starts_with(&self.root);
        let under_resources = path.starts_with(&self.resources);
        if !under_root && (write || !under_resources) { return Err(denied("Review path escapes the data/resource roots")); }
        if write && path == self.root { return Err(denied("Review data root itself cannot be modified")); }
        Ok(())
    }
}
fn parse_root(root: Option<PathBuf>, nonce: Option<String>, parent: &Path) -> io::Result<PathBuf> {
    let root = root.ok_or_else(|| denied("STREAM_RECORD_REVIEW_ROOT is required"))?;
    let nonce = nonce.ok_or_else(|| denied("STREAM_RECORD_REVIEW_NONCE is required"))?;
    if nonce.len() != 32 || !nonce.bytes().all(|c| c.is_ascii_hexdigit()) { return Err(denied("Invalid review nonce")); }
    plain(parent)?; plain(&root)?;
    if root.parent() != Some(parent) || root.file_name().and_then(|n| n.to_str()) != Some(format!("v063-{nonce}").as_str()) {
        return Err(denied("Review root must be a new nonce directory directly under the approved profiles parent"));
    }
    Ok(root)
}
#[cfg(feature = "review-isolation")]
static CONTEXT: std::sync::OnceLock<Result<Policy, String>> = std::sync::OnceLock::new();
#[cfg(feature = "review-isolation")]
fn context() -> io::Result<&'static Policy> {
    CONTEXT.get_or_init(|| {
        let parent = PathBuf::from(PARENT);
        let nonce = std::env::var("STREAM_RECORD_REVIEW_NONCE").ok();
        let root = parse_root(std::env::var_os("STREAM_RECORD_REVIEW_ROOT").map(PathBuf::from), nonce.clone(), &parent).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut resources = exe.parent().ok_or("Missing executable directory")?.to_path_buf();
        #[cfg(test)] if resources.file_name().and_then(|p| p.to_str()) == Some("deps") { resources.pop(); }
        plain(&resources).map_err(|e| e.to_string())?;
        if !resources.starts_with(parent.parent().ok_or("Missing review evidence directory")?) || resources.starts_with(&root) {
            return Err("Executable resource directory is outside the approved review evidence directory".into());
        }
        if !root.exists() { std::fs::create_dir(&root).map_err(|e| e.to_string())?; }
        let marker = root.join("review-root.json");
        let contents = serde_json::to_vec(&serde_json::json!({"version":"0.6.3","identifier":IDENTIFIER,"nonce":nonce})).map_err(|e| e.to_string())?;
        plain(&marker).map_err(|e| e.to_string())?;
        if marker.exists() {
            if std::fs::read(&marker).map_err(|e| e.to_string())? != contents { return Err("Review marker mismatch".into()); }
        } else {
            if std::fs::read_dir(&root).map_err(|e| e.to_string())?.next().is_some() { return Err("Refusing to adopt a nonempty unmarked profile".into()); }
            use std::io::Write;
            std::fs::OpenOptions::new().write(true).create_new(true).open(&marker).and_then(|mut f| f.write_all(&contents)).map_err(|e| e.to_string())?;
        }
        let policy = Policy { root, resources };
        for dir in ["AppData/Roaming", "AppData/Local", "Temp", "Documents", "Music", "Videos", "Models", "Logs", "Work", "WebView2", "Fixtures"] {
            let path = policy.root.join(dir);
            policy.check(&path, true).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
        }
        // Process-local only, before starting Tauri/runtime or constructing stores.
        std::env::set_var("USERPROFILE", &policy.root);
        for (key, suffix) in [("APPDATA","AppData/Roaming"),("LOCALAPPDATA","AppData/Local"),("TEMP","Temp"),("TMP","Temp"),("TMPDIR","Temp"),("WEBVIEW2_USER_DATA_FOLDER","WebView2")] {
            std::env::set_var(key, policy.root.join(suffix));
        }
        std::env::set_var("MEETILY_LLAMA_HELPER", policy.resources.join("llama-helper.exe"));
        std::env::set_current_dir(policy.root.join("Work")).map_err(|e| e.to_string())?;
        // Application media/document sinks use the explicit review wrappers; Windows known folders may stay outside the profile.
        // Keep checking native data/cache APIs used by Tauri and its plugins.
        for path in [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir(), dirs_tauri::data_dir(), dirs_tauri::data_local_dir(), dirs_tauri::cache_dir(), dirs_tauri::config_dir(), Some(policy.root.join("Music")), Some(policy.root.join("Documents")), Some(std::env::temp_dir())] {
            policy.check(&path.ok_or("Required storage directory API returned no path")?, true).map_err(|e| e.to_string())?;
        }
        Ok(policy)
    }).as_ref().map_err(|e| denied(e.clone()))
}
pub fn initialize() -> io::Result<()> {
    #[cfg(feature = "review-isolation")] { context()?; }
    Ok(())
}
pub fn guard_write(path: impl AsRef<Path>) -> io::Result<()> {
    #[cfg(feature = "review-isolation")] { context()?.check(path.as_ref(), true)?; }
    #[cfg(not(feature = "review-isolation"))] let _ = path;
    Ok(())
}
pub fn guard_read(path: impl AsRef<Path>) -> io::Result<()> {
    #[cfg(feature = "review-isolation")] { context()?.check(path.as_ref(), false)?; }
    #[cfg(not(feature = "review-isolation"))] let _ = path;
    Ok(())
}
macro_rules! directory {
    ($name:ident,$suffix:literal) => { pub fn $name() -> Option<PathBuf> {
        #[cfg(feature = "review-isolation")] { return context().ok().map(|c| c.root.join($suffix)); }
        #[cfg(not(feature = "review-isolation"))] { dirs::$name() }
    }};
}
directory!(home_dir, ""); directory!(data_dir, "AppData/Roaming"); directory!(data_local_dir, "AppData/Local");
directory!(config_dir, "AppData/Roaming"); directory!(audio_dir, "Music"); directory!(document_dir, "Documents"); directory!(video_dir, "Videos");
pub fn model_directory(provided: Option<PathBuf>, kind: &str) -> io::Result<Option<PathBuf>> {
    #[cfg(feature = "review-isolation")] {
        let path = provided.unwrap_or(context()?.root.join("Models").join(kind));
        guard_write(&path)?; return Ok(Some(path));
    }
    #[cfg(not(feature = "review-isolation"))] { let _ = kind; Ok(provided) }
}
#[cfg(feature = "review-isolation")]
pub fn bundled_binary(name:&str) -> io::Result<PathBuf> { let path=context()?.resources.join(name); guard_read(&path)?; if !path.is_file() { return Err(denied("Required bundled review binary is missing")); } Ok(path) }
#[cfg(feature = "review-isolation")]
pub fn store_path(path: &str) -> io::Result<PathBuf> {
    if path.is_empty() { return Err(denied("Missing store path")); }
    let candidate = Path::new(path);
    let resolved = if candidate.is_absolute() { candidate.to_path_buf() } else {
        if candidate.components().any(|c| !matches!(c, Component::Normal(_))) || path.contains(':') { return Err(denied("Invalid store path")); }
        context()?.root.join("AppData/Roaming").join(IDENTIFIER).join(candidate)
    };
    guard_write(&resolved)?; Ok(resolved)
}
#[cfg(feature = "review-isolation")]
pub fn check_payload(value: &serde_json::Value) -> io::Result<()> {
    match value {
        serde_json::Value::Object(map) => for (key,value) in map {
            let key = key.to_ascii_lowercase();
            if key.contains("path") || key.contains("folder") || key.contains("directory") {
                if !value.is_null() { let path = value.as_str().ok_or_else(|| denied("Invalid review path payload"))?; if !path.is_empty() { guard_read(path)?; } }
            }
            check_payload(value)?;
        },
        serde_json::Value::Array(values) => for value in values { check_payload(value)?; },
        _ => (),
    }
    Ok(())
}
#[cfg(feature = "review-isolation")]
pub fn verify_identity() -> io::Result<()> {
    let app_context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    if app_context.config().identifier != IDENTIFIER || app_context.config().product_name.as_deref() != Some("stream-record-v063-live-review") { return Err(denied("Review-only Tauri identifier/product name is required")); }
    Ok(())
}
#[cfg(feature = "review-isolation")]
pub fn preflight() -> io::Result<serde_json::Value> {
    verify_identity()?;
    let c = context()?;
    let mut sinks = Vec::new();
    for dir in ["AppData/Roaming", "AppData/Local", "Temp", "Documents", "Music", "Models", "Logs", "WebView2", "Fixtures"] {
        let path = c.root.join(dir).join("review-write-probe.tmp");
        fs::write(&path, b"synthetic isolated probe")?; fs::remove_file(&path)?;
        sinks.push(c.root.join(dir));
    }
    Ok(serde_json::json!({"version":"0.6.3","identifier":IDENTIFIER,"reviewIsolation":true,"root":c.root,"resourcesReadOnly":c.resources,"appHome":home_dir(),"osHome":dirs_tauri::home_dir(),"appData":dirs_tauri::data_dir().map(|p|p.join(IDENTIFIER)),"localData":dirs_tauri::data_local_dir(),"temp":std::env::temp_dir(),"checkedWriteSinks":sinks,"passed":true,"guiStarted":false}))
}
#[cfg(all(test, feature = "review-isolation"))]
mod tests;

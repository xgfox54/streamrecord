//! Initialize native pickers without exposing unrestricted dialog IPC (MIT).
use tauri::{ipc::Invoke, plugin::Plugin, AppHandle, Runtime};

pub struct NativeDialog<P>(pub P);

impl<R: Runtime, P: Plugin<R>> Plugin<R> for NativeDialog<P> {
    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        invoke.resolver.reject("Direct dialog IPC is disabled in review mode; use the guarded audio picker");
        true
    }
}

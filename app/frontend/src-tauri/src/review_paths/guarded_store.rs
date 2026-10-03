//! Guard the plugin-store entry points in review builds without patching the dependency (MIT).
use tauri::{plugin::Plugin, ipc::{Invoke,InvokeBody}, AppHandle,Runtime,RunEvent,Webview,Window,webview::PageLoadPayload};
pub struct GuardedStore<P>(pub P);
impl<R:Runtime,P:Plugin<R>> Plugin<R> for GuardedStore<P> {
    fn name(&self)->&'static str { self.0.name() }
    fn initialize(&mut self,app:&AppHandle<R>,config:serde_json::Value)->Result<(),Box<dyn std::error::Error>> {
        use tauri::Manager;
        super::guard_write(app.path().app_data_dir()?)?;
        self.0.initialize(app,config)
    }
    fn initialization_script(&self)->Option<String> { self.0.initialization_script() }
    fn window_created(&mut self,window:Window<R>) { self.0.window_created(window); }
    fn webview_created(&mut self,webview:Webview<R>) { self.0.webview_created(webview); }
    fn on_navigation(&mut self,webview:&Webview<R>,url:&url::Url)->bool { self.0.on_navigation(webview,url) }
    fn on_page_load(&mut self,webview:&Webview<R>,payload:&PageLoadPayload<'_>) { self.0.on_page_load(webview,payload); }
    fn on_event(&mut self,app:&AppHandle<R>,event:&RunEvent) { self.0.on_event(app,event); }
    fn extend_api(&mut self,invoke:Invoke<R>)->bool {
        let result = match invoke.message.payload() {
            InvokeBody::Json(value) if (["load","get_store"].contains(&invoke.message.command().rsplit('|').next().unwrap_or("")) || value.get("path").is_some()) => {
                value.get("path").and_then(|p|p.as_str()).ok_or_else(||std::io::Error::new(std::io::ErrorKind::PermissionDenied,"Missing review store path")).and_then(super::store_path).map(|_|())
            },
            InvokeBody::Json(value) => super::check_payload(value),
            _ => Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied,"Raw store IPC is disabled in review mode")),
        };
        if let Err(error)=result { invoke.resolver.reject(error.to_string()); return true; }
        self.0.extend_api(invoke)
    }
}

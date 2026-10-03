#![cfg_attr(
    all(any(not(debug_assertions), feature = "review-isolation"), target_os = "windows"),
    windows_subsystem = "windows"
)]

use env_logger;
use log;

fn main() {
    #[cfg(feature = "review-isolation")]
    {
        if let Err(error) = app_lib::review_paths::initialize().and_then(|_| app_lib::review_paths::verify_identity()) { eprintln!("Review isolation failed: {error}"); std::process::exit(78); }
        if std::env::args().any(|arg| arg == "--review-preflight") {
            match app_lib::review_paths::preflight() { Ok(result) => println!("{}",result), Err(error) => { eprintln!("{error}"); std::process::exit(78); } }
            return;
        }
    }

    std::env::set_var("RUST_LOG", "info");
    env_logger::init();

    // Async logger will be initialized lazily when first needed (after Tauri runtime starts)
    log::info!("Starting application...");
    app_lib::run();
}

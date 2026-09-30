use log::info;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

use super::manager::DatabaseManager;
use super::repositories::setting::SettingsRepository;
use crate::state::AppState;

pub(crate) async fn initialize_fresh_install_defaults(
    pool: &SqlitePool,
) -> Result<(), sqlx::Error> {
    if SettingsRepository::get_transcript_config(pool)
        .await?
        .is_none()
    {
        SettingsRepository::save_transcript_config(
            pool,
            "localWhisper",
            crate::bundled_whisper::DEFAULT_MODEL,
        )
        .await?;
    }

    Ok(())
}

/// Initialize database on app startup
/// Handles first launch detection and conditional initialization
pub async fn initialize_database_on_startup(app: &AppHandle) -> Result<(), String> {
    // Check if this is the first launch (no database exists yet)
    let is_first_launch = DatabaseManager::is_first_launch(app)
        .await
        .map_err(|e| format!("Failed to check first launch status: {}", e))?;

    let db_manager = DatabaseManager::new_from_app_handle(app)
        .await
        .map_err(|e| format!("Failed to initialize database manager: {}", e))?;

    if is_first_launch {
        initialize_fresh_install_defaults(db_manager.pool())
            .await
            .map_err(|e| format!("Failed to initialize fresh install defaults: {}", e))?;

        info!("First launch detected - will notify window when ready");

        // Delay event emission to ensure window is ready and React listeners are registered
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            app_handle
                .emit("first-launch-detected", ())
                .expect("Failed to emit first-launch-detected event");
            info!("Emitted first-launch-detected after delay");
        });
    }

    app.manage(AppState { db_manager });
    info!("Database initialized successfully");

    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::initialize_fresh_install_defaults;
    use crate::database::repositories::setting::SettingsRepository;

    #[tokio::test]
    async fn stream_record_fresh_install_uses_bundled_korean_whisper_without_a_summary_model() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        initialize_fresh_install_defaults(&pool).await.unwrap();

        let transcript = SettingsRepository::get_transcript_config(&pool)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(transcript.provider, "localWhisper");
        assert_eq!(transcript.model, crate::bundled_whisper::DEFAULT_MODEL);
        assert!(SettingsRepository::get_model_config(&pool)
            .await
            .unwrap()
            .is_none());
    }
}

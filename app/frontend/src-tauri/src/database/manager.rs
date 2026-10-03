use sqlx::{migrate::MigrateDatabase, Result, Sqlite, SqlitePool, Transaction};
use crate::review_paths::fs;
use std::path::Path;
use tauri::Manager;

#[derive(Clone)]
pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    pub async fn new(tauri_db_path: &str, backend_db_path: &str) -> Result<Self> {
        crate::review_paths::guard_write(tauri_db_path).map_err(sqlx::Error::Io)?;
        crate::review_paths::guard_read(backend_db_path).map_err(sqlx::Error::Io)?;
        if let Some(parent_dir) = Path::new(tauri_db_path).parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).map_err(|e| sqlx::Error::Io(e))?;
            }
        }

        if !Path::new(tauri_db_path).exists() {
            if Path::new(backend_db_path).exists() {
                log::info!(
                    "Copying database from {} to {}",
                    backend_db_path,
                    tauri_db_path
                );
                fs::copy(backend_db_path, tauri_db_path).map_err(|e| sqlx::Error::Io(e))?;
            } else {
                log::info!("Creating database at {}", tauri_db_path);
                Sqlite::create_database(tauri_db_path).await?;
            }
        }

        let pool = SqlitePool::connect(tauri_db_path).await?;

        sqlx::migrate!("./migrations").run(&pool).await?;

        Ok(DatabaseManager { pool })
    }

    // NOTE: So for the first time users they needs to start the application
    // after they can just delete the existing .sqlite file and then copy the existing .db file to
    // the current app dir, So the system detects legacy db and copy it and starts with that data
    // (Newly created .sqlite with the copied content from .db)
    pub async fn new_from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self> {
        // Resolve the app's data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Define database paths
        let tauri_db_path = app_data_dir
            .join("meeting_minutes.sqlite")
            .to_string_lossy()
            .to_string();
        // Legacy backend DB path (for auto-migration if exists)
        let backend_db_path = app_data_dir
            .join("meeting_minutes.db")
            .to_string_lossy()
            .to_string();

        // WAL file paths for defensive cleanup
        let wal_path = app_data_dir.join("meeting_minutes.sqlite-wal");
        let shm_path = app_data_dir.join("meeting_minutes.sqlite-shm");

        log::info!("Tauri DB path: {}", tauri_db_path);
        log::info!("Legacy backend DB path: {}", backend_db_path);

        // Try to open database with defensive WAL handling
        match Self::new(&tauri_db_path, &backend_db_path).await {
            Ok(db_manager) => {
                log::info!("Database opened successfully");
                Ok(db_manager)
            }
            Err(e) => {
                // Check if error is due to corrupted WAL file
                let error_msg = e.to_string();
                if error_msg.contains("malformed") || error_msg.contains("corrupt") {
                    log::warn!("Database appears corrupted, likely due to orphaned WAL file. Attempting recovery...");
                    log::warn!("Error details: {}", error_msg);

                    // Delete potentially corrupted WAL/SHM files
                    if wal_path.exists() {
                        match fs::remove_file(&wal_path) {
                            Ok(_) => log::info!("Removed orphaned WAL file: {:?}", wal_path),
                            Err(e) => log::warn!("Failed to remove WAL file: {}", e),
                        }
                    }
                    if shm_path.exists() {
                        match fs::remove_file(&shm_path) {
                            Ok(_) => log::info!("Removed orphaned SHM file: {:?}", shm_path),
                            Err(e) => log::warn!("Failed to remove SHM file: {}", e),
                        }
                    }

                    // Retry connection without WAL files
                    log::info!("Retrying database connection after WAL cleanup...");
                    match Self::new(&tauri_db_path, &backend_db_path).await {
                        Ok(db_manager) => {
                            log::info!("Database opened successfully after WAL recovery");
                            Ok(db_manager)
                        }
                        Err(retry_err) => {
                            log::error!(
                                "Database connection failed even after WAL cleanup: {}",
                                retry_err
                            );
                            Err(retry_err)
                        }
                    }
                } else {
                    // Not a WAL-related error, propagate original error
                    log::error!("Database connection failed: {}", error_msg);
                    Err(e)
                }
            }
        }
    }

    /// Check if this is the first launch (sqlite database doesn't exist yet)
    pub async fn is_first_launch(app_handle: &tauri::AppHandle) -> Result<bool> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");

        let tauri_db_path = app_data_dir.join("meeting_minutes.sqlite");

        Ok(!tauri_db_path.exists())
    }

    /// Import a legacy database from the specified path and initialize
    pub async fn import_legacy_database(
        app_handle: &tauri::AppHandle,
        legacy_db_path: &str,
    ) -> Result<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");

        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Copy legacy database to app data directory as meeting_minutes.db
        let target_legacy_path = app_data_dir.join("meeting_minutes.db");
        log::info!(
            "Copying legacy database from {} to {}",
            legacy_db_path,
            target_legacy_path.display()
        );

        fs::copy(legacy_db_path, &target_legacy_path).map_err(|e| sqlx::Error::Io(e))?;

        // Now use the standard initialization which will detect and migrate the legacy db
        Self::new_from_app_handle(app_handle).await
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn with_transaction<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Transaction<'_, Sqlite>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut tx = self.pool.begin().await?;
        let result = f(&mut tx).await;

        match result {
            Ok(val) => {
                tx.commit().await?;
                Ok(val)
            }
            Err(err) => {
                tx.rollback().await?;
                Err(err)
            }
        }
    }

    /// Cleanup database connection and checkpoint WAL
    /// This should be called on application shutdown to ensure:
    /// - All WAL changes are written to the main database file
    /// - The .wal and .shm files are deleted
    /// - Connection pool is gracefully closed
    pub async fn cleanup(&self) -> Result<()> {
        log::info!("Starting database cleanup...");

        // Force checkpoint of WAL to main database file and remove WAL file
        // TRUNCATE mode: checkpoints all pages AND deletes the WAL file
        match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
        {
            Ok(_) => log::info!("WAL checkpoint completed successfully"),
            Err(e) => log::warn!("WAL checkpoint failed (non-fatal): {}", e),
        }

        // Close the connection pool gracefully
        self.pool.close().await;
        log::info!("Database connection pool closed");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::database::models::Transcript;
    use sha2::{Digest, Sha256};
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn stream_record_historical_migration_bytes_remain_compatible_with_v0_4_1() {
        let migrations: &[(&[u8], &str)] = &[
            (
                include_bytes!("../../migrations/20250916100000_initial_schema.sql"),
                "e7a9a6c41dd6e91a50efd6c9c609b3f90b5dec99b0266040b4ffe89bccded8ad",
            ),
            (
                include_bytes!("../../migrations/20250920155811_add_openrouter_api_key.sql"),
                "76b7233e0e477def7e6993754ff59a24270cddd923f8f80c02d7fc0e9a5df9e0",
            ),
            (
                include_bytes!("../../migrations/20251006000000_add_audio_sync_fields.sql"),
                "bed470d284ebe769e289e53f63ee3ae4981ad5fb302309fe33f8e17c8f227013",
            ),
            (
                include_bytes!("../../migrations/20251010153942_add_ollama_endpoint.sql"),
                "91e252a8ae300445dc0935b464a560f01f364c7c4a19a6f501b8e9d8da81f0b1",
            ),
            (
                include_bytes!("../../migrations/20251101000000_add_summary_backup.sql"),
                "0361667ea3d98badac193b97cad4c5c39d3a52216660a3403398d6f05ca0ed87",
            ),
            (
                include_bytes!("../../migrations/20251105120000_add_pro_license_custom_openai.sql"),
                "cd02c628e50374ea0444b1061865760bf26f90b5d926a5a3128fb4dd73c809d1",
            ),
            (
                include_bytes!("../../migrations/20251110000000_add_grace_period_to_licensing.sql"),
                "95bae564e1e6e5bb771289b3c77b44bc61a2c82f52ee8dfc5f71534d3ba2d6d2",
            ),
            (
                include_bytes!("../../migrations/20251110000001_add_speaker_field.sql"),
                "1866113020bb245347ab2771f3a2d330763f0f57e4ecc2f214e713871f40493a",
            ),
            (
                include_bytes!("../../migrations/20251223000000_add_meeting_notes.sql"),
                "2a14f1ad0116a85c48e6aaa01767fb0901535063f94734ebc3a436c66d093ed1",
            ),
            (
                include_bytes!("../../migrations/20251229000000_add_gemini_api_key.sql"),
                "39042addbdde1b3cc6214785514d408cb04fd5b99288138f5776742801fd4ac7",
            ),
        ];

        for (bytes, expected) in migrations {
            assert_eq!(format!("{:x}", Sha256::digest(bytes)), *expected);
        }
    }

    #[tokio::test]
    async fn migrations_preserve_legacy_transcripts_and_add_versioned_runs() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at) VALUES ('meeting-1', 'legacy', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp) VALUES ('transcript-1', 'meeting-1', 'kept', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let transcript =
            sqlx::query_as::<_, Transcript>("SELECT * FROM transcripts WHERE id = 'transcript-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(transcript.transcript, "kept");
        assert_eq!(transcript.raw_engine_output, None);
        assert_eq!(
            transcript.raw_engine_output_status,
            "raw_unavailable_legacy"
        );
        assert_eq!(transcript.score_kind, "unavailable");
        assert_eq!(transcript.score_engine, "legacy");
        assert_eq!(transcript.spans_json, "[]");

        let run_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('transcription_runs', 'transcription_run_segments')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(run_tables, 2);
    }
}

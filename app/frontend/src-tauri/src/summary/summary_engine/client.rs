// High-level client API for built-in AI summary generation
// Provides simple interface for generating text using the sidecar

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::models;
use super::sidecar::SidecarManager;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    Generate {
        prompt: String,
        max_tokens: Option<i32>,
        context_size: Option<u32>,
        model_path: Option<String>,
        // Sampling parameters
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        presence_penalty: Option<f32>,
        frequency_penalty: Option<f32>,
        repeat_penalty: Option<f32>,
        penalty_last_n: Option<i32>,
        stop_tokens: Option<Vec<String>>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Response {
    Response { text: String, error: Option<String> },
    Error { message: String },
}

// ============================================================================
// Global Sidecar Manager
// ============================================================================

lazy_static::lazy_static! {
    static ref SIDECAR_MANAGER: Arc<Mutex<Option<Arc<SidecarManager>>>> = Arc::new(Mutex::new(None));
}

// Model path cache to avoid repeated filesystem I/O and model lookups
static MODEL_PATH_CACHE: Lazy<RwLock<HashMap<String, PathBuf>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Initialize the global sidecar manager
pub async fn init_sidecar_manager(app_data_dir: PathBuf) -> Result<()> {
    let manager = SidecarManager::new(app_data_dir)?;
    let mut global_manager = SIDECAR_MANAGER.lock().await;
    *global_manager = Some(Arc::new(manager));
    Ok(())
}

/// Get the global sidecar manager
async fn get_sidecar_manager() -> Result<Arc<SidecarManager>> {
    let global_manager = SIDECAR_MANAGER.lock().await;
    global_manager
        .clone()
        .ok_or_else(|| anyhow!("Sidecar manager not initialized. Call init_sidecar_manager first."))
}

/// Get cached model path with read-through caching to avoid repeated filesystem I/O
fn get_cached_model_path(app_data_dir: &PathBuf, model_name: &str) -> Result<PathBuf> {
    // Try read lock first (fast path for cache hits)
    {
        let cache = MODEL_PATH_CACHE
            .read()
            .map_err(|_| anyhow!("Model path cache unavailable"))?;
        if let Some(path) = cache.get(model_name) {
            // Verify file still exists before returning cached path
            if path.exists() {
                return Ok(path.clone());
            }
        }
    }

    // Cache miss or file deleted - acquire write lock and update cache
    let mut cache = MODEL_PATH_CACHE
        .write()
        .map_err(|_| anyhow!("Model path cache unavailable"))?;

    // Double-check after acquiring write lock (another thread may have updated it)
    if let Some(path) = cache.get(model_name) {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // Resolve model path (involves model lookup + filesystem operations)
    let model_path = models::get_model_path(app_data_dir, model_name)?;

    if !model_path.exists() {
        return Err(anyhow!(
            "Model file not found: {}. Please download the model '{}' first.",
            model_path.display(),
            model_name
        ));
    }

    // Cache the validated path
    cache.insert(model_name.to_string(), model_path.clone());
    Ok(model_path)
}

// ============================================================================
// Public API
// ============================================================================

/// Generate text using built-in AI
///
/// # Arguments
/// * `app_data_dir` - Application data directory (for model resolution)
/// * `model_name` - Model name (e.g., "gemma3:1b")
/// * `system_prompt` - System instructions for the model
/// * `user_prompt` - User message/task
/// * `cancellation_token` - Optional token for cancellation
///
/// # Returns
/// Generated text
pub async fn generate_with_builtin(
    app_data_dir: &PathBuf,
    model_name: &str,
    system_prompt: &str,
    user_prompt: &str,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String> {
    generate_bounded(
        app_data_dir,
        &BuiltinGeneration {
            model_name,
            system_prompt,
            user_prompt,
            max_tokens: models::DEFAULT_MAX_TOKENS,
            timeout: Duration::from_secs(models::GENERATION_TIMEOUT_SECS),
        },
        cancellation_token,
    )
    .await
}

/// Bounded request shared by meeting notes, live summary and transcript correction.
pub struct BuiltinGeneration<'a> {
    pub model_name: &'a str,
    pub system_prompt: &'a str,
    pub user_prompt: &'a str,
    pub max_tokens: i32,
    pub timeout: Duration,
}

pub async fn generate_bounded(
    app_data_dir: &PathBuf,
    input: &BuiltinGeneration<'_>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String> {
    if !(1..=models::DEFAULT_MAX_TOKENS).contains(&input.max_tokens) || input.timeout.is_zero() {
        return Err(anyhow!("Invalid built-in generation limits"));
    }
    let BuiltinGeneration {
        model_name,
        system_prompt,
        user_prompt,
        ..
    } = input;
    // Check cancellation at start
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err(anyhow!("Generation cancelled before starting"));
        }
    }

    log::info!("Built-in AI generation request");
    log::info!("Model: {}", model_name);

    // Get model definition
    let model_def = models::get_model_by_name(model_name)
        .ok_or_else(|| anyhow!("Unknown model: {}", model_name))?;

    // Resolve model path with caching (avoids repeated filesystem I/O)
    let model_path = get_cached_model_path(app_data_dir, model_name)?;

    // Apply model-specific chat template
    let formatted_prompt = models::format_prompt(&model_def.template, system_prompt, user_prompt)?;
    // Get or initialize sidecar manager
    let manager = {
        let mut global_manager = SIDECAR_MANAGER.lock().await;
        if global_manager.is_none() {
            log::info!("Initializing sidecar manager");
            let new_manager = SidecarManager::new(app_data_dir.clone())?;
            *global_manager = Some(Arc::new(new_manager));
        }
        global_manager
            .clone()
            .ok_or_else(|| anyhow!("Sidecar initialization failed"))?
    };

    // Ensure sidecar is running with this model
    manager.ensure_running(model_path.clone()).await?;

    // Check cancellation after sidecar startup
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err(anyhow!("Generation cancelled during sidecar startup"));
        }
    }

    // Prepare generation request with model-specific sampling parameters
    let sampling = model_def.sampling.sanitize_for_llama_helper();
    let request = Request::Generate {
        prompt: formatted_prompt,
        max_tokens: Some(input.max_tokens),
        context_size: Some(model_def.context_size),
        model_path: Some(model_path.to_string_lossy().to_string()),
        temperature: Some(sampling.temperature),
        top_k: Some(sampling.top_k),
        top_p: Some(sampling.top_p),
        presence_penalty: Some(sampling.presence_penalty),
        frequency_penalty: Some(sampling.frequency_penalty),
        repeat_penalty: Some(sampling.repeat_penalty),
        penalty_last_n: Some(sampling.penalty_last_n),
        stop_tokens: Some(sampling.stop_tokens),
    };

    let request_json = serde_json::to_string(&request)?;

    // Send request with timeout
    let timeout = input.timeout;

    log::info!("Sending generation request to sidecar");

    // Race between send_request and cancellation token
    let response_json = if let Some(token) = cancellation_token {
        tokio::select! {
            result = manager.send_request(request_json, timeout) => {
                result?
            }
            _ = token.cancelled() => {
                log::warn!("Generation cancelled by user, shutting down sidecar");
                // Shutdown sidecar to stop generation immediately
                if let Err(e) = manager.shutdown().await {
                    log::error!("Failed to shutdown sidecar during cancellation: {}", e);
                }
                return Err(anyhow!("Generation cancelled by user"));
            }
        }
    } else {
        manager.send_request(request_json, timeout).await?
    };

    // Check cancellation before parsing response
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err(anyhow!("Generation cancelled"));
        }
    }

    // Parse response
    let response: Response = serde_json::from_str(&response_json)
        .with_context(|| format!("Failed to parse response: {}", response_json))?;

    match response {
        Response::Response { text, error } => {
            if let Some(err_msg) = error {
                Err(anyhow!("Generation failed: {}", err_msg))
            } else {
                log::info!("Generation completed: {} chars", text.len());
                Ok(text)
            }
        }
        Response::Error { message } => Err(anyhow!("Sidecar error: {}", message)),
    }
}

/// Shutdown the global sidecar (graceful cleanup)
/// Detaches the current manager and spawns a background task to drain active requests
pub async fn shutdown_sidecar_gracefully() -> Result<()> {
    let manager_opt = {
        let mut global_manager = SIDECAR_MANAGER.lock().await;
        global_manager.take()
    };

    if let Some(manager) = manager_opt {
        log::info!("Detaching sidecar manager for graceful shutdown");

        // Spawn background task to wait for active requests and then kill
        tokio::spawn(async move {
            if let Err(e) = manager.shutdown_gracefully().await {
                log::error!("Error during graceful shutdown: {}", e);
            }
        });
    }

    Ok(())
}

/// Force shutdown the global sidecar (for app exit)
/// Directly kills the process without waiting for active requests to complete.
/// This is synchronous and blocks until the sidecar is terminated.
pub async fn force_shutdown_sidecar() -> Result<()> {
    let manager_opt = {
        let mut global_manager = SIDECAR_MANAGER.lock().await;
        global_manager.take()
    };

    if let Some(manager) = manager_opt {
        log::info!("Force shutting down sidecar for app exit");
        // Call shutdown() directly - sends shutdown command and force kills after 3s
        manager.shutdown().await?;
    }

    Ok(())
}

pub(crate) async fn abort_generation() -> Result<()> {
    let manager = SIDECAR_MANAGER.lock().await.take();
    if let Some(manager) = manager { manager.abort().await?; }
    Ok(())
}

/// Check if sidecar is healthy
pub async fn is_sidecar_healthy() -> bool {
    if let Ok(manager) = get_sidecar_manager().await {
        manager.is_healthy()
    } else {
        false
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;

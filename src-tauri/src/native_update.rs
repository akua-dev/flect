use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;
use uuid::Uuid;

pub const UPDATE_ENDPOINT: &str =
    "https://github.com/akua-dev/flect/releases/latest/download/latest.json";
const UPDATE_UNAVAILABLE: &str = "Native updates are unavailable in this Flect build.";
const UPDATE_CHECK_FAILED: &str = "Flect could not check for a trusted update.";
const UPDATE_INSTALL_FAILED: &str = "Flect could not verify and install the reviewed update.";
const UPDATE_STALE: &str = "This Flect update is no longer the reviewed candidate.";

#[derive(Clone)]
struct CandidateSummary {
    version: String,
    notes: String,
    target: &'static str,
}

struct PendingUpdate {
    summary: CandidateSummary,
    update: Update,
}

#[derive(Default)]
pub struct NativeUpdateState {
    configured: bool,
    candidates: Mutex<HashMap<String, PendingUpdate>>,
}

impl NativeUpdateState {
    pub fn new(configured: bool) -> Self {
        Self {
            configured,
            candidates: Mutex::new(HashMap::new()),
        }
    }
}

pub fn public_update_key(value: Option<&str>) -> Option<&str> {
    value.and_then(|key| {
        let trimmed = key.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    })
}

pub fn update_request_allowed(window_label: &str, endpoint: &str) -> bool {
    window_label == "main" && endpoint == UPDATE_ENDPOINT && endpoint.starts_with("https://")
}

fn checked_at_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn installed_version(window: &WebviewWindow) -> String {
    window.app_handle().package_info().version.to_string()
}

fn unavailable(window: &WebviewWindow, reason: &str) -> Value {
    json!({
        "version": 1,
        "state": "unavailable",
        "installedVersion": installed_version(window),
        "reason": reason,
    })
}

fn current(window: &WebviewWindow) -> Value {
    json!({
        "version": 1,
        "state": "current",
        "installedVersion": installed_version(window),
        "checkedAtMillis": checked_at_millis(),
    })
}

fn bounded_notes(notes: Option<String>) -> String {
    notes
        .unwrap_or_default()
        .chars()
        .take(4_096)
        .collect::<String>()
}

fn candidate_value(token: &str, summary: &CandidateSummary) -> Value {
    json!({
        "version": summary.version,
        "token": token,
        "notes": summary.notes,
        "target": summary.target,
    })
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    update_request_allowed(window.label(), UPDATE_ENDPOINT)
        .then_some(())
        .ok_or_else(|| UPDATE_UNAVAILABLE.to_owned())
}

#[tauri::command]
pub fn native_update_status(
    window: WebviewWindow,
    state: State<'_, NativeUpdateState>,
) -> Result<Value, String> {
    require_main(&window)?;
    Ok(if state.configured {
        current(&window)
    } else {
        unavailable(&window, "development")
    })
}

#[tauri::command]
pub async fn native_update_check(
    window: WebviewWindow,
    state: State<'_, NativeUpdateState>,
) -> Result<Value, String> {
    require_main(&window)?;
    if !state.configured {
        return Ok(unavailable(&window, "development"));
    }

    let endpoint = Url::parse(UPDATE_ENDPOINT).map_err(|_| UPDATE_CHECK_FAILED.to_owned())?;
    let updater = window
        .updater_builder()
        .endpoints(vec![endpoint])
        .and_then(|builder| builder.build())
        .map_err(|_| UPDATE_CHECK_FAILED.to_owned())?;
    let update = updater
        .check()
        .await
        .map_err(|_| UPDATE_CHECK_FAILED.to_owned())?;
    let Some(update) = update else {
        state
            .candidates
            .lock()
            .map_err(|_| UPDATE_CHECK_FAILED.to_owned())?
            .clear();
        return Ok(current(&window));
    };

    let token = Uuid::new_v4().to_string();
    let summary = CandidateSummary {
        version: update.version.clone(),
        notes: bounded_notes(update.body.clone()),
        target: "darwin-aarch64",
    };
    let candidate = candidate_value(&token, &summary);
    let mut candidates = state
        .candidates
        .lock()
        .map_err(|_| UPDATE_CHECK_FAILED.to_owned())?;
    candidates.clear();
    candidates.insert(token, PendingUpdate { summary, update });

    Ok(json!({
        "version": 1,
        "state": "available",
        "installedVersion": installed_version(&window),
        "candidate": candidate,
    }))
}

#[tauri::command]
pub async fn native_update_install(
    window: WebviewWindow,
    state: State<'_, NativeUpdateState>,
    token: String,
) -> Result<Value, String> {
    require_main(&window)?;
    if !state.configured {
        return Ok(unavailable(&window, "development"));
    }
    let pending = state
        .candidates
        .lock()
        .map_err(|_| UPDATE_INSTALL_FAILED.to_owned())?
        .remove(&token)
        .ok_or_else(|| UPDATE_STALE.to_owned())?;
    let progress = Arc::new(Mutex::new((0_u64, None::<u64>)));
    let progress_for_chunks = Arc::clone(&progress);
    let window_for_chunks = window.clone();
    pending
        .update
        .download_and_install(
            move |chunk_length, content_length| {
                if let Ok(mut current) = progress_for_chunks.lock() {
                    current.0 = current.0.saturating_add(chunk_length as u64);
                    current.1 = content_length;
                    let _ = window_for_chunks.emit(
                        "flect://native-update-progress",
                        json!({
                            "downloadedBytes": current.0,
                            "totalBytes": current.1,
                        }),
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|_| UPDATE_INSTALL_FAILED.to_owned())?;
    let (downloaded_bytes, total_bytes) = progress
        .lock()
        .map(|current| *current)
        .map_err(|_| UPDATE_INSTALL_FAILED.to_owned())?;

    Ok(json!({
        "version": 1,
        "state": "ready-to-relaunch",
        "installedVersion": installed_version(&window),
        "candidate": candidate_value(&token, &pending.summary),
        "progress": {
            "downloadedBytes": downloaded_bytes,
            "totalBytes": total_bytes,
        },
    }))
}

#[tauri::command]
pub fn native_update_relaunch(window: WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    window.app_handle().restart();
}

#[cfg(test)]
mod tests {
    use super::{bounded_notes, public_update_key, update_request_allowed, UPDATE_ENDPOINT};

    #[test]
    fn permits_only_the_main_window_and_fixed_https_endpoint() {
        assert!(update_request_allowed("main", UPDATE_ENDPOINT));
        assert!(!update_request_allowed("capsule", UPDATE_ENDPOINT));
        assert!(!update_request_allowed(
            "main",
            "http://127.0.0.1:3000/latest.json"
        ));
        assert!(!update_request_allowed(
            "main",
            "https://example.com/latest.json"
        ));
    }

    #[test]
    fn treats_an_absent_or_blank_public_key_as_development_unavailable() {
        assert_eq!(public_update_key(None), None);
        assert_eq!(public_update_key(Some("")), None);
        assert_eq!(public_update_key(Some("  \n")), None);
        assert_eq!(public_update_key(Some("PUBLIC-KEY")), Some("PUBLIC-KEY"));
    }

    #[test]
    fn bounds_release_notes_without_exposing_unbounded_manifest_content() {
        assert_eq!(bounded_notes(Some("safe".to_owned())), "safe");
        assert_eq!(
            bounded_notes(Some("x".repeat(5_000))).chars().count(),
            4_096
        );
    }
}

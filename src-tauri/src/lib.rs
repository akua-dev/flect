use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::symlink;
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

mod native_update;

const MAX_RPC_MESSAGE_BYTES: usize = 1024 * 1024;
const INVALID_REQUEST: &str = "Invalid private runtime request.";
const INVALID_RESPONSE: &str = "Invalid private runtime response.";
const OVERSIZED_REQUEST: &str = "Private runtime request is too large.";
const OVERSIZED_RESPONSE: &str = "Private runtime response is too large.";
const RUNTIME_UNAVAILABLE: &str = "The private runtime is unavailable.";
const MAX_CAPSULE_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_CAPSULE_DOCUMENTS: usize = 8;
const CAPSULE_DOCUMENT_UNAVAILABLE: &str = "The isolated capsule document is unavailable.";

#[derive(Debug, PartialEq, Eq)]
pub enum LaunchMode {
    Gui,
    Axi(Vec<String>),
    Mcp(Vec<String>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MainWindowAction {
    RevealAndFocus,
}

fn main_window_action(_has_visible_windows: Option<bool>) -> MainWindowAction {
    MainWindowAction::RevealAndFocus
}

fn apply_main_window_action<R: Runtime>(
    handle: &AppHandle<R>,
    action: MainWindowAction,
) -> tauri::Result<()> {
    let MainWindowAction::RevealAndFocus = action;

    #[cfg(target_os = "macos")]
    handle.show()?;

    let window = handle
        .get_webview_window("main")
        .ok_or(tauri::Error::WindowNotFound)?;
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}

pub fn select_launch_mode(
    args: &[String],
    stdin_is_terminal: bool,
) -> Result<LaunchMode, &'static str> {
    if args
        .iter()
        .any(|argument| argument.starts_with("--flect-private-mode="))
    {
        return Err("Private Flect runtime flags are not public commands.");
    }

    match args.first().map(String::as_str) {
        None if stdin_is_terminal => Ok(LaunchMode::Axi(Vec::new())),
        None => Ok(LaunchMode::Gui),
        Some("app") => Ok(LaunchMode::Gui),
        Some("mcp") => Ok(LaunchMode::Mcp(args[1..].to_vec())),
        Some(_) => Ok(LaunchMode::Axi(args.to_vec())),
    }
}

pub fn private_runtime_command(mode: &str, args: &[String], current_exe: &Path) -> Command {
    let mut command = Command::new(current_exe.with_file_name("flect-runtime"));
    command
        .arg(format!("--flect-private-mode={mode}"))
        .args(args)
        .env("FLECT_PUBLIC_EXECUTABLE", current_exe)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    command
}

fn resolve_public_executable(current_exe: &Path) -> std::io::Result<PathBuf> {
    fs::canonicalize(current_exe)
}

fn run_private_mode(mode: &str, args: &[String], current_exe: &Path) -> i32 {
    if current_exe.parent().is_none() {
        eprintln!("Flect could not locate its private runtime.");
        return 1;
    }
    let error = private_runtime_command(mode, args, current_exe).exec();
    eprintln!("Flect could not start its private runtime: {error}");
    1
}

pub fn run_public(args: &[String], stdin_is_terminal: bool) -> i32 {
    let mode = match select_launch_mode(args, stdin_is_terminal) {
        Ok(mode) => mode,
        Err(message) => {
            eprintln!("{message}");
            return 2;
        }
    };
    match mode {
        LaunchMode::Gui => {
            run();
            0
        }
        LaunchMode::Axi(arguments) => match std::env::current_exe()
            .and_then(|executable| resolve_public_executable(&executable))
        {
            Ok(executable) => run_private_mode("axi", &arguments, &executable),
            Err(_) => 1,
        },
        LaunchMode::Mcp(arguments) => match std::env::current_exe()
            .and_then(|executable| resolve_public_executable(&executable))
        {
            Ok(executable) => run_private_mode("mcp", &arguments, &executable),
            Err(_) => 1,
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShellLinkState {
    Absent,
    Installed,
    Stale,
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellLinkStatus {
    pub state: ShellLinkState,
    pub path: PathBuf,
    pub changed: bool,
}

fn shell_link_path(home: &Path) -> PathBuf {
    home.join(".local/bin/flect")
}

fn is_flect_owned_target(target: &Path) -> bool {
    let components = target.components().collect::<Vec<Component<'_>>>();
    let expected = ["Flect.app", "Contents", "MacOS", "flect"];
    components.len() >= expected.len()
        && components[components.len() - expected.len()..]
            .iter()
            .zip(expected)
            .all(|(component, name)| component.as_os_str() == name)
}

pub fn inspect_shell_link_at(
    home: &Path,
    current_executable: &Path,
) -> Result<ShellLinkStatus, String> {
    let path = shell_link_path(home);
    let state = match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ShellLinkState::Absent,
        Err(_) => return Err("Flect could not inspect the command-line link.".to_owned()),
        Ok(metadata) if !metadata.file_type().is_symlink() => ShellLinkState::Conflict,
        Ok(_) => {
            let target = fs::read_link(&path)
                .map_err(|_| "Flect could not inspect the command-line link.".to_owned())?;
            if target == current_executable {
                ShellLinkState::Installed
            } else if is_flect_owned_target(&target) {
                ShellLinkState::Stale
            } else {
                ShellLinkState::Conflict
            }
        }
    };
    Ok(ShellLinkStatus {
        state,
        path,
        changed: false,
    })
}

pub fn install_shell_link_at(
    home: &Path,
    current_executable: &Path,
) -> Result<ShellLinkStatus, String> {
    let status = inspect_shell_link_at(home, current_executable)?;
    match status.state {
        ShellLinkState::Installed => return Ok(status),
        ShellLinkState::Conflict => {
            return Err(
                "~/.local/bin/flect is owned by another file or command-line link.".to_owned(),
            )
        }
        ShellLinkState::Stale => fs::remove_file(&status.path)
            .map_err(|_| "Flect could not repair the command-line link.".to_owned())?,
        ShellLinkState::Absent => {}
    }
    let parent = status
        .path
        .parent()
        .ok_or_else(|| "Flect could not resolve the command-line directory.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|_| "Flect could not create the command-line directory.".to_owned())?;
    symlink(current_executable, &status.path)
        .map_err(|_| "Flect could not install the command-line link.".to_owned())?;
    let mut installed = inspect_shell_link_at(home, current_executable)?;
    installed.changed = true;
    Ok(installed)
}

pub fn remove_shell_link_at(
    home: &Path,
    current_executable: &Path,
) -> Result<ShellLinkStatus, String> {
    let status = inspect_shell_link_at(home, current_executable)?;
    match status.state {
        ShellLinkState::Absent => return Ok(status),
        ShellLinkState::Conflict => {
            return Err(
                "~/.local/bin/flect is owned by another file or command-line link.".to_owned(),
            )
        }
        ShellLinkState::Installed | ShellLinkState::Stale => fs::remove_file(&status.path)
            .map_err(|_| "Flect could not remove the command-line link.".to_owned())?,
    }
    let mut removed = inspect_shell_link_at(home, current_executable)?;
    removed.changed = true;
    Ok(removed)
}

fn native_shell_link_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Flect could not resolve the user home directory.".to_owned())?;
    let executable = std::env::current_exe()
        .map_err(|_| "Flect could not resolve its installed executable.".to_owned())?;
    Ok((home, executable))
}

#[tauri::command]
fn shell_link_status(app: tauri::AppHandle) -> Result<ShellLinkStatus, String> {
    let (home, executable) = native_shell_link_paths(&app)?;
    inspect_shell_link_at(&home, &executable)
}

#[tauri::command]
fn shell_link_install(app: tauri::AppHandle) -> Result<ShellLinkStatus, String> {
    let (home, executable) = native_shell_link_paths(&app)?;
    install_shell_link_at(&home, &executable)
}

#[tauri::command]
fn shell_link_remove(app: tauri::AppHandle) -> Result<ShellLinkStatus, String> {
    let (home, executable) = native_shell_link_paths(&app)?;
    remove_shell_link_at(&home, &executable)
}

fn application_bundle_at(current_executable: &Path) -> Result<PathBuf, String> {
    let macos = current_executable
        .parent()
        .filter(|path| path.file_name().is_some_and(|name| name == "MacOS"));
    let contents = macos
        .and_then(Path::parent)
        .filter(|path| path.file_name().is_some_and(|name| name == "Contents"));
    contents
        .and_then(Path::parent)
        .filter(|path| path.file_name().is_some_and(|name| name == "Flect.app"))
        .map(Path::to_path_buf)
        .ok_or_else(|| "Flect could not verify the installed application bundle.".to_owned())
}

#[tauri::command]
fn native_application_path(window: tauri::WebviewWindow) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Native setup is available only to the main Flect window.".to_owned());
    }
    let executable = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|_| "Flect could not verify the installed application bundle.".to_owned())?;
    application_bundle_at(&executable).and_then(|path| {
        path.into_os_string()
            .into_string()
            .map_err(|_| "Flect could not verify the installed application bundle.".to_owned())
    })
}

#[derive(Default)]
struct RuntimeChild(Mutex<Option<CommandChild>>);

#[derive(Clone, Default)]
struct CapsuleDocuments(Arc<Mutex<HashMap<String, Vec<u8>>>>);

fn valid_capsule_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_capsule_document(token: &str, bytes: usize) -> bool {
    valid_capsule_token(token) && bytes <= MAX_CAPSULE_DOCUMENT_BYTES
}

fn capsule_document_url(token: &str) -> String {
    if cfg!(any(windows, target_os = "android")) {
        format!("http://flect-capsule.localhost/{token}")
    } else {
        format!("flect-capsule://localhost/{token}")
    }
}

fn register_capsule_document_at(
    documents: &CapsuleDocuments,
    token: String,
    document: String,
) -> Result<String, String> {
    if !valid_capsule_document(&token, document.len()) {
        return Err(CAPSULE_DOCUMENT_UNAVAILABLE.to_owned());
    }
    let mut documents = documents
        .0
        .lock()
        .map_err(|_| CAPSULE_DOCUMENT_UNAVAILABLE.to_owned())?;
    if !documents.contains_key(&token) && documents.len() >= MAX_CAPSULE_DOCUMENTS {
        return Err(CAPSULE_DOCUMENT_UNAVAILABLE.to_owned());
    }
    documents.insert(token.clone(), document.into_bytes());
    Ok(capsule_document_url(&token))
}

fn release_capsule_document_at(documents: &CapsuleDocuments, token: &str) -> Result<(), String> {
    if !valid_capsule_token(token) {
        return Err(CAPSULE_DOCUMENT_UNAVAILABLE.to_owned());
    }
    documents
        .0
        .lock()
        .map_err(|_| CAPSULE_DOCUMENT_UNAVAILABLE.to_owned())?
        .remove(token);
    Ok(())
}

fn capsule_document_response(
    documents: &CapsuleDocuments,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let token = request.uri().path().trim_start_matches('/');
    let document = valid_capsule_token(token)
        .then(|| documents.0.lock().ok()?.get(token).cloned())
        .flatten();
    match document {
        Some(document) => tauri::http::Response::builder()
            .header(
                tauri::http::header::CONTENT_TYPE,
                "text/html; charset=utf-8",
            )
            .header(tauri::http::header::CACHE_CONTROL, "no-store")
            .header("Referrer-Policy", "no-referrer")
            .header("X-Content-Type-Options", "nosniff")
            .body(document)
            .expect("valid capsule document response"),
        None => tauri::http::Response::builder()
            .status(tauri::http::StatusCode::NOT_FOUND)
            .header(
                tauri::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8",
            )
            .header(tauri::http::header::CACHE_CONTROL, "no-store")
            .body(CAPSULE_DOCUMENT_UNAVAILABLE.as_bytes().to_vec())
            .expect("valid capsule unavailable response"),
    }
}

#[tauri::command]
fn capsule_document_register(
    token: String,
    document: String,
    documents: State<'_, CapsuleDocuments>,
) -> Result<String, String> {
    register_capsule_document_at(&documents, token, document)
}

#[tauri::command]
fn capsule_document_release(
    token: String,
    documents: State<'_, CapsuleDocuments>,
) -> Result<(), String> {
    release_capsule_document_at(&documents, &token)
}

pub fn validate_rpc_request(request: &Value) -> Result<(), &'static str> {
    let encoded = serde_json::to_vec(request).map_err(|_| INVALID_REQUEST)?;
    if encoded.len() > MAX_RPC_MESSAGE_BYTES {
        return Err(OVERSIZED_REQUEST);
    }

    let tag = request
        .as_object()
        .and_then(|object| object.get("_tag"))
        .and_then(Value::as_str)
        .ok_or(INVALID_REQUEST)?;

    match tag {
        "Request" | "Ack" | "Interrupt" | "Eof" | "Ping" => Ok(()),
        _ => Err(INVALID_REQUEST),
    }
}

pub fn encode_rpc_request(request: &Value) -> Result<Vec<u8>, String> {
    validate_rpc_request(request).map_err(str::to_owned)?;
    let mut encoded = serde_json::to_vec(request).map_err(|_| INVALID_REQUEST.to_owned())?;
    encoded.push(b'\n');
    Ok(encoded)
}

pub fn decode_rpc_response(line: &[u8]) -> Result<Value, &'static str> {
    if line.len() > MAX_RPC_MESSAGE_BYTES {
        return Err(OVERSIZED_RESPONSE);
    }
    serde_json::from_slice(line).map_err(|_| INVALID_RESPONSE)
}

pub fn require_runtime_child<T>(child: Option<&mut T>) -> Result<&mut T, String> {
    child.ok_or_else(|| RUNTIME_UNAVAILABLE.to_owned())
}

fn runtime_unavailable_response() -> Value {
    serde_json::json!({
        "_tag": "ClientProtocolError",
        "error": {
            "_tag": "RpcClientError",
            "reason": {
                "_tag": "RpcClientDefect",
                "message": RUNTIME_UNAVAILABLE,
                "cause": null
            }
        }
    })
}

fn emit_runtime_unavailable(handle: &tauri::AppHandle) {
    let _ = handle.emit("flect://rpc", runtime_unavailable_response());
}

#[tauri::command]
fn rpc_send(request: Value, runtime: State<'_, RuntimeChild>) -> Result<(), String> {
    let encoded = encode_rpc_request(&request)?;
    let operation = request
        .as_object()
        .and_then(|object| object.get("tag").or_else(|| object.get("_tag")))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    eprintln!("Flect private runtime request accepted: {operation}.");

    let mut guard = runtime
        .0
        .lock()
        .map_err(|_| RUNTIME_UNAVAILABLE.to_owned())?;
    let child = require_runtime_child(guard.as_mut())?;
    child
        .write(&encoded)
        .map_err(|_| RUNTIME_UNAVAILABLE.to_owned())
}

fn start_runtime(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (mut events, child) = app
        .shell()
        .sidecar("flect-runtime")?
        .spawn()
        .map_err(|_| RUNTIME_UNAVAILABLE)?;

    {
        let state = app.state::<RuntimeChild>();
        let mut guard = state.0.lock().map_err(|_| RUNTIME_UNAVAILABLE)?;
        guard.replace(child);
    }

    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => match decode_rpc_response(&line) {
                    Ok(payload) => {
                        let response_type = payload
                            .as_object()
                            .and_then(|object| object.get("_tag"))
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        eprintln!("Flect private runtime response received: {response_type}.");
                        let _ = handle.emit("flect://rpc", payload);
                    }
                    Err(reason) => {
                        eprintln!("Flect private runtime returned an invalid frame: {reason}");
                        if let Ok(mut guard) = handle.state::<RuntimeChild>().0.lock() {
                            if let Some(child) = guard.take() {
                                let _ = child.kill();
                            }
                        }
                        break;
                    }
                },
                CommandEvent::Stderr(_) | CommandEvent::Error(_) => {
                    eprintln!("Flect private runtime reported an internal error.");
                }
                CommandEvent::Terminated(_) => {
                    eprintln!("Flect private runtime stopped.");
                    break;
                }
                _ => {}
            }
        }
        emit_runtime_unavailable(&handle);
    });

    eprintln!("Flect private runtime started.");
    Ok(())
}

pub fn run() {
    let capsule_documents = CapsuleDocuments::default();
    let protocol_documents = capsule_documents.clone();
    let update_key = native_update::public_update_key(option_env!("FLECT_UPDATE_PUBLIC_KEY"));
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());
    if let Some(public_key) = update_key {
        builder = builder.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(public_key)
                .build(),
        );
    }
    let app = builder
        .manage(RuntimeChild::default())
        .manage(capsule_documents)
        .manage(native_update::NativeUpdateState::new(update_key.is_some()))
        .register_uri_scheme_protocol("flect-capsule", move |_context, request| {
            capsule_document_response(&protocol_documents, &request)
        })
        .invoke_handler(tauri::generate_handler![
            rpc_send,
            shell_link_status,
            shell_link_install,
            shell_link_remove,
            native_application_path,
            native_update::native_update_status,
            native_update::native_update_check,
            native_update::native_update_install,
            native_update::native_update_relaunch,
            capsule_document_register,
            capsule_document_release
        ])
        .setup(|app| {
            start_runtime(app)?;
            apply_main_window_action(app.handle(), main_window_action(None))?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Flect");

    app.run(|handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if let Err(error) =
                apply_main_window_action(handle, main_window_action(Some(has_visible_windows)))
            {
                eprintln!("Flect could not reveal its main window: {error}");
            }
        }

        if matches!(event, RunEvent::Exit) {
            let state = handle.state::<RuntimeChild>();
            if let Ok(mut guard) = state.0.lock() {
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            };
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        application_bundle_at, capsule_document_response, decode_rpc_response, encode_rpc_request,
        inspect_shell_link_at, install_shell_link_at, main_window_action, private_runtime_command,
        register_capsule_document_at, release_capsule_document_at, remove_shell_link_at,
        require_runtime_child, resolve_public_executable, runtime_unavailable_response,
        select_launch_mode, valid_capsule_document, validate_rpc_request, CapsuleDocuments,
        LaunchMode, MainWindowAction, ShellLinkState, MAX_CAPSULE_DOCUMENTS,
        MAX_CAPSULE_DOCUMENT_BYTES, MAX_RPC_MESSAGE_BYTES,
    };
    use serde_json::json;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn shell_link_fixture(label: &str) -> (PathBuf, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flect-shell-link-{label}-{}-{nonce}",
            std::process::id()
        ));
        let home = root.join("home");
        let executable = root.join("Applications/Flect.app/Contents/MacOS/flect");
        fs::create_dir_all(executable.parent().expect("executable parent"))
            .expect("create executable parent");
        fs::write(&executable, b"fixture").expect("create executable");
        (home, executable)
    }

    #[test]
    fn resolves_only_the_fixed_flect_application_bundle_shape() {
        assert_eq!(
            application_bundle_at(
                PathBuf::from("/Applications/Flect.app/Contents/MacOS/flect").as_path()
            )
            .expect("valid bundle"),
            PathBuf::from("/Applications/Flect.app")
        );
        assert!(application_bundle_at(PathBuf::from("/usr/local/bin/flect").as_path()).is_err());
        assert!(application_bundle_at(
            PathBuf::from("/Applications/Other.app/Contents/MacOS/flect").as_path()
        )
        .is_err());
    }

    #[test]
    fn serves_only_registered_bounded_capsule_documents() {
        let documents = CapsuleDocuments::default();
        let token = "0123456789abcdef0123456789abcdef";
        let document = "<!doctype html><h1>Isolated capsule</h1>";
        let url = register_capsule_document_at(&documents, token.to_owned(), document.to_owned())
            .expect("register document");
        let request = tauri::http::Request::builder()
            .uri(url)
            .body(Vec::new())
            .expect("valid request");

        let response = capsule_document_response(&documents, &request);

        assert_eq!(response.status(), tauri::http::StatusCode::OK);
        assert_eq!(response.body(), document.as_bytes());
        assert_eq!(
            response.headers().get(tauri::http::header::CACHE_CONTROL),
            Some(&tauri::http::HeaderValue::from_static("no-store"))
        );
        release_capsule_document_at(&documents, token).expect("release document");
        assert_eq!(
            capsule_document_response(&documents, &request).status(),
            tauri::http::StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn rejects_invalid_or_oversized_capsule_document_registrations() {
        assert!(!valid_capsule_document("short", 1));
        assert!(!valid_capsule_document(
            "0123456789abcdef0123456789abcdef",
            MAX_CAPSULE_DOCUMENT_BYTES + 1
        ));
        assert!(valid_capsule_document(
            "0123456789abcdef0123456789abcdef",
            MAX_CAPSULE_DOCUMENT_BYTES
        ));
    }

    #[test]
    fn bounds_the_native_capsule_document_registry() {
        let documents = CapsuleDocuments::default();
        for index in 0..MAX_CAPSULE_DOCUMENTS {
            register_capsule_document_at(
                &documents,
                format!("{index:032x}"),
                format!("document {index}"),
            )
            .expect("register bounded document");
        }

        assert!(register_capsule_document_at(
            &documents,
            format!("{:032x}", MAX_CAPSULE_DOCUMENTS),
            "one too many".to_owned(),
        )
        .is_err());
        register_capsule_document_at(
            &documents,
            format!("{:032x}", MAX_CAPSULE_DOCUMENTS - 1),
            "replacement".to_owned(),
        )
        .expect("replace existing document");
    }

    #[test]
    fn accepts_effect_rpc_messages() {
        let request = json!({
            "_tag": "Request",
            "id": 1,
            "tag": "GetRuntime",
            "payload": null,
            "headers": []
        });

        assert!(validate_rpc_request(&request).is_ok());
    }

    #[test]
    fn rejects_unknown_message_types() {
        let request = json!({
            "_tag": "Spawn",
            "command": "anything"
        });

        assert_eq!(
            validate_rpc_request(&request),
            Err("Invalid private runtime request.")
        );
    }

    #[test]
    fn rejects_messages_over_one_mebibyte() {
        let request = json!({
            "_tag": "Request",
            "id": 1,
            "tag": "Prompt",
            "payload": "x".repeat(1024 * 1024),
            "headers": []
        });

        assert_eq!(
            validate_rpc_request(&request),
            Err("Private runtime request is too large.")
        );
    }

    #[test]
    fn encodes_exactly_one_ndjson_frame() {
        let request = json!({
            "_tag": "Ping",
        });

        let encoded = encode_rpc_request(&request).expect("valid request");

        assert_eq!(encoded.last(), Some(&b'\n'));
        assert_eq!(encoded.iter().filter(|byte| **byte == b'\n').count(), 1);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&encoded[..encoded.len() - 1])
                .expect("valid JSON"),
            request
        );
    }

    #[test]
    fn rejects_malformed_sidecar_frames() {
        assert_eq!(
            decode_rpc_response(b"{not-json"),
            Err("Invalid private runtime response.")
        );
    }

    #[test]
    fn rejects_oversized_sidecar_frames() {
        assert_eq!(
            decode_rpc_response(&vec![b' '; MAX_RPC_MESSAGE_BYTES + 1]),
            Err("Private runtime response is too large.")
        );
    }

    #[test]
    fn reports_an_unavailable_runtime_child() {
        let unavailable: Option<&mut ()> = None;

        assert_eq!(
            require_runtime_child(unavailable),
            Err("The private runtime is unavailable.".to_owned())
        );
    }

    #[test]
    fn encodes_runtime_unavailability_as_a_protocol_error() {
        let response = runtime_unavailable_response();

        assert_eq!(response["_tag"], "ClientProtocolError");
        assert_eq!(
            response["error"]["reason"]["message"],
            "The private runtime is unavailable."
        );
    }

    #[test]
    fn selects_gui_for_finder_and_explicit_app_launches() {
        assert_eq!(select_launch_mode(&[], false), Ok(LaunchMode::Gui));
        assert_eq!(
            select_launch_mode(&["app".to_owned()], true),
            Ok(LaunchMode::Gui)
        );
    }

    #[test]
    fn reveals_the_main_window_on_launch_and_every_macos_reopen() {
        assert_eq!(main_window_action(None), MainWindowAction::RevealAndFocus);
        assert_eq!(
            main_window_action(Some(false)),
            MainWindowAction::RevealAndFocus
        );
        assert_eq!(
            main_window_action(Some(true)),
            MainWindowAction::RevealAndFocus
        );
    }

    #[test]
    fn selects_axi_for_terminal_discovery_and_domain_commands() {
        assert_eq!(select_launch_mode(&[], true), Ok(LaunchMode::Axi(vec![])));
        assert_eq!(
            select_launch_mode(&["inspect".to_owned(), "--json".to_owned()], true),
            Ok(LaunchMode::Axi(vec![
                "inspect".to_owned(),
                "--json".to_owned()
            ]))
        );
    }

    #[test]
    fn selects_mcp_and_rejects_private_user_markers() {
        assert_eq!(
            select_launch_mode(&["mcp".to_owned(), "--state-dir".to_owned()], true),
            Ok(LaunchMode::Mcp(vec!["--state-dir".to_owned()]))
        );
        assert_eq!(
            select_launch_mode(&["--flect-private-mode=rpc".to_owned()], true),
            Err("Private Flect runtime flags are not public commands.")
        );
    }

    #[test]
    fn private_runtime_receives_the_fixed_public_executable() {
        let executable = PathBuf::from("/Applications/Flect.app/Contents/MacOS/flect");
        let command = private_runtime_command(
            "axi",
            &["setup".to_owned(), "status".to_owned()],
            &executable,
        );
        let environment = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|item| item.to_string_lossy().into_owned()),
                )
            })
            .collect::<Vec<_>>();

        assert!(environment.contains(&(
            "FLECT_PUBLIC_EXECUTABLE".to_owned(),
            Some("/Applications/Flect.app/Contents/MacOS/flect".to_owned())
        )));
    }

    #[test]
    fn private_runtime_follows_the_shell_link_back_into_the_app_bundle() {
        let (home, executable) = shell_link_fixture("runtime-shell-link");
        let installed = install_shell_link_at(&home, &executable).expect("install link");
        let linked_executable = installed.path;

        let resolved = resolve_public_executable(&linked_executable).expect("resolve link");
        let command = private_runtime_command("axi", &["inspect".to_owned()], &resolved);

        assert_eq!(
            resolved,
            fs::canonicalize(&executable).expect("canonical executable")
        );
        assert_eq!(
            command.get_program(),
            resolved.with_file_name("flect-runtime")
        );
        fs::remove_dir_all(home.parent().expect("fixture root")).expect("remove fixture");
    }

    #[test]
    fn installs_and_reinstalls_the_fixed_shell_link_idempotently() {
        let (home, executable) = shell_link_fixture("install");

        let installed = install_shell_link_at(&home, &executable).expect("install link");
        let reinstalled = install_shell_link_at(&home, &executable).expect("reinstall link");

        assert_eq!(installed.state, ShellLinkState::Installed);
        assert!(installed.changed);
        assert_eq!(reinstalled.state, ShellLinkState::Installed);
        assert!(!reinstalled.changed);
        assert_eq!(
            fs::read_link(home.join(".local/bin/flect")).expect("read link"),
            executable
        );
        fs::remove_dir_all(home.parent().expect("fixture root")).expect("remove fixture");
    }

    #[test]
    fn repairs_only_a_stale_flect_owned_link() {
        let (home, executable) = shell_link_fixture("repair");
        let link = home.join(".local/bin/flect");
        fs::create_dir_all(link.parent().expect("link parent")).expect("create link parent");
        let stale = home.join("old/Flect.app/Contents/MacOS/flect");
        symlink(&stale, &link).expect("create stale link");

        assert_eq!(
            inspect_shell_link_at(&home, &executable)
                .expect("inspect stale")
                .state,
            ShellLinkState::Stale
        );
        install_shell_link_at(&home, &executable).expect("repair stale link");
        assert_eq!(
            fs::read_link(&link).expect("read repaired link"),
            executable
        );
        fs::remove_dir_all(home.parent().expect("fixture root")).expect("remove fixture");
    }

    #[test]
    fn never_overwrites_regular_files_or_foreign_links() {
        let (home, executable) = shell_link_fixture("conflict");
        let link = home.join(".local/bin/flect");
        fs::create_dir_all(link.parent().expect("link parent")).expect("create link parent");
        fs::write(&link, b"user file").expect("create user file");

        assert_eq!(
            inspect_shell_link_at(&home, &executable)
                .expect("inspect file")
                .state,
            ShellLinkState::Conflict
        );
        assert!(install_shell_link_at(&home, &executable).is_err());
        assert_eq!(fs::read(&link).expect("preserved user file"), b"user file");

        fs::remove_file(&link).expect("remove user file");
        symlink("/usr/local/bin/flect", &link).expect("create foreign link");
        assert_eq!(
            inspect_shell_link_at(&home, &executable)
                .expect("inspect foreign link")
                .state,
            ShellLinkState::Conflict
        );
        assert!(install_shell_link_at(&home, &executable).is_err());
        assert_eq!(
            fs::read_link(&link).expect("preserved foreign link"),
            PathBuf::from("/usr/local/bin/flect")
        );
        fs::remove_dir_all(home.parent().expect("fixture root")).expect("remove fixture");
    }

    #[test]
    fn removal_deletes_only_flect_owned_links() {
        let (home, executable) = shell_link_fixture("remove");
        let link = home.join(".local/bin/flect");

        install_shell_link_at(&home, &executable).expect("install link");
        let removed = remove_shell_link_at(&home, &executable).expect("remove link");
        assert_eq!(removed.state, ShellLinkState::Absent);
        assert!(removed.changed);
        assert!(!link.exists());

        symlink("/usr/local/bin/flect", &link).expect("create foreign link");
        assert!(remove_shell_link_at(&home, &executable).is_err());
        assert_eq!(
            fs::read_link(&link).expect("preserved foreign link"),
            PathBuf::from("/usr/local/bin/flect")
        );
        fs::remove_dir_all(home.parent().expect("fixture root")).expect("remove fixture");
    }
}

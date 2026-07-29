use serde_json::Value;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const MAX_RPC_MESSAGE_BYTES: usize = 1024 * 1024;
const INVALID_REQUEST: &str = "Invalid private runtime request.";
const INVALID_RESPONSE: &str = "Invalid private runtime response.";
const OVERSIZED_REQUEST: &str = "Private runtime request is too large.";
const RUNTIME_UNAVAILABLE: &str = "The private runtime is unavailable.";

#[derive(Default)]
struct RuntimeChild(Mutex<Option<CommandChild>>);

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
    serde_json::from_slice(line).map_err(|_| INVALID_RESPONSE)
}

pub fn require_runtime_child<T>(child: Option<&mut T>) -> Result<&mut T, String> {
    child.ok_or_else(|| RUNTIME_UNAVAILABLE.to_owned())
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
                CommandEvent::Stdout(line) => {
                    if let Ok(payload) = decode_rpc_response(&line) {
                        let response_type = payload
                            .as_object()
                            .and_then(|object| object.get("_tag"))
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        eprintln!("Flect private runtime response received: {response_type}.");
                        let _ = handle.emit("flect://rpc", payload);
                    } else {
                        eprintln!("Flect private runtime returned an invalid frame.");
                    }
                }
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
    });

    eprintln!("Flect private runtime started.");
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(RuntimeChild::default())
        .invoke_handler(tauri::generate_handler![rpc_send])
        .setup(|app| start_runtime(app))
        .build(tauri::generate_context!())
        .expect("failed to build Flect");

    app.run(|handle, event| {
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
        decode_rpc_response, encode_rpc_request, require_runtime_child, validate_rpc_request,
    };
    use serde_json::json;

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
    fn reports_an_unavailable_runtime_child() {
        let unavailable: Option<&mut ()> = None;

        assert_eq!(
            require_runtime_child(unavailable),
            Err("The private runtime is unavailable.".to_owned())
        );
    }
}

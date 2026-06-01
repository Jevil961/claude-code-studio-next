#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration as StdDuration,
};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{Emitter, Manager};
use tokio::{sync::oneshot, time::{timeout, Duration}};

struct BackendState {
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    child: Option<Arc<Mutex<Child>>>,
    startup_error: Option<String>,
    next_id: AtomicU64,
}

impl Drop for BackendState {
    fn drop(&mut self) {
        if let Some(stdin) = &self.stdin {
            if let Ok(mut stdin) = stdin.lock() {
                let _ = stdin.write_all(b"{\"id\":\"shutdown\",\"method\":\"reconnectClaude\",\"args\":[]}\n");
                let _ = stdin.flush();
            }
        }
        thread::sleep(StdDuration::from_millis(500));
        if let Some(child) = &self.child {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl BackendState {
    fn unavailable(error: String) -> Self {
        Self {
            stdin: None,
            pending: Arc::new(Mutex::new(HashMap::new())),
            child: None,
            startup_error: Some(error),
            next_id: AtomicU64::new(1),
        }
    }
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

fn backend_root(app: &tauri::AppHandle) -> PathBuf {
    let root = project_root();
    if root.join("src").join("backend-host.mjs").exists() {
        return root;
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        if resource_dir.join("src").join("backend-host.mjs").exists() {
            return resource_dir;
        }
    }
    root
}

fn node_binary(app: &tauri::AppHandle, root: &PathBuf) -> String {
    let mut candidates = vec![
        root.join("node").join("node.exe"),
        root.join("node").join("node"),
        root.join("node.exe"),
        root.join("node"),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("node").join("node.exe"));
        candidates.push(resource_dir.join("node").join("node"));
        candidates.push(resource_dir.join("node.exe"));
        candidates.push(resource_dir.join("node"));
        candidates.push(resource_dir.join("src-tauri").join("node").join("node.exe"));
        candidates.push(resource_dir.join("src-tauri").join("node").join("node"));
    }
    for candidate in candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    "node".to_string()
}

#[cfg(target_os = "windows")]
fn append_path_candidate(paths: &mut Vec<PathBuf>, path: impl AsRef<Path>) {
    let path = path.as_ref().to_path_buf();
    let normalized = path.to_string_lossy().to_lowercase();
    if path.exists() && !paths.iter().any(|existing| existing.to_string_lossy().to_lowercase() == normalized) {
        paths.push(path);
    }
}

#[cfg(target_os = "windows")]
fn augment_backend_path(command: &mut Command) {
    let mut paths: Vec<PathBuf> = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default();

    if let Some(appdata) = env::var_os("APPDATA") {
        append_path_candidate(&mut paths, PathBuf::from(appdata).join("npm"));
    }
    if let Some(localappdata) = env::var_os("LOCALAPPDATA") {
        append_path_candidate(&mut paths, PathBuf::from(localappdata).join("Programs").join("nodejs"));
    }
    if let Some(userprofile) = env::var_os("USERPROFILE") {
        append_path_candidate(&mut paths, PathBuf::from(userprofile).join(".local").join("bin"));
    }
    if let Some(program_files) = env::var_os("ProgramFiles") {
        append_path_candidate(&mut paths, PathBuf::from(program_files).join("nodejs"));
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        append_path_candidate(&mut paths, PathBuf::from(program_files_x86).join("nodejs"));
    }
    for drive in b'C'..=b'Z' {
        let letter = drive as char;
        append_path_candidate(&mut paths, PathBuf::from(format!("{letter}:\\Nodejs")));
        append_path_candidate(&mut paths, PathBuf::from(format!("{letter}:\\nodejs")));
        append_path_candidate(&mut paths, PathBuf::from(format!("{letter}:\\Node")));
        append_path_candidate(&mut paths, PathBuf::from(format!("{letter}:\\node")));
    }

    if let Ok(joined) = env::join_paths(paths) {
        command.env("PATH", joined);
    }
}

#[cfg(not(target_os = "windows"))]
fn augment_backend_path(_command: &mut Command) {}

fn spawn_backend(app: &tauri::AppHandle) -> Result<BackendState, String> {
    let root = backend_root(app);
    let script = root.join("src").join("backend-host.mjs");
    let node = node_binary(app, &root);
    let mut command = Command::new(&node);
    command
        .arg(&script)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    augment_backend_path(&mut command);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start Node backend with '{node}'. Install Node.js 18+ or place node.exe next to the app. Details: {err}"))?;

    let stdin = child.stdin.take().ok_or("Backend stdin missing")?;
    let stdout = child.stdout.take().ok_or("Backend stdout missing")?;
    let stderr = child.stderr.take().ok_or("Backend stderr missing")?;

    let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
    let pending_reader = Arc::clone(&pending);
    let app_reader = app.clone();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                let _ = app_reader.emit("backend:log", json!({ "line": line }));
                continue;
            };

            match message.get("type").and_then(Value::as_str) {
                Some("response") => {
                    let Some(id) = message.get("id").and_then(Value::as_str) else { continue; };
                    let result = message.get("result").cloned().unwrap_or_else(|| json!({ "ok": false, "error": "Empty backend response" }));
                    if let Some(sender) = pending_reader.lock().ok().and_then(|mut map| map.remove(id)) {
                        let _ = sender.send(result);
                    }
                }
                Some("event") => {
                    let Some(channel) = message.get("channel").and_then(Value::as_str) else { continue; };
                    let payload = message.get("payload").cloned().unwrap_or(Value::Null);
                    let _ = app_reader.emit(channel, payload);
                }
                Some("ready") => {
                    let _ = app_reader.emit("backend:ready", json!({ "ok": true }));
                }
                _ => {
                    let _ = app_reader.emit("backend:log", message);
                }
            }
        }
    });

    let app_stderr = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_stderr.emit("backend:stderr", json!({ "line": line }));
        }
    });

    Ok(BackendState {
        stdin: Some(Arc::new(Mutex::new(stdin))),
        pending,
        child: Some(Arc::new(Mutex::new(child))),
        startup_error: None,
        next_id: AtomicU64::new(1),
    })
}

#[tauri::command]
async fn backend_call(state: tauri::State<'_, BackendState>, method: String, args: Vec<Value>) -> Result<Value, String> {
    if let Some(error) = &state.startup_error {
        return Ok(json!({ "ok": false, "error": error, "code": "BACKEND_UNAVAILABLE" }));
    }
    let Some(stdin) = state.stdin.as_ref().map(Arc::clone) else {
        return Ok(json!({ "ok": false, "error": "Backend is unavailable", "code": "BACKEND_UNAVAILABLE" }));
    };
    let id = state.next_id.fetch_add(1, Ordering::Relaxed).to_string();
    let pending_queue = Arc::clone(&state.pending);
    let (tx, rx) = oneshot::channel();

    if let Ok(mut pending) = pending_queue.lock() {
        pending.insert(id.clone(), tx);
    } else {
        return Ok(json!({ "ok": false, "error": "Backend pending queue is unavailable" }));
    }

    let request = json!({ "id": id, "method": method, "args": args }).to_string() + "\n";
    let write_result = stdin
        .lock()
        .map_err(|_| "Backend stdin is unavailable".to_string())
        .and_then(|mut stdin| stdin.write_all(request.as_bytes()).map_err(|err| err.to_string()));

    if let Err(error) = write_result {
        let _ = pending_queue.lock().map(|mut pending| pending.remove(&id));
        return Ok(json!({ "ok": false, "error": error }));
    }

    match timeout(Duration::from_secs(180), rx).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Ok(json!({ "ok": false, "error": "Backend response channel closed" })),
        Err(_) => {
            let _ = pending_queue.lock().map(|mut pending| pending.remove(&id));
            Ok(json!({ "ok": false, "error": "Backend call timeout" }))
        }
    }
}

#[tauri::command]
fn choose_folder() -> String {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn choose_file() -> String {
    rfd::FileDialog::new()
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn open_path(value: String) -> Value {
    match open::that(value) {
        Ok(_) => json!({ "ok": true }),
        Err(err) => json!({ "ok": false, "error": err.to_string() }),
    }
}

#[tauri::command]
fn copy_text(value: String) -> Value {
    match arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(value)) {
        Ok(_) => json!({ "ok": true }),
        Err(err) => json!({ "ok": false, "error": err.to_string() }),
    }
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Value {
    match window.minimize() {
        Ok(_) => json!({ "ok": true }),
        Err(err) => json!({ "ok": false, "error": err.to_string() }),
    }
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::Window) -> Value {
    let result = if window.is_maximized().unwrap_or(false) {
        window.unmaximize()
    } else {
        window.maximize()
    };

    match result {
        Ok(_) => json!({ "ok": true, "data": { "maximized": window.is_maximized().unwrap_or(false) } }),
        Err(err) => json!({ "ok": false, "error": err.to_string() }),
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Value {
    match window.close() {
        Ok(_) => json!({ "ok": true }),
        Err(err) => json!({ "ok": false, "error": err.to_string() }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = match spawn_backend(&app.handle()) {
                Ok(state) => state,
                Err(error) => {
                    let _ = app.handle().emit("backend:stderr", json!({ "line": error.clone() }));
                    BackendState::unavailable(error)
                }
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_call,
            choose_folder,
            choose_file,
            open_path,
            copy_text,
            minimize_window,
            toggle_maximize_window,
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use enigo::{Enigo, Key, KeyboardControllable};
use lazy_static::lazy_static;
use screenshots::Screen;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Window, WindowEvent};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use futures_util::StreamExt;
use tokio::sync::{oneshot, broadcast};

lazy_static! {
    static ref MINING_STOP_TX: broadcast::Sender<()> = broadcast::channel(1).0;
    static ref MOKURO_STOP_TX: broadcast::Sender<()> = broadcast::channel(1).0;
    static ref ACTIVE_MOKURO_PID: Mutex<Option<u32>> = Mutex::new(None);
}

fn get_engine_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("C:\\Temp"));
    path.push("manga-mining-hub");
    path.push("engine");
    path
}

fn kill_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output(); 
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

async fn download_file(window: &Window, url: &str, dest: &Path, file_name_log: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let total_size = res.content_length().unwrap_or(0) as f64;
    
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut downloaded: f64 = 0.0;
    let mut stream = res.bytes_stream();

    let _ = window.emit("install-log", format!("[DOWNLOAD] Downloading {}...", file_name_log));

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as f64;
        let percent = if total_size > 0.0 { (downloaded / total_size) * 100.0 } else { 0.0 };
        let _ = window.emit("install-progress", percent as i32);
    }
    Ok(())
}

async fn run_cmd_and_stream(window: &Window, mut cmd: Command, log_prefix: &str) -> Result<(), String> {
    cmd.stdin(std::process::Stdio::null())
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped())
       .env("PYTHONUNBUFFERED", "1")
       .env("PYTHONUTF8", "1")
       .env("PYTHONIOENCODING", "utf-8");
    
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); 

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let w_out = window.clone();
    let prefix_out = log_prefix.to_string();

    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        let mut current_line = String::new();
        while let Ok(n) = stdout.read(&mut buf).await {
            if n == 0 { break; }
            let text = String::from_utf8_lossy(&buf[..n]);
            for c in text.chars() {
                if c == '\n' || c == '\r' {
                    let trimmed = current_line.trim();
                    if !trimmed.is_empty() { let _ = w_out.emit("install-log", format!("[{}] {}", prefix_out, trimmed)); }
                    current_line.clear();
                } else { current_line.push(c); }
            }
        }
    });

    let w_err = window.clone();
    let prefix_err = log_prefix.to_string();
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        let mut current_line = String::new();
        while let Ok(n) = stderr.read(&mut buf).await {
            if n == 0 { break; }
            let text = String::from_utf8_lossy(&buf[..n]);
            for c in text.chars() {
                if c == '\n' || c == '\r' {
                    let trimmed = current_line.trim();
                    if !trimmed.is_empty() { let _ = w_err.emit("install-log", format!("[{}-ERR] {}", prefix_err, trimmed)); }
                    current_line.clear();
                } else { current_line.push(c); }
            }
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() { return Err(format!("Command failed with exit code: {}", status)); }
    Ok(())
}

#[tauri::command]
async fn check_mokuro() -> Result<String, String> {
    let python_exe = get_engine_dir().join("python").join("python.exe");
    if python_exe.exists() { Ok("ready".to_string()) } else { Ok("missing_dependencies".to_string()) }
}

#[tauri::command]
async fn install_engine(window: Window, mode: String) -> Result<(), String> {
    let engine_dir = get_engine_dir();
    let python_dir = engine_dir.join("python");
    fs::create_dir_all(&python_dir).map_err(|e| e.to_string())?;

    let py_zip_path = engine_dir.join("python.zip");
    let get_pip_path = python_dir.join("get-pip.py");
    let python_exe = python_dir.join("python.exe");

    download_file(&window, "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip", &py_zip_path, "Python Core").await?;
    let _ = window.emit("install-log", "[SYSTEM] Extracting Python Environment...".to_string());
    
    let py_zip_path_clone = py_zip_path.clone();
    let python_dir_clone = python_dir.clone();
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(&py_zip_path_clone).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        archive.extract(&python_dir_clone).unwrap();
    }).await.map_err(|e| e.to_string())?;

    let pth_path = python_dir.join("python310._pth");
    if let Ok(mut content) = fs::read_to_string(&pth_path) {
        content = content.replace("#import site", "import site"); 
        fs::write(&pth_path, content).unwrap();
    }

    download_file(&window, "https://bootstrap.pypa.io/get-pip.py", &get_pip_path, "PIP Installer").await?;
    let _ = window.emit("install-log", "[SYSTEM] Initializing Library Manager...".to_string());
    
    let mut cmd_pip = Command::new(&python_exe);
    cmd_pip.arg(&get_pip_path);
    cmd_pip.args(["--no-color", "--no-warn-script-location"]);
    let _ = run_cmd_and_stream(&window, cmd_pip, "PIP").await; 

    if !python_dir.join("Scripts").join("pip.exe").exists() {
        return Err("Failed to create PIP core. Please disable your Antivirus or check disk permissions.".to_string());
    }
    
    let _ = window.emit("install-progress", 0);
    let _ = window.emit("install-log", format!("[SYSTEM] Fetching PyTorch Core (Mode: {}) - Refer to the progress bar below...", mode.to_uppercase()));
    let mut cmd_torch = Command::new(&python_exe);

    cmd_torch.args(["-m", "pip", "install", "--no-color", "--no-warn-script-location", "torch", "torchvision"]);
    if mode == "lite" { cmd_torch.args(["--index-url", "https://download.pytorch.org/whl/cpu"]); } 
    else { cmd_torch.args(["--index-url", "https://download.pytorch.org/whl/cu118"]); }
    
    let (tx, mut rx) = oneshot::channel();
    let w_heartbeat = window.clone();
    tokio::spawn(async move {
        let mut minutes = 0;
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(60)) => {
                    minutes += 1;
                    let _ = w_heartbeat.emit("install-log", format!("[SYSTEM] ... Background download in progress ({} minutes elapsed).", minutes));
                }
                _ = &mut rx => { break; }
            }
        }
    });

    run_cmd_and_stream(&window, cmd_torch, "TORCH").await?;
    let _ = tx.send(()); 

    let _ = window.emit("install-log", "[SYSTEM] Installing Mokuro Extraction Engine...".to_string());
    let mut cmd_mokuro = Command::new(&python_exe);
    cmd_mokuro.args(["-m", "pip", "install", "--no-color", "--no-warn-script-location", "mokuro"]);
    run_cmd_and_stream(&window, cmd_mokuro, "MOKURO").await?;

    let _ = fs::remove_file(py_zip_path);
    let _ = fs::remove_file(get_pip_path);

    let _ = window.emit("install-done", ());
    Ok(())
}

#[tauri::command]
async fn run_mokuro(window: Window, path: String) -> Result<(), String> {
    let normalized_path = path.trim_matches(|c| c == '"' || c == '\'').trim().to_string();
    let python_exe = get_engine_dir().join("python").join("python.exe");

    let mut cmd = Command::new(&python_exe);
    cmd.args(["-m", "mokuro", "--parent_dir", &normalized_path, "--disable_confirmation", "--ignore_errors"]);

    cmd.stdin(std::process::Stdio::null())
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped())
       .env("PYTHONUNBUFFERED", "1")
       .env("PYTHONUTF8", "1")
       .env("PYTHONIOENCODING", "utf-8");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    
    let pid = child.id().expect("Failed to get Mokuro PID");
    *ACTIVE_MOKURO_PID.lock().unwrap() = Some(pid);
    
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    let w_out = window.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        let mut current_line = String::new();
        while let Ok(n) = stdout.read(&mut buf).await {
            if n == 0 { break; }
            let text = String::from_utf8_lossy(&buf[..n]);
            for c in text.chars() {
                if c == '\n' || c == '\r' {
                    let trimmed = current_line.trim();
                    if !trimmed.is_empty() { let _ = w_out.emit("mokuro-log", format!("INFO: {}", trimmed)); }
                    current_line.clear();
                } else { current_line.push(c); }
            }
        }
    });

    let w_err = window.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        let mut current_line = String::new();
        while let Ok(n) = stderr.read(&mut buf).await {
            if n == 0 { break; }
            let text = String::from_utf8_lossy(&buf[..n]);
            for c in text.chars() {
                if c == '\n' || c == '\r' {
                    let trimmed = current_line.trim();
                    if !trimmed.is_empty() { let _ = w_err.emit("mokuro-log", format!("LOG: {}", trimmed)); }
                    current_line.clear();
                } else { current_line.push(c); }
            }
        }
    });

    let mut stop_rx = MOKURO_STOP_TX.subscribe();

    tokio::select! {
        status_res = child.wait() => {
            *ACTIVE_MOKURO_PID.lock().unwrap() = None;
            let status = status_res.map_err(|e| e.to_string())?;
            if status.success() { let _ = window.emit("mokuro-done", ()); } 
            else { let _ = window.emit("mokuro-log", "CRITICAL: Engine failed.".to_string()); }
        }
        _ = stop_rx.recv() => {
            kill_process_tree(pid);
            *ACTIVE_MOKURO_PID.lock().unwrap() = None;
            let _ = window.emit("mokuro-log", "CRITICAL: Mokuro execution was forcefully stopped.".to_string());
            let _ = window.emit("mokuro-stopped", ());
        }
    }
    Ok(())
}

#[tauri::command]
fn stop_mokuro() {
    let _ = MOKURO_STOP_TX.send(());
}

#[tauri::command]
fn list_volumes(parent_path: String) -> Result<Vec<String>, String> {
    let mut folders = Vec::new();
    if let Ok(entries) = fs::read_dir(&parent_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Ok(name) = entry.file_name().into_string() { folders.push(name); }
            }
        }
    }
    folders.sort();
    Ok(folders)
}

#[tauri::command]
fn create_volume(parent_path: String, name: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(name);
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_volume(parent_path: String, name: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(name);
    fs::remove_dir_all(path).map_err(|e| e.to_string())
}

fn are_images_similar(img1: &[u8], img2: &[u8]) -> bool {
    if img1.len() != img2.len() { return false; }
    let mut diff: i64 = 0;
    for i in (0..img1.len()).step_by(10) { diff += (img1[i] as i64 - img2[i] as i64).abs(); }
    let avg_diff = diff as f64 / (img1.len() / 10) as f64;
    avg_diff < 2.0
}

#[tauri::command]
async fn start_mining(window: Window, target_dir: String, delay_ms: u64) -> Result<(), String> {
    if Screen::all().map_err(|e| e.to_string())?.is_empty() { return Err("No display detected".into()); }
    
    let mut stop_rx = MINING_STOP_TX.subscribe();
    let mut enigo = Enigo::new();
    let mut page_count = 1;
    let mut previous_buffer: Vec<u8> = Vec::new();

    tokio::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(3000)) => {}
            _ = stop_rx.recv() => { 
                let _ = window.emit("mining-stopped", ());
                return; 
            }
        }

        loop {
            let capture_future = async {
                let screens = match Screen::all() { Ok(s) => s, Err(e) => { let _ = window.emit("mining-log", format!("FATAL: {}", e)); return false; } };
                let screen = match screens.first() { Some(s) => s, None => { let _ = window.emit("mining-log", "FATAL: No primary display detected."); return false; } };

                if let Ok(image) = screen.capture() {
                    let current_buffer = image.as_raw().clone();
                    if !previous_buffer.is_empty() && are_images_similar(&previous_buffer, &current_buffer) {
                        let _ = window.emit("mining-log", "DETECTED END OF VOLUME. Auto-stopping process.");
                        return false;
                    }
                    let file_path = Path::new(&target_dir).join(format!("page_{:04}.png", page_count));
                    if let Err(e) = image.save(&file_path) { let _ = window.emit("mining-log", format!("Save error: {}", e)); return false; }
                    let _ = window.emit("mining-log", format!("Captured page_{:04}.png", page_count));
                    previous_buffer = current_buffer;
                    page_count += 1;
                    enigo.key_click(Key::LeftArrow);
                    true
                } else { false }
            };

            if !capture_future.await { break; }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                _ = stop_rx.recv() => { break; }
            }
        }
        let _ = window.emit("mining-stopped", ());
    });
    Ok(())
}

#[tauri::command]
fn stop_mining() {
    let _ = MINING_STOP_TX.send(());
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_mokuro, install_engine, run_mokuro, stop_mokuro, list_volumes, create_volume, delete_volume, start_mining, stop_mining
        ])
        .on_window_event(|_window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let _ = MINING_STOP_TX.send(());
                if let Some(pid) = *ACTIVE_MOKURO_PID.lock().unwrap() {
                    kill_process_tree(pid);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri Architecture Panic");
}
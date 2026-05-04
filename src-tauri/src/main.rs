#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use enigo::{Enigo, Key, KeyboardControllable};
use lazy_static::lazy_static;
use screenshots::Screen;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

// Global flag to control the auto-mining macro
lazy_static! {
    static ref IS_MINING: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
}

// --- 1. MOKURO CORE ---
#[tauri::command]
// FIX: Modified to never fail. Returns a status string ("ready" or missing dependencies status) instead.
async fn check_mokuro() -> Result<String, String> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", "mokuro", "--version"]);
        c
    } else {
        let mut c = Command::new("mokuro");
        c.arg("--version");
        c
    };
    
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    
    cmd.env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8");

    match cmd.output().await {
        Ok(output) if output.status.success() => Ok("ready".to_string()),
        _ => Ok("missing_dependencies_mokuro".to_string()),
    }
}

#[tauri::command]
async fn run_mokuro(window: Window, path: String) -> Result<(), String> {
    let normalized_path = path.trim_matches(|c| c == '"' || c == '\'').trim().to_string();
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", "mokuro", "--parent_dir", &normalized_path]);
        c
    } else {
        let mut c = Command::new("mokuro");
        c.args(["--parent_dir", &normalized_path]);
        c
    };

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        tokio::spawn(async move { let _ = stdin.write_all(b"y\n").await; });
    }

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let w_out = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = w_out.emit("mokuro-log", format!("INFO: {}", line.trim_end()));
        }
    });

    let w_err = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = w_err.emit("mokuro-log", format!("LOG: {}", line.trim_end()));
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if status.success() {
        let _ = window.emit("mokuro-done", ());
    } else {
        let _ = window.emit("mokuro-log", "CRITICAL: Engine failed.".to_string());
    }
    Ok(())
}

// --- 2. FILE MANAGER ---
#[tauri::command]
fn list_volumes(parent_path: String) -> Result<Vec<String>, String> {
    let mut folders = Vec::new();
    if let Ok(entries) = fs::read_dir(&parent_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Ok(name) = entry.file_name().into_string() {
                    folders.push(name);
                }
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

// --- 3. AUTO MINER (MACRO) ---
fn are_images_similar(img1: &[u8], img2: &[u8]) -> bool {
    if img1.len() != img2.len() { return false; }
    let mut diff: i64 = 0;
    
    // Sample every 10 pixels to optimize CPU performance
    for i in (0..img1.len()).step_by(10) {
        diff += (img1[i] as i64 - img2[i] as i64).abs();
    }
    let avg_diff = diff as f64 / (img1.len() / 10) as f64;
    avg_diff < 2.0 // Static error threshold
}

#[tauri::command]
async fn start_mining(window: Window, target_dir: String, delay_ms: u64) -> Result<(), String> {
    // FIX: Optimized empty check, and added proper unwrap handling throughout.
    if Screen::all().map_err(|e| e.to_string())?.is_empty() {
        return Err("No display detected".into());
    }
    
    IS_MINING.store(true, Ordering::SeqCst);
    let mut enigo = Enigo::new();
    let mut page_count = 1;
    let mut previous_buffer: Vec<u8> = Vec::new();

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(3000)).await; // 3s buffer for user to press F11

        while IS_MINING.load(Ordering::SeqCst) {
            let screens = match Screen::all() {
                Ok(s) => s,
                Err(e) => {
                    let _ = window.emit("mining-log", format!("FATAL: Display API error - {}", e));
                    break;
                }
            };
            
            let screen = match screens.first() {
                Some(s) => s,
                None => {
                    let _ = window.emit("mining-log", "FATAL: No primary display detected mid-run.");
                    break;
                }
            };

            if let Ok(image) = screen.capture() {
                let current_buffer = image.as_raw().clone();

                if !previous_buffer.is_empty() && are_images_similar(&previous_buffer, &current_buffer) {
                    let _ = window.emit("mining-log", "DETECTED END OF VOLUME. Auto-stopping.");
                    break;
                }

                let file_path = Path::new(&target_dir).join(format!("page_{:04}.png", page_count));
                if let Err(e) = image.save(&file_path) {
                    let _ = window.emit("mining-log", format!("Save error: {}", e));
                    break;
                }

                let _ = window.emit("mining-log", format!("Captured page_{:04}.png", page_count));
                previous_buffer = current_buffer;
                page_count += 1;

                enigo.key_click(Key::LeftArrow);
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            } else {
                let _ = window.emit("mining-log", "Failed to capture screen.");
                break;
            }
        }
        IS_MINING.store(false, Ordering::SeqCst);
        let _ = window.emit("mining-stopped", ());
    });

    Ok(())
}

#[tauri::command]
fn stop_mining() {
    IS_MINING.store(false, Ordering::SeqCst);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_mokuro, run_mokuro, list_volumes, create_volume, delete_volume, start_mining, stop_mining
        ])
        .run(tauri::generate_context!())
        .expect("Tauri Architecture Panic");
}
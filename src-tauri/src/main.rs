#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::Stdio;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[tauri::command]
async fn check_mokuro() -> Result<(), String> {
    let mut cmd = Command::new("mokuro");
    cmd.arg("--version");
    
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // Ẩn console chớp lên trên Windows

    match cmd.output().await {
        Ok(output) if output.status.success() => Ok(()),
        _ => Err("Missing".into()),
    }
}

#[tauri::command]
async fn run_mokuro(window: Window, path: String) -> Result<(), String> {
    // Normalization: Sát thủ của mấy cái lỗi đường dẫn ngu ngốc trên Windows
    let normalized_path = path.trim_matches('"').trim().to_string();

    let mut cmd = Command::new("mokuro");
    cmd.arg(&normalized_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| format!("Process spawn failed: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to attach stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to attach stderr")?;

    let w_out = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = w_out.emit("mokuro-log", format!("INFO: {}", line));
        }
    });

    let w_err = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = w_err.emit("mokuro-log", format!("ERROR: {}", line));
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    
    if !status.success() {
        let _ = window.emit("mokuro-log", "CRITICAL: Extraction failed with non-zero exit code.".to_string());
    }
    
    let _ = window.emit("mokuro-done", ());
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![check_mokuro, run_mokuro])
        .run(tauri::generate_context!())
        .expect("Tauri architecture panic");
}
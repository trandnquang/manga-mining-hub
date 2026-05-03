#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::Stdio;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
async fn check_mokuro() -> Result<(), String> {
    let mut cmd = Command::new("mokuro");
    cmd.arg("--version");
    
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output().await {
        Ok(output) if output.status.success() => Ok(()),
        _ => Err("Mokuro không tồn tại trong PATH. Vui lòng chạy 'pip install mokuro'.".into()),
    }
}

#[tauri::command]
async fn run_mokuro(window: Window, path: String) -> Result<(), String> {
    // Normalization triệt để
    let normalized_path = path.trim_matches('"').to_string();

    let mut cmd = Command::new("mokuro");
    cmd.arg(&normalized_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn mokuro: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let window_out = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = window_out.emit("mokuro-log", format!("INFO: {}", line));
        }
    });

    let window_err = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = window_err.emit("mokuro-log", format!("ERROR: {}", line));
        }
    });

    // Đợi child process kết thúc (không block UI)
    let status = child.wait().await.map_err(|e| format!("Process wait error: {}", e))?;
    
    if !status.success() {
        let _ = window.emit("mokuro-log", "CRITICAL: Process exited with failure code.".to_string());
    }
    
    let _ = window.emit("mokuro-done", ());

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![check_mokuro, run_mokuro])
        .run(tauri::generate_context!())
        .expect("Lỗi khi khởi chạy Tauri application");
}
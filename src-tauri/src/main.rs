#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::Stdio;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[tauri::command]
async fn check_mokuro() -> Result<(), String> {
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
        Ok(output) if output.status.success() => Ok(()),
        _ => Err("mokuro CLI missing from PATH".into()),
    }
}

#[tauri::command]
async fn run_mokuro(window: Window, path: String, is_parent_dir: bool) -> Result<(), String> {
    let normalized_path = path.trim_matches(|c| c == '"' || c == '\'').trim().to_string();

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("mokuro");
        if is_parent_dir {
            c.arg("--parent_dir");
        }
        c.arg(&normalized_path);
        c
    } else {
        let mut c = Command::new("mokuro");
        if is_parent_dir {
            c.arg("--parent_dir");
        }
        c.arg(&normalized_path);
        c
    };

    // [BẮT BUỘC] Mở luồng Stdin để chuẩn bị bơm input giả
    cmd.stdin(Stdio::piped())
       .stdout(Stdio::piped())
       .stderr(Stdio::piped())
       .env("PYTHONUTF8", "1")
       .env("PYTHONIOENCODING", "utf-8");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| format!("Spawn execution failed: {}", e))?;

    // Lấy luồng Stdin và lập tức viết chữ "y" kèm phím Enter (\n) để tự động hóa Interactive Prompt
    if let Some(mut stdin) = child.stdin.take() {
        tokio::spawn(async move {
            let _ = stdin.write_all(b"y\n").await;
        });
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout stream")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr stream")?;

    let w_out = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let clean_line = line.trim_end_matches('\r');
            let _ = w_out.emit("mokuro-log", format!("INFO: {}", clean_line));
        }
    });

    let w_err = window.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let clean_line = line.trim_end_matches('\r');
            let _ = w_err.emit("mokuro-log", format!("LOG: {}", clean_line));
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    
    if !status.success() {
        let _ = window.emit("mokuro-log", "CRITICAL: Process exited with failure code.".to_string());
    }
    
    let _ = window.emit("mokuro-done", ());
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![check_mokuro, run_mokuro])
        .run(tauri::generate_context!())
        .expect("Tauri Architecture Panic");
}
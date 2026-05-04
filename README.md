# Manga Mining Hub v2.0.2

Manga Mining Hub is a professional, high-performance desktop application built with **Tauri v2**, **Rust**, and **React**. It provides a fully isolated, automated graphical interface for [Mokuro](https://github.com/kha-white/mokuro), allowing users to convert manga volumes into searchable, interactive `.mokuro` formats for Japanese language learning without any prior Python configuration.

## 📥 Installation (For Users)

You **do not** need to install Python, Node.js, or any developer tools to use this application. The app handles all AI engine configurations internally.

1. Go to the [Releases](../../releases/latest) page of this repository.
2. Download the latest installer file: `Manga.Mining.Hub_2.0.2_x64-setup.exe`.
3. Run the `.exe` file and follow the standard Windows installation steps.
4. Launch **Manga Mining Hub** from your desktop or start menu.

## 🚀 Features

- **Isolated AI Engine**: Automatically downloads and configures a standalone embedded Python environment. It installs `PyTorch` (CPU or CUDA 11.8) and `mokuro` into an isolated app-data directory, ensuring zero conflicts with your system's global PATH.
- **Smart Download Manager**: Displays real-time progress bars, connection heartbeats, and detailed byte streams during the 2.5GB PyTorch deployment.
- **Auto Miner Macro**: Built-in screenshot automation that detects the end of a volume through sub-pixel image diffing and intelligently stops itself.
- **Process Lifecycle Guard**: Employs Tokio Broadcast Channels and Windows `taskkill` hooks to completely eradicate zombie processes and prevent GPU VRAM memory leaks during forced shutdowns.
- **Modern Frameless UI**: A sleek, dark-themed interface built with React 18 and Tailwind CSS, featuring smart auto-scrolling terminal logs.

## 🙏 Acknowledgments

A massive thank you to [kha-white](https://github.com/kha-white) for developing the incredible [Mokuro](https://github.com/kha-white/mokuro) engine and maintaining the official [Mokuro Web Reader](https://reader.mokuro.app/). This project serves strictly as a streamlined desktop wrapper to make their groundbreaking OCR technology more accessible to the average user.

## 🛠 Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons.
- **Backend**: Rust, Tauri v2.
- **Concurrency**: Tokio (Multi-threaded Runtime, Broadcast Channels, Spawn Blocking).
- **Automation**: `enigo` (Input Simulation), `screenshots` (Display API).

## 📋 Requirements

### 1. Build Dependencies (For Developers Only)

- **Node.js**: v18.0 or higher.
- **Rust**: Latest stable version (installed via [rustup](https://rustup.rs/)).
- **Platform**: Currently compiled strictly for Windows (`x86_64-pc-windows-msvc`).

_(Note: End users do NOT need Python or Mokuro pre-installed. The app handles everything internally)._

### ⚙️ Installation & Development

1. Clone the repository

```bash
git clone [https://github.com/your-username/manga-mining-hub.git](https://github.com/your-username/manga-mining-hub.git)
cd manga-mining-hub
```

2. Install Frontend Dependencies

```bash
npm install
```

3. Run in Development Mode

```bash
npm run tauri dev
```

4. Build for Production

```bash
npm run tauri build
```

The compiled, standalone executable will be located in src-tauri/target/release/bundle.

## 📖 Usage Guide

1. **Launch**: Open the application. The system will detect if the isolated AI Engine exists in %LOCALAPPDATA%\manga-mining-hub\engine.

2. **Setup Engine**: If it's the first run, choose between Lite Mode (CPU) or Pro Mode (GPU - NVIDIA Required). Wait for the installation to complete.

3. **Import**: Drag and drop a parent folder containing manga images into the designated drop zone.

4. **Mine (Optional)**: If you are reading from a web source, use the Auto Mine feature to automatically flip pages and capture the volume to the active directory.

5. **Convert**: Click the "EXTRACT TEXT (MOKURO)" button.

6. **Monitor**: You can safely force stop the process at any time via the "FORCE STOP MOKURO" button without risking memory leaks.

7. **Read**: Once the process logs state it is complete, click "OPEN WEB READER" to view your interactive manga in the browser.

## 📄 **License**

This project is licensed under the MIT License.

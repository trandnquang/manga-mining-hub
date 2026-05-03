# Manga Mining Hub

Manga Mining Hub is a professional, high-performance desktop application built with **Tauri v2**, **Rust**, and **React**. It provides a streamlined graphical interface for [Mokuro](https://github.com/kha-white/mokuro), allowing users to convert manga volumes into searchable, interactive web formats for Japanese language learning.

## 🚀 Features

- **Modern Frameless UI**: A sleek, dark-themed interface designed for focus and minimal distractions.
- **Drag & Drop Workflow**: Easily import manga folders by dragging them directly into the application window.
- **Real-time Log Streaming**: Watch the conversion process in a built-in virtual terminal powered by non-blocking Async I/O.
- **Dependency Guard**: Automatic system check on boot to ensure `mokuro` is correctly configured in your system PATH.
- **Production-Ready Core**: Built with Rust's Tokio runtime to prevent application freezes and memory leaks during heavy OCR tasks.

## 🛠 Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons.
- **Backend**: Rust, Tauri v2 (Core, Shell & Window plugins).
- **Processing Engine**: Mokuro (Python-based OCR and Layout Analysis).
- **Communication**: Tauri IPC (Inter-Process Communication) with Event Streaming.

## 📋 Requirements

Before running or building the project, ensure your system meets the following requirements:

### 1. System Dependencies
- **Node.js**: v18.0 or higher.
- **Rust**: Latest stable version (installed via [rustup](https://rustup.rs/)).
- **Python**: v3.8 or higher.

### 2. Processing Tool (Mokuro)
The application requires the `mokuro` CLI to be installed and accessible globally in your system PATH.
```bash
pip install mokuro
```

### ⚙️ Installation & Development
1. Clone the repository
```bash
git clone [https://github.com/your-username/manga-mining-hub.git](https://github.com/your-username/manga-mining-hub.git)
cd manga-mining-hub
```

2. Install Frontend Dependencies
Ensure you install the required Tauri v2 plugins along with your frontend packages.

```bash
npm install
```

3. Initialize Backend Dependencies
If you haven't already, add the required Tauri plugins to your Rust backend:

```bash
cd src-tauri
cargo add tauri-plugin-shell tauri-plugin-window tokio -F tokio/rt-multi-thread
cd ..
```

4. Run in Development Mode
```bash
npm run tauri dev
```

5. Build for Production
```bash
npm run tauri build
```
The compiled, standalone executable will be located in src-tauri/target/release/bundle.

### 📖 Usage Guide
1. **Launch**: Open the application. The system will automatically verify if mokuro is ready.

2. **Import**: Drag and drop a folder containing manga images (JPEG/PNG) into the designated drop zone.

3. **Convert**: Click the "BẮT ĐẦU CONVERT" button.

4. **Monitor**: View the live terminal output to track the OCR and HTML generation progress.

5. **Read**: Once the process logs state it is complete, click "MỞ WEB READER" to view your interactive manga in the browser.

### 🔧 Troubleshooting
- **"SYSTEM HALTED: mokuro not found"**: Ensure Python's script directory is in your Windows Environment Variables (PATH). This is typically located at %AppData%\Python\Python3x\Scripts or your local virtual environment Scripts folder.

- **Blank Screen on Windows**: Ensure your system has the latest WebView2 Runtime installed.

- **Permission Errors**: If the process fails instantly, ensure the app has read/write access to the dropped folder.

## 📄 License
This project is licensed under the MIT License.
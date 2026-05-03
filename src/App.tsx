import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/plugin-window";
import { AlertCircle, FolderDown, Terminal, Loader2, ExternalLink, X, Minus } from "lucide-react";

type AppState = "booting" | "missing_deps" | "idle" | "processing" | "done";

const appWindow = getCurrentWindow();

export default function App() {
  const [status, setStatus] = useState<AppState>("booting");
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const bootCheck = async () => {
      try {
        await invoke("check_mokuro");
        setStatus("idle");
      } catch (e) {
        setStatus("missing_deps");
      }
    };
    bootCheck();
  }, []);

  // BẮT BUỘC: Đăng ký IPC listener ĐÚNG 1 LẦN để tránh Memory Leak
  useEffect(() => {
    let unlistenDrop: UnlistenFn;
    let unlistenLog: UnlistenFn;
    let unlistenDone: UnlistenFn;

    const setupListeners = async () => {
      // V2 Drag & Drop Event
      unlistenDrop = await listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
        setStatus((currentStatus) => {
          if (currentStatus !== "idle" && currentStatus !== "done") return currentStatus;
          setTargetPath(event.payload.paths[0]);
          return "idle";
        });
      });

      unlistenLog = await listen<string>("mokuro-log", (event) => {
        setLogs((prev) => [...prev, event.payload]);
      });

      unlistenDone = await listen("mokuro-done", () => {
        setStatus("done");
      });
    };

    setupListeners();

    return () => {
      if (unlistenDrop) unlistenDrop();
      if (unlistenLog) unlistenLog();
      if (unlistenDone) unlistenDone();
    };
  }, []);

  const handleProcess = async () => {
    if (!targetPath) return;
    setStatus("processing");
    setLogs([]);
    try {
      await invoke("run_mokuro", { path: targetPath });
    } catch (e) {
      setLogs((prev) => [...prev, `CRITICAL SYSTEM ERROR: ${e}`]);
      setStatus("done");
    }
  };

  const openReader = async () => {
    await open("https://reader.mokuro.app/");
  };

  if (status === "missing_deps") {
    return (
      <div className="h-screen w-screen bg-red-950 flex flex-col items-center justify-center text-red-200 p-6 select-none" data-tauri-drag-region>
        <div className="absolute top-4 right-4 flex gap-2 z-50">
           <button onClick={() => appWindow.close()} className="p-2 hover:bg-red-900 rounded transition-colors"><X size={18} /></button>
        </div>
        <AlertCircle size={64} className="mb-4 text-red-500" />
        <h1 className="text-2xl font-bold mb-2">HỆ THỐNG KHÔNG SẴN SÀNG</h1>
        <p className="text-center text-red-300/80">
          Không tìm thấy <code className="bg-red-900/50 px-2 py-1 rounded mx-1">mokuro</code> trong system PATH.<br />
          Mở Terminal/CMD và chạy: <code className="bg-red-900/50 px-2 py-1 rounded text-red-100 font-mono mt-2 inline-block">pip install mokuro</code>
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-200 flex flex-col font-sans overflow-hidden">
      <div data-tauri-drag-region className="h-10 shrink-0 flex justify-between items-center px-4 border-b border-slate-800 bg-slate-900/50 select-none">
        <span className="text-xs font-bold text-slate-500 tracking-wider pointer-events-none">MANGA MINING HUB</span>
        <div className="flex gap-1 z-50">
          <button onClick={() => appWindow.minimize()} className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"><Minus size={14} /></button>
          <button onClick={() => appWindow.close()} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"><X size={14} /></button>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden">
        <div className={`shrink-0 h-40 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-colors
          ${targetPath ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-slate-700 bg-slate-800/50'}
          ${(status === 'processing') && 'opacity-50 pointer-events-none'}`}
        >
          {targetPath ? (
            <div className="text-center px-4">
              <p className="text-indigo-400 font-medium mb-1">Đã nạp thư mục</p>
              <p className="text-xs text-slate-400 font-mono truncate max-w-md" title={targetPath}>{targetPath}</p>
            </div>
          ) : (
            <div className="text-center pointer-events-none">
              <FolderDown size={32} className="mx-auto mb-3 text-slate-500" />
              <p className="text-sm font-medium text-slate-400">Kéo thả thư mục truyện vào đây</p>
            </div>
          )}
        </div>

        {status !== "booting" && (
          <button
            disabled={!targetPath || status === "processing"}
            onClick={status === "done" ? openReader : handleProcess}
            className={`shrink-0 py-4 px-6 rounded-lg font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-3
              ${!targetPath ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 
                status === 'processing' ? 'bg-indigo-600/50 text-indigo-200 cursor-wait' :
                status === 'done' ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20' :
                'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20'
              }`}
          >
            {status === "processing" && <><Loader2 size={18} className="animate-spin" /> ĐANG XỬ LÝ...</>}
            {status === "idle" && "BẮT ĐẦU CONVERT"}
            {status === "done" && <><ExternalLink size={18} /> MỞ WEB READER</>}
          </button>
        )}

        <div className="flex-1 bg-black/60 border border-slate-800 rounded-xl p-4 font-mono text-xs overflow-y-auto flex flex-col">
          <div className="flex items-center gap-2 mb-3 text-slate-500 sticky top-0 bg-[#0f111a] pb-2 border-b border-slate-800/50 backdrop-blur-sm z-10">
            <Terminal size={14} /> System Logs
          </div>
          {logs.length === 0 ? (
            <span className="text-slate-600 italic">Waiting for execution...</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`mb-1 break-words ${log.startsWith("ERROR") || log.startsWith("CRITICAL") ? "text-red-400" : "text-slate-300"}`}>
                {log}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
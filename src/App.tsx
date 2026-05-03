import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, FolderDown, Terminal, Loader2, ExternalLink, X, Minus } from "lucide-react";

type AppState = "booting" | "missing_deps" | "idle" | "processing" | "done";

const appWindow = getCurrentWindow();

export default function App() {
  const [status, setStatus] = useState<AppState>("booting");
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    invoke("check_mokuro")
      .then(() => setStatus("idle"))
      .catch(() => setStatus("missing_deps"));
  }, []);

  useEffect(() => {
    let unlistenDrop: UnlistenFn;
    let unlistenLog: UnlistenFn;
    let unlistenDone: UnlistenFn;

    const setupIPC = async () => {
      unlistenDrop = await listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
        setStatus((prev) => {
          if (prev !== "idle" && prev !== "done") return prev;
          setTargetPath(e.payload.paths[0]);
          return "idle";
        });
      });

      unlistenLog = await listen<string>("mokuro-log", (e) => {
        setLogs((prev) => [...prev, e.payload]);
      });

      unlistenDone = await listen("mokuro-done", () => setStatus("done"));
    };

    setupIPC();

    return () => {
      if (unlistenDrop) unlistenDrop();
      if (unlistenLog) unlistenLog();
      if (unlistenDone) unlistenDone();
    };
  }, []);

  const handleExecute = async () => {
    if (!targetPath) return;
    setStatus("processing");
    setLogs(["[SYSTEM] Extractor engine ignited..."]);
    try {
      await invoke("run_mokuro", { path: targetPath });
    } catch (err) {
      setLogs((prev) => [...prev, `[FATAL] ${err}`]);
      setStatus("done");
    }
  };

  if (status === "missing_deps") {
    return (
      <div data-tauri-drag-region className="h-screen w-screen bg-rose-950 flex flex-col items-center justify-center p-8 select-none border border-rose-900 overflow-hidden">
        <button onClick={() => appWindow.close()} className="absolute top-4 right-4 p-2 text-rose-400 hover:text-white transition"><X size={18} /></button>
        <AlertCircle size={56} className="text-rose-500 mb-6" />
        <h1 className="text-xl font-bold text-white mb-2 tracking-widest uppercase">System Halted</h1>
        <p className="text-sm text-rose-300 font-medium">`mokuro` CLI is not found in system PATH.</p>
        <code className="mt-6 bg-black/60 text-rose-200 px-5 py-2.5 rounded font-mono text-xs shadow-inner">
          pip install mokuro
        </code>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-slate-900 flex flex-col text-slate-200 overflow-hidden font-sans select-none border border-slate-800">
      <div data-tauri-drag-region className="h-10 shrink-0 flex justify-between items-center px-4 bg-slate-950/80 border-b border-slate-800/80">
        <span className="text-[10px] font-bold tracking-[0.3em] text-slate-500 uppercase pointer-events-none">Manga Mining Hub</span>
        <div className="flex gap-4 z-50">
          <button onClick={() => appWindow.minimize()} className="text-slate-500 hover:text-slate-300 transition"><Minus size={14} /></button>
          <button onClick={() => appWindow.close()} className="text-slate-500 hover:text-rose-500 transition"><X size={14} /></button>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-6 gap-6">
        <div className={`h-36 shrink-0 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all duration-300
          ${targetPath ? "border-sky-500/50 bg-sky-500/5" : "border-slate-700 bg-slate-800/30"}
          ${status === "processing" ? "opacity-30 pointer-events-none" : ""}`}
        >
          {targetPath ? (
            <div className="text-center w-full px-6">
              <p className="text-sky-400 font-semibold text-sm tracking-widest uppercase mb-2">Target Acquired</p>
              <p className="text-[11px] text-slate-400 font-mono truncate bg-black/30 p-2 rounded">{targetPath}</p>
            </div>
          ) : (
            <div className="text-center pointer-events-none">
              <FolderDown size={32} strokeWidth={1.5} className="mx-auto mb-3 text-slate-500" />
              <p className="text-xs font-medium text-slate-400 tracking-widest uppercase">Drag & Drop Directory Here</p>
            </div>
          )}
        </div>

        {status !== "booting" && (
          <button
            disabled={!targetPath || status === "processing"}
            onClick={status === "done" ? () => openUrl("https://reader.mokuro.app/") : handleExecute}
            className={`h-12 shrink-0 rounded-lg font-bold text-xs tracking-[0.2em] uppercase transition-all flex items-center justify-center gap-3
              ${!targetPath ? "bg-slate-800/50 text-slate-600 cursor-not-allowed" : 
                status === "processing" ? "bg-sky-600/40 text-sky-200 cursor-wait" :
                status === "done" ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(5,150,105,0.2)]" :
                "bg-sky-600 hover:bg-sky-500 text-white shadow-[0_0_15px_rgba(2,132,199,0.3)]"
              }`}
          >
            {status === "processing" && <><Loader2 size={16} className="animate-spin" /> Executing</>}
            {status === "idle" && "Bắt Đầu Convert"}
            {status === "done" && <><ExternalLink size={16} /> Mở Web Reader</>}
          </button>
        )}

        <div className="flex-1 bg-[#090b0f] rounded-xl border border-slate-800/80 p-4 font-mono text-[11px] flex flex-col overflow-hidden shadow-inner relative">
          <div className="flex items-center gap-2 mb-3 text-slate-600 pb-2 border-b border-slate-800/50 shrink-0">
            <Terminal size={14} /> <span className="tracking-widest uppercase text-[10px]">Stdout Stream</span>
          </div>
          <div className="flex-1 overflow-y-auto pr-2 scrollbar-hide">
            {logs.length === 0 ? <span className="text-slate-700 italic">Awaiting instructions...</span> : 
              logs.map((log, i) => (
                <div key={i} className={`mb-1.5 leading-relaxed break-words ${log.includes("ERROR") || log.includes("FATAL") || log.includes("CRITICAL") ? "text-rose-400" : "text-slate-400"}`}>
                  {log}
                </div>
              ))
            }
            <div ref={terminalEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  FolderDown,
  Terminal,
  Loader2,
  ExternalLink,
  X,
  Minus,
  Layers,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

type AppState = "booting" | "missing_deps" | "idle" | "processing" | "done";

const appWindow = getCurrentWindow();

export default function App() {
  const [status, setStatus] = useState<AppState>("booting");
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [isParentDir, setIsParentDir] = useState<boolean>(true);
  const [logs, setLogs] = useState<string[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
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
      unlistenDrop = await appWindow.onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const path = event.payload.paths[0];
          if (path) {
            setStatus((prev) => {
              if (prev !== "idle" && prev !== "done") return prev;
              setTargetPath(path);
              return "idle";
            });
          }
        }
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

  const handleSelectFolder = async () => {
    if (status === "processing") return;
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Folder containing Manga",
      });
      if (selectedPath) {
        setTargetPath(selectedPath as string);
        setStatus("idle");
      }
    } catch (err) {
      console.error("Dialog error:", err);
    }
  };

  const handleExecute = async () => {
    if (!targetPath) return;
    setStatus("processing");
    setLogs([
      `[SYSTEM] Engine ignited. Parsing directory with UTF-8 bindings...`,
      `[SYSTEM] Injecting automated bypass for CLI confirmation prompt...`,
      `[CONFIG] Target: ${targetPath}`,
      `[CONFIG] Multi-volume Mode (--parent_dir): ${isParentDir ? "ENABLED" : "DISABLED"}`,
    ]);
    try {
      await invoke("run_mokuro", { path: targetPath, isParentDir });
    } catch (err) {
      setLogs((prev) => [...prev, `[FATAL] ${err}`]);
      setStatus("done");
    }
  };

  // Error Screen: Missing Deps
  if (status === "missing_deps") {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-rose-950 p-8 select-none border border-rose-900/50 rounded-xl relative">
        <div data-tauri-drag-region className="absolute inset-0 z-0" />
        <button
          onClick={() => appWindow.close()}
          className="absolute top-4 right-4 z-50 cursor-pointer p-2 text-rose-400 transition hover:text-white"
        >
          <X size={18} pointerEvents="none" />
        </button>
        <AlertCircle
          size={56}
          className="pointer-events-none z-10 mb-6 text-rose-500"
        />
        <h1 className="pointer-events-none z-10 mb-2 text-xl font-bold tracking-widest text-white uppercase">
          Mokuro Not Found
        </h1>
        <p className="pointer-events-none z-10 text-sm font-medium text-rose-300">
          System PATH does not contain the required CLI tool.
        </p>
        <code className="pointer-events-none z-10 mt-6 rounded bg-black/60 px-5 py-2.5 font-mono text-xs text-rose-200 shadow-inner">
          pip install mokuro
        </code>
      </div>
    );
  }

  // Main Screen
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 font-sans text-slate-200 shadow-2xl">
      {/* Titlebar using  data-tauri-drag-region */}
      <div
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950/50 px-5"
      >
        <span className="pointer-events-none text-xs font-bold tracking-[0.25em] text-slate-400 uppercase">
          Manga Mining Hub
        </span>
        <div className="z-50 flex gap-5">
          <button
            onClick={() => appWindow.minimize()}
            className="cursor-pointer text-slate-500 transition hover:text-slate-200"
          >
            <Minus size={16} pointerEvents="none" />
          </button>
          <button
            onClick={() => appWindow.close()}
            className="cursor-pointer text-slate-500 transition hover:text-rose-500"
          >
            <X size={16} pointerEvents="none" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 p-6 overflow-hidden">
        {/* Drop Zone */}
        <div
          onClick={handleSelectFolder}
          className={`flex h-32 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-300 cursor-pointer
          ${targetPath ? "border-sky-500/40 bg-sky-500/5 hover:bg-sky-500/10" : "border-slate-700/80 bg-slate-800/20 hover:border-slate-500 hover:bg-slate-800/40"}
          ${status === "processing" ? "pointer-events-none opacity-40 grayscale" : ""}`}
        >
          {targetPath ? (
            <div className="w-full px-8 text-center pointer-events-none">
              <p className="mb-3 text-xs font-bold tracking-[0.15em] text-sky-400 uppercase">
                Target Directory
              </p>
              <p
                className="truncate rounded-md bg-black/40 p-2.5 font-mono text-xs text-slate-300 border border-slate-800/50"
                title={targetPath}
              >
                {targetPath}
              </p>
            </div>
          ) : (
            <div className="pointer-events-none text-center">
              <FolderDown
                size={36}
                strokeWidth={1.2}
                className="mx-auto mb-4 text-slate-500"
              />
              <p className="text-sm font-semibold tracking-wider text-slate-400 uppercase">
                Drop Manga Directory Here
              </p>
            </div>
          )}
        </div>

        {/* Options Row */}
        <div
          className={`flex items-center justify-between px-2 ${status === "processing" ? "pointer-events-none opacity-40" : ""}`}
        >
          <div className="flex items-center gap-3">
            <Layers
              size={16}
              className={isParentDir ? "text-sky-400" : "text-slate-500"}
            />
            <span className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Multi-volume Mode
            </span>
          </div>
          <button
            onClick={() => setIsParentDir(!isParentDir)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isParentDir ? "bg-sky-500" : "bg-slate-700"}`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isParentDir ? "translate-x-5" : "translate-x-1"}`}
            />
          </button>
        </div>

        {/* Action Button */}
        {status !== "booting" && (
          <button
            disabled={!targetPath || status === "processing"}
            onClick={
              status === "done"
                ? () => openUrl("https://reader.mokuro.app/")
                : handleExecute
            }
            className={`flex h-12 shrink-0 cursor-pointer items-center justify-center gap-3 rounded-xl text-sm font-bold tracking-[0.2em] uppercase transition-all duration-300
              ${
                !targetPath
                  ? "cursor-not-allowed bg-slate-800/40 text-slate-500"
                  : status === "processing"
                    ? "cursor-wait bg-sky-700/50 text-sky-200"
                    : status === "done"
                      ? "bg-emerald-600 text-white shadow-[0_0_20px_rgba(5,150,105,0.25)] hover:bg-emerald-500"
                      : "bg-sky-600 text-white shadow-[0_0_20px_rgba(2,132,199,0.3)] hover:bg-sky-500"
              }`}
          >
            {status === "processing" && (
              <>
                <Loader2 size={18} className="animate-spin" /> Processing...
              </>
            )}
            {status === "idle" && "Start Convert"}
            {status === "done" && (
              <>
                <ExternalLink size={18} /> Open Web Reader
              </>
            )}
          </button>
        )}

        {/* Terminal */}
        <div className="relative flex h-48 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-800/60 bg-[#0a0d14] p-5 font-mono text-xs shadow-inner">
          <div className="mb-4 flex shrink-0 select-none items-center gap-2 border-b border-slate-800/60 pb-3 text-slate-500">
            <Terminal size={14} />
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase">
              Process Output
            </span>
          </div>
          <div className="flex-1 overflow-y-auto pr-2 text-left leading-relaxed">
            {logs.length === 0 ? (
              <span className="select-none text-slate-600/70 italic">
                Waiting for execution...
              </span>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={`mb-2 break-words ${log.includes("ERROR") || log.includes("FATAL") || log.includes("CRITICAL") ? "text-rose-400" : "text-slate-300"}`}
                >
                  {log}
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

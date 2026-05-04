import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  FolderDown,
  Terminal,
  Loader2,
  ExternalLink,
  X,
  Minus,
  Folder,
  Camera,
  StopCircle,
  Plus,
  Trash2,
} from "lucide-react";

// NEW: Added 'checking_deps' as the initial state to fix the initial delay
type AppState =
  | "checking_deps"
  | "missing_deps"
  | "select_parent"
  | "manage_volumes"
  | "mining"
  | "processing_mokuro"
  | "done";

const appWindow = getCurrentWindow();

export default function App() {
  const [status, setStatus] = useState<AppState>("checking_deps"); // NEW: Initialize to checking_deps
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<string[]>([]);
  const [activeVol, setActiveVol] = useState<string | null>(null);
  const [delay, setDelay] = useState<number>(1500);
  const [logs, setLogs] = useState<string[]>([]);
  const [newVolName, setNewVolName] = useState("");
  // NEW: State for drag over feedback
  const [isDragging, setIsDragging] = useState(false);
  // NEW: Ref for terminal log list
  const terminalLogRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // FIX: System output now always automatically scrolls to the last line, instantly.
  useEffect(() => {
    if (terminalLogRef.current) {
      terminalLogRef.current.scrollTop = terminalLogRef.current.scrollHeight;
    }
    // Alternatively, using the EndRef:
    // terminalEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [logs]);

  // FIX: check_mokuro is now called immediately to avoid initial delay.
  // IPC listeners are updated based on status changes.
  useEffect(() => {
    // 1. Initial boot check
    if (status === "checking_deps") {
      invoke<string>("check_mokuro")
        .then((res) => {
          if (res === "ready") {
            setStatus("select_parent");
          } else {
            setStatus("missing_deps");
          }
        })
        .catch(() => setStatus("missing_deps")); // Fallback
    }

    // 2. Setup IPC listeners
    let unlistenDrop: UnlistenFn;
    let unlistenMokuroLog: UnlistenFn;
    let unlistenMiningLog: UnlistenFn;
    let unlistenMiningStop: UnlistenFn;
    let unlistenMokuroDone: UnlistenFn;

    const setupIPC = async () => {
      // NEW: Added drag over/leave event handlers for visual feedback
      unlistenDrop = await appWindow.onDragDropEvent((event) => {
        if (event.payload.type === "enter") {
          setIsDragging(true);
        } else if (event.payload.type === "leave") {
          setIsDragging(false);
        } else if (
          event.payload.type === "drop" &&
          (status === "select_parent" || status === "manage_volumes")
        ) {
          setIsDragging(false);
          handleSetParentDir(event.payload.paths[0]);
        }
      });
      unlistenMokuroLog = await listen<string>("mokuro-log", (e) =>
        setLogs((p) => [...p, e.payload]),
      );
      unlistenMiningLog = await listen<string>("mining-log", (e) =>
        setLogs((p) => [...p, `[MINER] ${e.payload}`]),
      );
      unlistenMiningStop = await listen("mining-stopped", () =>
        setStatus("manage_volumes"),
      );
      // unlistenMokuroDone sets status to done, handled in the return path.
      unlistenMokuroDone = await listen("mokuro-done", () => setStatus("done"));
    };
    setupIPC();

    return () => {
      if (unlistenDrop) unlistenDrop();
      if (unlistenMokuroLog) unlistenMokuroLog();
      if (unlistenMiningLog) unlistenMiningLog();
      if (unlistenMiningStop) unlistenMiningStop();
      if (unlistenMokuroDone) unlistenMokuroDone();
    };
  }, [status]); // Keeping status to refresh drop listener based on context

  const handleSetParentDir = async (path: string) => {
    setParentDir(path);
    loadVolumes(path);
    setStatus("manage_volumes");
  };

  const loadVolumes = async (path: string) => {
    try {
      const folders: string[] = await invoke("list_volumes", {
        parentPath: path,
      });
      setVolumes(folders);
    } catch (e) {
      setLogs((p) => [...p, `[ERROR] Failed to load volumes: ${e}`]);
    }
  };

  const handleCreateVol = async () => {
    if (!newVolName || !parentDir) return;
    try {
      await invoke("create_volume", {
        parentPath: parentDir,
        name: newVolName,
      });
      setNewVolName("");
      loadVolumes(parentDir);
    } catch (e) {
      setLogs((p) => [...p, `[ERROR] Create failed: ${e}`]);
    }
  };

  const handleDeleteVol = async (name: string) => {
    if (!parentDir) return;
    try {
      await invoke("delete_volume", { parentPath: parentDir, name });
      if (activeVol === name) setActiveVol(null);
      loadVolumes(parentDir);
    } catch (e) {
      setLogs((p) => [...p, `[ERROR] Delete failed: ${e}`]);
    }
  };

  const startMining = async () => {
    if (!parentDir || !activeVol) return;
    setStatus("mining");
    const targetDir = `${parentDir}\\${activeVol}`;
    setLogs([
      "[SYSTEM] Auto-miner starting in 3 seconds. GO FULLSCREEN NOW (F11).",
      `[TARGET] ${targetDir}`,
    ]);
    try {
      await invoke("start_mining", { targetDir, delayMs: delay });
    } catch (err) {
      setLogs((p) => [...p, `[FATAL] ${err}`]);
      setStatus("manage_volumes");
    }
  };

  const stopMining = async () => {
    await invoke("stop_mining");
    setLogs((p) => [...p, "[SYSTEM] Mining force stopped by user."]);
  };

  const startMokuro = async () => {
    if (!parentDir) return;
    setStatus("processing_mokuro");
    setLogs(["[SYSTEM] Mokuro Extractor ignited...", `[TARGET] ${parentDir}`]);
    try {
      await invoke("run_mokuro", { path: parentDir });
    } catch (err) {
      setLogs((p) => [...p, `[FATAL] ${err}`]);
      // Return to manage_volumes on error. The "done" view is just an overlay.
      setStatus("manage_volumes");
    }
  };

  // UI Components
  const TitleBar = () => (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-4"
    >
      <span className="pointer-events-none text-[10px] font-bold tracking-[0.3em] text-slate-500 uppercase">
        {status === "mining"
          ? "⚠️ AUTO MINING IN PROGRESS"
          : "Manga Mining Hub 2.0"}
      </span>
      <div className="z-50 flex gap-4">
        {/* ADDED: cursor-pointer to minimize/close buttons */}
        <button
          onClick={() => appWindow.minimize()}
          className="text-slate-500 hover:text-white cursor-pointer"
        >
          <Minus size={14} pointerEvents="none" />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="text-slate-500 hover:text-rose-500 cursor-pointer"
        >
          <X size={14} pointerEvents="none" />
        </button>
      </div>
    </div>
  );

  const TerminalBox = () => (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#090b0f] p-4 font-mono text-[11px] shadow-inner mt-4 min-h-[150px]">
      <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-slate-800/50 pb-2 text-slate-600">
        <Terminal size={14} />{" "}
        <span className="text-[10px] uppercase">System Output</span>
      </div>
      {/* NEW: Added terminalLogRef to the scrolling div */}
      <div
        ref={terminalLogRef}
        className="flex-1 overflow-y-auto pr-2 text-left"
      >
        {logs.map((log, i) => (
          <div
            key={i}
            className={`mb-1 ${log.includes("ERROR") || log.includes("FATAL") ? "text-rose-400" : log.includes("MINER") ? "text-emerald-400" : "text-slate-400"}`}
          >
            {log}
          </div>
        ))}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );

  if (status === "checking_deps")
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 font-sans text-slate-200">
        <TitleBar />
        <div className="flex-1 flex flex-col items-center justify-center">
          <Loader2 size={32} className="animate-spin text-sky-400 mb-4" />
          <p className="text-sm text-slate-400 italic">
            Checking mokuro dependencies...
          </p>
        </div>
      </div>
    );

  if (status === "missing_deps")
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-rose-950 p-8 select-none border border-rose-900 rounded-lg">
        <TitleBar />
        <div className="flex flex-1 flex-col items-center justify-center">
          <AlertCircle size={56} className="mb-4 text-rose-500" />
          <h1 className="text-xl font-bold tracking-widest text-white uppercase">
            System Halted
          </h1>
          <p className="text-sm font-medium text-rose-300">
            `mokuro` CLI is missing.
          </p>
          <code className="mt-4 rounded bg-black/60 px-4 py-2 font-mono text-xs text-rose-200">
            pip install mokuro
          </code>
        </div>
      </div>
    );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 font-sans text-slate-200">
      <TitleBar />
      <div className="flex flex-1 flex-col p-5 overflow-hidden relative">
        {/* NEW: Overlay for 'done' state to prevent dead end. Allows return to manage_volumes. */}
        {status === "done" && (
          <div className="absolute inset-5 flex flex-col items-center justify-center bg-sky-950/80 rounded-xl z-20 gap-4 border border-sky-500/50 shadow-[0_0_30px_rgba(2,132,199,0.4)]">
            <p className="text-sm font-bold text-sky-200 uppercase tracking-wider">
              Text extraction completed!
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => openUrl("https://reader.mokuro.app/")}
                className="p-3 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold text-xs uppercase tracking-wider cursor-pointer"
              >
                <ExternalLink size={16} /> OPEN WEB READER
              </button>
              <button
                onClick={() => setStatus("manage_volumes")}
                className="p-3 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded font-bold text-xs uppercase tracking-wider cursor-pointer"
              >
                RETURN TO VOLUME MANAGER
              </button>
            </div>
          </div>
        )}

        {/* VIEW 1: SELECT PARENT FOLDER */}
        {status === "select_parent" && (
          // MODIFIED: Updated class for drag feedback. Sáng border và phần trong.
          <div
            className={`flex flex-1 flex-col items-center justify-center border-2 border-dashed ${isDragging ? "border-sky-500/80 bg-sky-900/10" : "border-slate-700 bg-slate-800/30"} rounded-xl ${status === "select_parent" && "hover:border-sky-500/50 hover:bg-sky-900/5 transition-all"} cursor-pointer`}
            onClick={async () => {
              const path = await open({ directory: true });
              if (path) handleSetParentDir(path as string);
            }}
          >
            <FolderDown
              size={40}
              className={`mb-4 ${isDragging ? "text-sky-400" : "text-slate-500"}`}
            />
            <p className="text-sm font-bold tracking-widest text-slate-400 uppercase">
              Select Manga Parent Folder
            </p>
            <p className="text-xs text-slate-600 mt-2">
              Drag & drop or click to browse
            </p>
          </div>
        )}

        {/* VIEW 2: MANAGE VOLUMES & MINING */}
        {status !== "select_parent" && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 mb-4 bg-slate-950/50 p-3 rounded-lg border border-slate-800">
              {/* MODIFIED: Changed ArrowLeft to Folder, and added cursor-pointer with hover effect */}
              <button
                onClick={() => setStatus("select_parent")}
                disabled={status !== "manage_volumes"}
                className="p-1 hover:bg-sky-800/50 rounded transition-colors disabled:opacity-30 cursor-pointer text-slate-200"
              >
                <Folder size={16} />
              </button>
              <div className="flex-1 truncate font-mono text-xs text-sky-400">
                {parentDir}
              </div>
            </div>

            {/* Grid Layout: Left (Volumes) / Right (Controls) */}
            <div className="flex gap-4 h-48 shrink-0">
              {/* Volume List */}
              <div className="w-1/2 flex flex-col border border-slate-800 rounded-lg overflow-hidden bg-slate-950/30">
                <div className="flex items-center justify-between p-2 border-b border-slate-800 bg-slate-900">
                  <input
                    value={newVolName}
                    onChange={(e) => setNewVolName(e.target.value)}
                    placeholder="New vol name..."
                    className="bg-transparent text-xs outline-none w-full"
                    disabled={status !== "manage_volumes"}
                  />
                  {/* ADDED: cursor-pointer to plus button */}
                  <button
                    onClick={handleCreateVol}
                    disabled={status !== "manage_volumes"}
                    className="text-emerald-500 hover:text-emerald-400 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {volumes.length === 0 ? (
                    <p className="text-xs text-slate-600 italic text-center mt-4">
                      No volumes found
                    </p>
                  ) : (
                    volumes.map((v) => (
                      // MODIFIED: Explicit cursor-pointer and bright sky hover
                      <div
                        key={v}
                        onClick={() =>
                          status === "manage_volumes" && setActiveVol(v)
                        }
                        className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs transition-colors ${activeVol === v ? "bg-sky-900/50 text-sky-200" : "hover:bg-sky-800/50 text-slate-400"}`}
                      >
                        <div className="flex items-center gap-2">
                          <Folder size={14} /> {v}
                        </div>
                        {/* ADDED: cursor-pointer to delete button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteVol(v);
                          }}
                          disabled={status !== "manage_volumes"}
                          className="text-slate-600 hover:text-rose-500 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="w-1/2 flex flex-col gap-3">
                {status === "mining" ? (
                  <div className="flex flex-1 flex-col items-center justify-center border border-rose-900/50 bg-rose-950/20 rounded-lg p-4 text-center">
                    <Loader2
                      size={32}
                      className="animate-spin text-rose-500 mb-2"
                    />
                    <p className="text-xs font-bold text-rose-400 mb-4 tracking-widest">
                      MINING RUNNING
                    </p>
                    {/* ADDED: cursor-pointer to force stop button */}
                    <button
                      onClick={stopMining}
                      className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white p-3 rounded font-bold text-xs uppercase tracking-wider cursor-pointer"
                    >
                      <StopCircle size={16} /> Force Stop
                    </button>
                    <p className="text-[10px] text-slate-500 mt-3 italic">
                      Tip: Alt+Tab back here to stop
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col gap-3 bg-slate-950/30 border border-slate-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-400 uppercase">
                        Capture Delay (ms)
                      </span>
                      <input
                        type="number"
                        value={delay}
                        onChange={(e) => setDelay(Number(e.target.value))}
                        disabled={status !== "manage_volumes"}
                        className="w-20 bg-slate-900 border border-slate-700 rounded p-1 text-xs text-center outline-none text-sky-300"
                      />
                    </div>
                    {/* ADDED: cursor-pointer to auto mine button */}
                    <button
                      disabled={!activeVol || status !== "manage_volumes"}
                      onClick={startMining}
                      className={`flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-sky-400 rounded font-bold text-xs uppercase tracking-wider transition-colors ${activeVol && status === "manage_volumes" && "cursor-pointer"}`}
                    >
                      <Camera size={16} /> Auto Mine ({activeVol || "None"})
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Global Actions */}
            {/* MODIFIED: Changed the Done case. A return button is provided in an overlay now. */}
            {(status === "manage_volumes" ||
              status === "processing_mokuro") && (
              <button
                disabled={
                  volumes.length === 0 || status === "processing_mokuro"
                }
                onClick={startMokuro}
                className={`mt-4 h-12 shrink-0 flex items-center justify-center gap-3 rounded-xl text-xs font-bold tracking-[0.2em] uppercase transition-all duration-300
                  ${
                    volumes.length === 0
                      ? "bg-slate-800/50 text-slate-600 cursor-not-allowed"
                      : status === "processing_mokuro"
                        ? "bg-emerald-900/50 text-emerald-200 cursor-wait"
                        : "bg-emerald-600 text-white shadow-[0_0_15px_rgba(5,150,105,0.2)] hover:bg-emerald-500 cursor-pointer"
                  }`}
              >
                {status === "processing_mokuro" && (
                  <>
                    <Loader2 size={16} className="animate-spin" /> CONVERTING
                    ALL VOLS...
                  </>
                )}
                {status === "manage_volumes" && "EXTRACT TEXT (MOKURO)"}
              </button>
            )}

            <TerminalBox />
          </div>
        )}
      </div>
    </div>
  );
}

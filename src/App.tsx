import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderDown,
  Terminal,
  Loader2,
  X,
  Minus,
  Folder,
  Camera,
  StopCircle,
  Plus,
  Trash2,
  Cpu,
  Zap,
} from "lucide-react";

type AppState =
  | "checking_deps"
  | "setup_engine"
  | "installing"
  | "select_parent"
  | "manage_volumes"
  | "mining"
  | "processing_mokuro"
  | "done";

const appWindow = getCurrentWindow();

const scrollbarStyles =
  "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[#090b0f] [&::-webkit-scrollbar-thumb]:bg-slate-700 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500 [&::-webkit-scrollbar-thumb]:rounded-full";

export default function App() {
  const [status, setStatus] = useState<AppState>("checking_deps");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<string[]>([]);
  const [activeVol, setActiveVol] = useState<string | null>(null);
  const [delay, setDelay] = useState<number>(1500);
  const [logs, setLogs] = useState<string[]>([]);
  const [installProgress, setInstallProgress] = useState(0);
  const [newVolName, setNewVolName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const [autoScroll, setAutoScroll] = useState(true);

  const terminalLogRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (autoScroll && terminalLogRef.current) {
      terminalLogRef.current.scrollTop = terminalLogRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleTerminalScroll = () => {
    if (!terminalLogRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalLogRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  useEffect(() => {
    if (status === "checking_deps") {
      invoke<string>("check_mokuro")
        .then((res) =>
          setStatus(res === "ready" ? "select_parent" : "setup_engine"),
        )
        .catch(() => setStatus("setup_engine"));
    }
  }, [status]);

  useEffect(() => {
    let unlistenFns: UnlistenFn[] = [];
    let isMounted = true;

    const setupIPC = async () => {
      const drop = await appWindow.onDragDropEvent((event) => {
        if (!isMounted) return;
        if (event.payload.type === "enter") setIsDragging(true);
        else if (event.payload.type === "leave") setIsDragging(false);
        else if (
          event.payload.type === "drop" &&
          (statusRef.current === "select_parent" ||
            statusRef.current === "manage_volumes")
        ) {
          setIsDragging(false);
          handleSetParentDir(event.payload.paths[0]);
        }
      });

      const log = await listen<string>("install-log", (e) => {
        if (isMounted) setLogs((p) => [...p.slice(-500), e.payload]);
      });
      const prog = await listen<number>("install-progress", (e) => {
        if (isMounted) setInstallProgress(e.payload);
      });
      const done = await listen("install-done", () => {
        if (!isMounted) return;
        setLogs((p) => [
          ...p.slice(-500),
          "[SYSTEM] AI Engine Initialization Complete!",
        ]);
        setTimeout(() => setStatus("select_parent"), 1500);
      });
      const mLog = await listen<string>("mokuro-log", (e) => {
        if (isMounted) setLogs((p) => [...p.slice(-500), e.payload]);
      });

      const mStop = await listen("mokuro-stopped", () => {
        if (isMounted) setStatus("manage_volumes");
      });

      const minLog = await listen<string>("mining-log", (e) => {
        if (isMounted)
          setLogs((p) => [...p.slice(-500), `[MINER] ${e.payload}`]);
      });
      const minStop = await listen("mining-stopped", () => {
        if (isMounted) setStatus("manage_volumes");
      });
      const mDone = await listen("mokuro-done", () => {
        if (isMounted) setStatus("done");
      });

      unlistenFns.push(
        drop,
        log,
        prog,
        done,
        mLog,
        mStop,
        minLog,
        minStop,
        mDone,
      );
    };

    setupIPC();
    return () => {
      isMounted = false;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

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
      setLogs((p) => [
        ...p.slice(-500),
        `[ERROR] Failed to load volumes: ${e}`,
      ]);
    }
  };
  const handleCreateVol = async () => {
    if (!newVolName || !parentDir) return;
    await invoke("create_volume", { parentPath: parentDir, name: newVolName });
    setNewVolName("");
    loadVolumes(parentDir);
  };
  const handleDeleteVol = async (name: string) => {
    if (!parentDir) return;
    await invoke("delete_volume", { parentPath: parentDir, name });
    if (activeVol === name) setActiveVol(null);
    loadVolumes(parentDir);
  };

  const startMining = async () => {
    if (!parentDir || !activeVol) return;
    setStatus("mining");
    setLogs((p) => [
      ...p.slice(-500),
      "[SYSTEM] Auto-miner starting. SWITCH TO FULLSCREEN NOW (F11).",
    ]);
    await invoke("start_mining", {
      targetDir: `${parentDir}\\${activeVol}`,
      delayMs: delay,
    });
  };

  const startMokuro = async () => {
    if (!parentDir) return;
    setStatus("processing_mokuro");
    setLogs((p) => [
      ...p.slice(-500),
      "[SYSTEM] Mokuro Extraction Engine Ignited...",
    ]);
    try {
      await invoke("run_mokuro", { path: parentDir });
    } catch (err) {
      setLogs((p) => [...p.slice(-500), `[FATAL] ${err}`]);
      setStatus("manage_volumes");
    }
  };

  const TitleBar = () => (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-4"
    >
      <span className="pointer-events-none text-[10px] font-bold tracking-[0.3em] text-slate-500 uppercase">
        Manga Mining Hub
      </span>
      <div className="z-50 flex gap-4">
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
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#090b0f] p-4 font-mono text-[11px] shadow-inner mt-4 min-h-0">
      <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-slate-800/50 pb-2 text-slate-600">
        <Terminal size={14} />{" "}
        <span className="text-[10px] uppercase">System Output</span>
        {!autoScroll && (
          <button
            onClick={() => setAutoScroll(true)}
            className="ml-auto flex items-center gap-1 text-sky-400 hover:text-sky-300 font-bold text-[9px] uppercase tracking-wider bg-sky-900/30 px-2 py-0.5 rounded cursor-pointer"
          >
            ↓ Scroll to bottom
          </button>
        )}
      </div>
      <div
        ref={terminalLogRef}
        onScroll={handleTerminalScroll}
        className={`flex-1 overflow-y-auto pr-2 text-left ${scrollbarStyles}`}
      >
        {logs.map((log, i) => (
          <div
            key={i}
            className={`mb-1 ${log.includes("ERR") || log.includes("FATAL") || log.includes("CRITICAL") ? "text-rose-400" : log.includes("DOWNLOAD") ? "text-sky-400" : "text-slate-400"}`}
          >
            {log}
          </div>
        ))}
      </div>
    </div>
  );

  if (status === "checking_deps")
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-900">
        <TitleBar />
        <div className="flex-1 flex flex-col items-center justify-center">
          <Loader2 size={32} className="animate-spin text-sky-400 mb-4" />
        </div>
      </div>
    );

  if (status === "setup_engine" || status === "installing")
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-200">
        <TitleBar />
        <div className="flex flex-1 flex-col items-center justify-center p-8 min-h-0">
          <h1 className="text-2xl font-bold tracking-widest text-sky-400 uppercase mb-2 shrink-0">
            Init AI Engine
          </h1>
          <p className="text-sm text-slate-400 mb-8 max-w-md text-center shrink-0">
            Requires installation of the Image and Language processing
            environment (PyTorch).
          </p>
          {status === "setup_engine" ? (
            <div className="flex gap-6 w-full max-w-2xl shrink-0">
              <div className="flex-1 flex flex-col items-center border border-slate-700 bg-slate-900 rounded-xl p-6 hover:border-sky-500 transition-colors">
                <Cpu size={32} className="text-sky-400 mb-3" />
                <h2 className="text-lg font-bold text-white mb-2">
                  Lite Mode (CPU)
                </h2>
                <p className="text-xs text-slate-400 text-center mb-4 flex-1">
                  Slower processing speed. Recommended for laptops without a
                  dedicated NVIDIA GPU.
                </p>
                <button
                  onClick={() => {
                    setStatus("installing");
                    setInstallProgress(0);
                    invoke("install_engine", { mode: "lite" }).catch((err) => {
                      setLogs((p) => [
                        ...p.slice(-500),
                        `[FATAL ERROR] Installation failed: ${err}`,
                      ]);
                      setStatus("setup_engine");
                    });
                  }}
                  className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded font-bold text-xs uppercase cursor-pointer"
                >
                  Install CPU Engine
                </button>
              </div>
              <div className="flex-1 flex flex-col items-center border border-emerald-900/50 bg-emerald-950/20 rounded-xl p-6 hover:border-emerald-500 transition-colors">
                <Zap size={32} className="text-emerald-400 mb-3" />
                <h2 className="text-lg font-bold text-emerald-400 mb-2">
                  Pro Mode (GPU)
                </h2>
                <p className="text-xs text-slate-400 text-center mb-4 flex-1">
                  Maximum performance utilizing CUDA 11.8 cores. Requires a
                  dedicated NVIDIA GPU.
                </p>
                <button
                  onClick={() => {
                    setStatus("installing");
                    setInstallProgress(0);
                    invoke("install_engine", { mode: "pro" }).catch((err) => {
                      setLogs((p) => [
                        ...p.slice(-500),
                        `[FATAL ERROR] Installation failed: ${err}`,
                      ]);
                      setStatus("setup_engine");
                    });
                  }}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs uppercase cursor-pointer"
                >
                  Install GPU Engine
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full h-full max-w-3xl flex flex-col min-h-0">
              <div className="w-full bg-slate-800 rounded-full h-2 mb-2 overflow-hidden shrink-0">
                <div
                  className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${installProgress}%` }}
                ></div>
              </div>
              <TerminalBox />
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 font-sans text-slate-200">
      <TitleBar />
      <div className="flex flex-1 flex-col p-5 overflow-hidden relative">
        {status === "done" && (
          <div className="absolute inset-5 flex flex-col items-center justify-center bg-sky-950/90 rounded-xl z-20 gap-4 border border-sky-500/50">
            <p className="text-sm font-bold text-sky-200 uppercase tracking-wider">
              Extraction Completed!
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => openUrl("https://reader.mokuro.app/")}
                className="p-3 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold text-xs uppercase cursor-pointer"
              >
                OPEN WEB READER
              </button>
              <button
                onClick={() => setStatus("manage_volumes")}
                className="p-3 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded font-bold text-xs uppercase cursor-pointer"
              >
                BACK TO VOLUMES
              </button>
            </div>
          </div>
        )}

        {status === "select_parent" && (
          <div
            className={`flex flex-1 flex-col items-center justify-center border-2 border-dashed ${isDragging ? "border-sky-500/80 bg-sky-900/10" : "border-slate-700 bg-slate-800/30"} rounded-xl cursor-pointer`}
            onClick={async () => {
              const path = await open({ directory: true });
              if (path) handleSetParentDir(path as string);
            }}
          >
            <FolderDown size={40} className="mb-4 text-sky-400" />
            <p className="text-sm font-bold tracking-widest text-slate-400 uppercase">
              Select Manga Parent Folder
            </p>
          </div>
        )}

        {status !== "select_parent" && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 mb-4 bg-slate-950/50 p-3 rounded-lg border border-slate-800 shrink-0">
              <button
                onClick={() => setStatus("select_parent")}
                disabled={status !== "manage_volumes"}
                className="p-1 hover:bg-sky-800/50 rounded cursor-pointer text-slate-200"
              >
                <Folder size={16} />
              </button>
              <div className="flex-1 truncate font-mono text-xs text-sky-400">
                {parentDir}
              </div>
            </div>

            <div className="flex gap-4 h-48 shrink-0">
              <div className="w-1/2 flex flex-col border border-slate-800 rounded-lg overflow-hidden bg-slate-950/30">
                <div className="flex items-center justify-between p-2 border-b border-slate-800 bg-slate-900">
                  <input
                    value={newVolName}
                    onChange={(e) => setNewVolName(e.target.value)}
                    placeholder="New volume name..."
                    className="bg-transparent text-xs outline-none w-full"
                    disabled={status !== "manage_volumes"}
                  />
                  <button
                    onClick={handleCreateVol}
                    disabled={status !== "manage_volumes"}
                    className="text-emerald-500 hover:text-emerald-400 cursor-pointer"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div
                  className={`flex-1 overflow-y-auto p-2 space-y-1 ${scrollbarStyles}`}
                >
                  {volumes.map((v) => (
                    <div
                      key={v}
                      onClick={() =>
                        status === "manage_volumes" && setActiveVol(v)
                      }
                      className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs ${activeVol === v ? "bg-sky-900/50 text-sky-200" : "hover:bg-sky-800/50 text-slate-400"}`}
                    >
                      <div className="flex items-center gap-2">
                        <Folder size={14} /> {v}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteVol(v);
                        }}
                        disabled={status !== "manage_volumes"}
                        className="text-slate-600 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="w-1/2 flex flex-col gap-3">
                {status === "mining" ? (
                  <div className="flex flex-1 flex-col items-center justify-center border border-rose-900/50 bg-rose-950/20 rounded-lg p-4">
                    <Loader2
                      size={32}
                      className="animate-spin text-rose-500 mb-2"
                    />
                    <button
                      onClick={() => invoke("stop_mining")}
                      className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white p-3 rounded font-bold text-xs uppercase cursor-pointer"
                    >
                      <StopCircle size={16} /> Force Stop
                    </button>
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
                    <button
                      disabled={!activeVol || status !== "manage_volumes"}
                      onClick={startMining}
                      className={`flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-sky-400 rounded font-bold text-xs uppercase transition-colors ${activeVol && status === "manage_volumes" && "cursor-pointer"}`}
                    >
                      <Camera size={16} /> Auto Mine ({activeVol || "None"})
                    </button>
                  </div>
                )}
              </div>
            </div>

            {(status === "manage_volumes" || status === "processing_mokuro") &&
              (status === "processing_mokuro" ? (
                <button
                  onClick={() => invoke("stop_mokuro")}
                  className="mt-4 h-12 shrink-0 flex items-center justify-center gap-3 rounded-xl text-xs font-bold tracking-[0.2em] uppercase transition-all duration-300 bg-rose-900/50 text-rose-200 hover:bg-rose-600 hover:text-white cursor-pointer shadow-[0_0_15px_rgba(225,29,72,0.2)]"
                >
                  <StopCircle size={16} className="animate-pulse" /> FORCE STOP
                  MOKURO
                </button>
              ) : (
                <button
                  disabled={volumes.length === 0}
                  onClick={startMokuro}
                  className={`mt-4 h-12 shrink-0 flex items-center justify-center gap-3 rounded-xl text-xs font-bold tracking-[0.2em] uppercase transition-all duration-300 ${volumes.length === 0 ? "bg-slate-800/50 text-slate-600 cursor-not-allowed" : "bg-emerald-600 text-white shadow-[0_0_15px_rgba(5,150,105,0.2)] hover:bg-emerald-500 cursor-pointer"}`}
                >
                  EXTRACT TEXT (MOKURO)
                </button>
              ))}
            <TerminalBox />
          </div>
        )}
      </div>
    </div>
  );
}

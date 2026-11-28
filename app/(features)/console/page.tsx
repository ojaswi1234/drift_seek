"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plus, X, Users, User, Image as ImageIcon, AlertTriangle } from "lucide-react";
import GlobalLoader from "@/components/GlobalLoader";
import TeamRoomModal from "@/components/modals/user/TeamRoomModal";
import WallpaperModal from "@/components/modals/user/WallpaperModal";
import { io, Socket } from "socket.io-client";
import anime from "animejs";
import TerminalDropdown from "@/components/Dropdown";

interface TabData {
  id: string;
  name: string;
}

interface HistoryLine {
  id: string;
  text: string;
  isPrompt: boolean;
}

function getSafeWallpaperUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(rawUrl)) {
    return rawUrl;
  }
  if (/^https:\/\/[^\s"'()<>]+$/i.test(rawUrl)) {
    return rawUrl;
  }
  return null;
}

function TerminalInstance({
  isActive,
  sysName,
  userName,
  tabId,
  mode,
  roomId,
  themeMode,
  activeWallpaper,
}: {
  isActive: boolean;
  sysName: string;
  userName: string;
  tabId: string;
  mode: "individual" | "team";
  roomId: string | null;
  themeMode: "dark" | "light";
  activeWallpaper: string | null;
}) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryLine[]>([]);
  const [isShellConnected, setIsShellConnected] = useState(false);
  const [currentDir, setCurrentDir] = useState<string>("/projects");
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pendingCommandRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineIdCounter = useRef(0);

  const appendLines = useCallback((rawText: string, isPrompt = false) => {
    const splitLines = rawText.split(/\r?\n/);
    setHistory((prev) => [
      ...prev,
      ...splitLines
        .filter((line) => line.length > 0)
        .map((line) => ({
          id: `${tabId}-${lineIdCounter.current++}`,
          text: line,
          isPrompt,
        })),
    ]);
  }, [tabId]);

  useEffect(() => {
    const serverUrl =
      process.env.NEXT_PUBLIC_SERVER_BASE_URL ||
      process.env.NEXT_PUBLIC_TERMINAL_URL ||
      "https://driftseek.duckdns.org";

    let socket: Socket;
    try {
      socket = io(serverUrl, {
        transports: ["polling", "websocket"],
        auth: { username: sysName, mode, roomId },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
      });
      socketRef.current = socket;
    } catch (err) {
      console.error("Failed to initialize socket:", err);
      return;
    }

    socket.on("connect", () => setIsShellConnected(true));
    socket.on("disconnect", () => setIsShellConnected(false));
    socket.on("connect_error", () => {
      setIsShellConnected(false);
      appendLines("[client] Unable to connect to terminal server.", true);
    });

    socket.on("output", (data: string) => {
      let cleanData = data
        .replace(/[\u001b\u009b]\][^\x07]*\x07/g, "")
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

      if (cleanData.includes("DRIFT_CLEAR_SCREEN")) {
        setHistory([]);
        cleanData = cleanData.replace(/DRIFT_CLEAR_SCREEN\r?\n?/g, "");
      }

      const promptRegex = /DRIFT_SERVER_PROMPT\|(.*?)>\s?/g;
      let extractedDir: string | null = null;
      let match;
      while ((match = promptRegex.exec(cleanData)) !== null) {
        extractedDir = match[1];
      }
      if (extractedDir) setCurrentDir(extractedDir);

      cleanData = cleanData.replace(promptRegex, "");
      cleanData = cleanData.replace(/[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+:[^\n]+?[#$]\s*/g, "");

      if (pendingCommandRef.current) {
        const cmd = pendingCommandRef.current;
        if (cleanData.trim() === cmd) {
          cleanData = "";
          pendingCommandRef.current = null;
        } else if (cleanData.trim().startsWith(cmd)) {
          const escapedCmd = cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          cleanData = cleanData.replace(new RegExp(`^\\s*${escapedCmd}\\s*\\r?\\n?`), "");
          pendingCommandRef.current = null;
        }
      }

      if (cleanData.trim()) {
        appendLines(cleanData, false);
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("output");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sysName, mode, roomId, appendLines]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    anime({
      targets: containerRef.current,
      opacity: [0, 1],
      translateY: [5, 0],
      duration: 300,
      easing: "easeOutSine",
    });
    const focusTimer = window.setTimeout(() => {
      const inputEl = containerRef.current?.querySelector("input");
      if (inputEl) inputEl.focus();
    }, 50);

    return () => window.clearTimeout(focusTimer);
  }, [isActive]);

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed === "clear") {
      setHistory([]);
      setInput("");
      return;
    }

    if (!socketRef.current?.connected) {
      appendLines("[client] Shell is disconnected. Reconnect and try again.", true);
      return;
    }

    try {
      pendingCommandRef.current = trimmed;
      socketRef.current.emit("input", input + "\r");
    } catch {
      appendLines("[client] Failed to send command.", true);
      return;
    }

    const prompt = `${sysName}:${currentDir}$ ${input}`;
    appendLines(prompt, true);
    setInput("");
  };

  const safeWallpaper = getSafeWallpaperUrl(activeWallpaper);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 flex flex-col ${isActive ? "z-10" : "hidden"}`}
    >
      {safeWallpaper && (
        <div
          className={`absolute inset-0 z-0 pointer-events-none ${
            themeMode === "dark" ? "opacity-40" : "opacity-30 mix-blend-multiply"
          }`}
          style={{
            backgroundImage: `url("${safeWallpaper}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      <div className="relative z-10 flex flex-col h-full">
        <div
          className={`flex items-center justify-between px-6 py-2 border-b ${
            themeMode === "dark"
              ? "border-zinc-800/50 bg-zinc-900/40 backdrop-blur-md"
              : "border-zinc-200 bg-white/70 backdrop-blur-md"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  isShellConnected
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                    : "bg-red-500"
                }`}
              />
              <span
                className={`text-xs font-mono ${
                  themeMode === "dark" ? "text-zinc-400" : "text-zinc-800"
                }`}
              >
                {isShellConnected ? "CONNECTED" : "OFFLINE"}
              </span>
            </div>
            <span
              className={`text-xs font-mono ${
                themeMode === "dark" ? "text-zinc-500" : "text-zinc-800 font-medium"
              }`}
            >
              DIR: {currentDir}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {mode === "team" && roomId && (
              <div className="flex items-center gap-2">
                <Users size={12} className="text-emerald-500/70" />
                <span className="text-xs font-mono text-emerald-500/70">ROOM: {roomId}</span>
              </div>
            )}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider border ${
                themeMode === "dark"
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                  : "bg-amber-100 text-amber-800 border-amber-300"
              }`}
            >
              <AlertTriangle size={11} className={themeMode === "dark" ? "text-amber-300" : "text-amber-600"} />
              Maintenance Undergoing
            </span>
          </div>
        </div>

        <div
          ref={scrollRef}
          className={`flex-1 p-6 overflow-y-auto font-mono text-sm custom-scrollbar ${
            themeMode === "dark" ? "text-zinc-300" : "text-zinc-900"
          }`}
        >
          <div className="mb-8 opacity-90 text-xs">
            <div
              style={{ fontFamily: "var(--font-press-start), monospace" }}
              className="text-2xl md:text-6xl bg-clip-text text-transparent bg-linear-to-r from-emerald-400 via-cyan-400 to-blue-500 mb-6 select-none"
            >
              Drift_Seeker
            </div>
            <div
              className={`space-y-1 font-mono ${
                themeMode === "dark" ? "text-zinc-400" : "text-zinc-800 font-medium"
              }`}
            >
              <p>Welcome to DriftSeeker Terminal [Instance: {tabId}]</p>
              <p>
                Authorized User: {userName}{" "}
                <span className={themeMode === "dark" ? "text-zinc-500" : "text-zinc-700 font-bold"}>
                  ({mode.toUpperCase()} MODE)
                </span>
              </p>
            </div>
            <div className="h-px w-24 bg-linear-to-r from-emerald-500/50 to-transparent my-4" />
            <div
              className={`max-w-3xl rounded-lg border p-3.5 text-xs leading-relaxed ${
                themeMode === "dark"
                  ? "border-amber-500/30 bg-amber-950/25 text-amber-100/90"
                  : "border-amber-200 bg-amber-50 text-amber-950"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="font-bold uppercase tracking-wider">
                  About Integrated Web Shell
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    themeMode === "dark"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-amber-200 text-amber-900"
                  }`}
                >
                  Maintenance Undergoing
                </span>
              </div>
              <p className={themeMode === "dark" ? "text-zinc-300" : "text-amber-900/90"}>
                The Integrated Web Shell provides an in-browser, sandboxed bash environment with multi-tab instances,
                Solo &amp; Team WebSocket room collaboration, directory state tracking, and custom workspace
                themes—letting engineers inspect containers and debug issues without an external SSH client. Remote
                terminal sandbox hosting is currently undergoing maintenance, so live shell connections may show
                OFFLINE until the terminal server endpoint is connected.
              </p>
            </div>
          </div>

          <div className="space-y-1.5 mb-4 relative z-10">
            {history.map((line) => (
              <p
                key={line.id}
                className={
                  line.isPrompt || line.text.includes("[client]")
                    ? themeMode === "dark"
                      ? "text-zinc-500"
                      : "text-zinc-600 font-medium"
                    : themeMode === "dark"
                      ? "text-green-500 whitespace-pre-wrap"
                      : "text-emerald-700 font-semibold whitespace-pre-wrap"
                }
              >
                {line.text}
              </p>
            ))}
          </div>

          <form onSubmit={handleCommand} className="flex items-center gap-2 mt-2 relative z-10">
            <span
              className={
                themeMode === "dark"
                  ? "text-green-500 shrink-0 select-none"
                  : "text-emerald-700 shrink-0 select-none font-bold"
              }
            >
              ❯
            </span>
            <input
              aria-label="Terminal command input"
              className={`bg-transparent border-none outline-none flex-1 placeholder-zinc-600 ${
                themeMode === "dark"
                  ? "text-green-400 caret-green-500"
                  : "text-zinc-950 font-medium caret-emerald-700"
              }`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder={isShellConnected ? "Enter command..." : "Connecting..."}
              disabled={!isShellConnected}
            />
          </form>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      router.replace("/");
    },
  });

  const [tabs, setTabs] = useState<TabData[]>([{ id: "tab-1", name: "terminal-1" }]);
  const [activeTabId, setActiveTabId] = useState("tab-1");
  const tabCounter = useRef(1);
  const [mode, setMode] = useState<"individual" | "team">("individual");
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [memberIdInput, setMemberIdInput] = useState("");
  const [memberRoleInput, setMemberRoleInput] = useState("");
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [activeWallpaper, setActiveWallpaper] = useState<string | null>(null);

  const fetchActiveWallpaper = useCallback(async () => {
    try {
      const res = await fetch("/api/wallpaper");
      if (res.ok) {
        const data = await res.json();
        const active = data.wallpapers?.find((w: { isActive: boolean; image: string }) => w.isActive);
        setActiveWallpaper(active ? active.image : null);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wallpaper");
        if (res.ok && !cancelled) {
          const data = await res.json();
          const active = data.wallpapers?.find(
            (w: { isActive: boolean; image: string }) => w.isActive
          );
          setActiveWallpaper(active ? active.image : null);
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const layoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (layoutRef.current && status === "authenticated") {
      anime({
        targets: layoutRef.current,
        opacity: [0, 1],
        scale: [0.98, 1],
        duration: 600,
        easing: "easeOutQuart",
      });
    }
  }, [status]);

  if (status === "loading") {
    return (
      <div className="min-h-screen w-full bg-zinc-950 text-white flex items-center justify-center pl-12 sm:pl-16 lg:pl-18">
        <GlobalLoader />
      </div>
    );
  }

  const sysName = session?.user?.username?.toLowerCase().replace(/\s+/g, "_") || "root_user";
  const userName = session?.user?.name || "Admin";

  const addTab = () => {
    tabCounter.current += 1;
    const newTabId = `tab-${tabCounter.current}`;
    setTabs((prev) => [...prev, { id: newTabId, name: `terminal-${tabCounter.current}` }]);
    setActiveTabId(newTabId);
  };

  const closeTab = (e: React.MouseEvent, idToClose: string) => {
    e.stopPropagation();
    if (tabs.length === 1) return;

    const newTabs = tabs.filter((t) => t.id !== idToClose);
    setTabs(newTabs);

    if (activeTabId === idToClose) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  const handleModeSwitch = (newMode: "individual" | "team") => {
    if (newMode === "team") {
      setShowTeamModal(true);
      return;
    }
    setMode("individual");
    setActiveRoomId(null);
  };

  return (
    <div
      className={`min-h-screen w-full flex items-center justify-center pl-16 sm:pl-20 md:pl-24 pr-4 md:pr-8 py-4 md:py-8 font-sans selection:bg-emerald-500/30 overflow-hidden transition-colors duration-300 ${
        themeMode === "dark" ? "bg-zinc-950 text-zinc-100" : "bg-zinc-100 text-zinc-900"
      }`}
    >
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(16, 185, 129, 0.2); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(16, 185, 129, 0.5); }
      `}</style>

      <div
        ref={layoutRef}
        className={`rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] origin-center w-full max-w-full h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)] border ${
          themeMode === "dark"
            ? "bg-[#0c0c0c] border-zinc-800/60"
            : "bg-white border-zinc-200"
        }`}
      >
        <div
          className={`flex border-b ${
            themeMode === "dark" ? "bg-zinc-950 border-zinc-800/60" : "bg-white border-zinc-200"
          }`}
        >
          <TerminalDropdown currentMode={themeMode} onModeChange={setThemeMode} />

          <div role="tablist" aria-label="Terminal tabs" className="flex flex-1 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => {
              const isTabActive = activeTabId === tab.id;
              return (
                <div
                  key={tab.id}
                  className={`group flex items-center border-r transition-all duration-200 min-w-35 max-w-50 ${
                    themeMode === "dark" ? "border-zinc-800/60" : "border-zinc-200"
                  } ${
                    isTabActive
                      ? themeMode === "dark"
                        ? "bg-[#0c0c0c] text-zinc-200"
                        : "bg-zinc-50 text-zinc-900"
                      : themeMode === "dark"
                        ? "bg-zinc-900/50 text-zinc-500 hover:bg-zinc-900"
                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isTabActive}
                    onClick={() => setActiveTabId(tab.id)}
                    className="flex-1 text-left px-4 py-2.5 text-xs font-mono truncate cursor-pointer focus:outline-none"
                  >
                    {tab.name}
                  </button>
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Close ${tab.name}`}
                      onClick={(e) => closeTab(e, tab.id)}
                      className={`mr-2 p-0.5 rounded-md transition-opacity cursor-pointer ${
                        isTabActive
                          ? "opacity-100 hover:bg-zinc-800"
                          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-zinc-300"
                      }`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              aria-label="New terminal tab"
              onClick={addTab}
              className={`flex items-center justify-center px-4 py-2 transition-colors cursor-pointer ${
                themeMode === "dark"
                  ? "hover:bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  : "hover:bg-zinc-200 text-zinc-500 hover:text-zinc-800"
              }`}
            >
              <Plus size={14} />
            </button>
          </div>

          <div
            className={`flex items-center gap-1 px-3 border-l shrink-0 ${
              themeMode === "dark" ? "border-zinc-800/60" : "border-zinc-200"
            }`}
          >
            <div
              className={`flex rounded-md p-0.5 ${
                themeMode === "dark" ? "bg-zinc-900" : "bg-zinc-200"
              }`}
            >
              <button
                type="button"
                onClick={() => handleModeSwitch("individual")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono transition-all duration-200 cursor-pointer ${
                  mode === "individual"
                    ? themeMode === "dark"
                      ? "bg-zinc-800 text-zinc-200 shadow-sm"
                      : "bg-white text-zinc-900 shadow-sm"
                    : themeMode === "dark"
                      ? "text-zinc-500 hover:text-zinc-400"
                      : "text-zinc-600 hover:text-zinc-800"
                }`}
              >
                <User size={12} />
                <span className="hidden sm:inline">Solo</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch("team")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono transition-all duration-200 cursor-pointer ${
                  mode === "team"
                    ? "bg-emerald-500/20 text-emerald-500 shadow-sm"
                    : themeMode === "dark"
                      ? "text-zinc-500 hover:text-zinc-400"
                      : "text-zinc-600 hover:text-zinc-800"
                }`}
              >
                <Users size={12} />
                <span className="hidden sm:inline">Team</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowWallpaperModal(true)}
              aria-label="Terminal Wallpaper"
              title="Terminal Wallpaper"
              className={`flex items-center gap-1.5 px-3 py-1 ml-2 rounded-sm text-xs font-mono transition-all duration-200 hover:opacity-80 cursor-pointer ${
                themeMode === "dark"
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <ImageIcon size={14} />
            </button>
          </div>
        </div>

        <div className={`flex-1 relative ${themeMode === "dark" ? "bg-[#0c0c0c]" : "bg-zinc-50"}`}>
          {tabs.map((tab) => (
            <TerminalInstance
              key={tab.id}
              tabId={tab.id}
              isActive={activeTabId === tab.id}
              sysName={sysName}
              userName={userName}
              mode={mode}
              roomId={activeRoomId}
              themeMode={themeMode}
              activeWallpaper={activeWallpaper}
            />
          ))}
        </div>
      </div>

      <TeamRoomModal
        isOpen={showTeamModal}
        memberIdInput={memberIdInput}
        onMemberIdChange={setMemberIdInput}
        memberRoleInput={memberRoleInput}
        onMemberRoleChange={setMemberRoleInput}
        onRoomConnected={(roomId) => {
          setActiveRoomId(roomId);
          setMode("team");
          setShowTeamModal(false);
        }}
        onCancel={() => {
          setShowTeamModal(false);
          if (mode !== "team") setMode("individual");
        }}
      />

      <WallpaperModal
        isOpen={showWallpaperModal}
        onCancel={() => setShowWallpaperModal(false)}
        onWallpaperUpdated={fetchActiveWallpaper}
      />
    </div>
  );
}

"use client";

import React, { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Terminal as TerminalIcon } from "lucide-react";
import GlobalLoader from "@/components/GlobalLoader";
import { io, Socket } from "socket.io-client";

function Page() {
  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [isShellConnected, setIsShellConnected] = useState(false);
  const [currentDir, setCurrentDir] = useState<string>("/projects");
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pendingCommandRef = useRef<string | null>(null);

  // 1. Setup WebSocket connection to the Handyman Server
  useEffect(() => {
    try {
      // Connect directly to the terminal server backend

      const sysName = session?.user?.username
  ? session.user.username?.toLowerCase().replace(/\s+/g, '_') 
  : "root_user";

      socketRef.current = io(
        "https://expert-train-6p67vjvvjrpcr6gw-3001.app.github.dev",
        {
          transports: ["polling", "websocket"],
          auth: { username: sysName },
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
        },
      );
    } catch (err) {
      console.error("Failed to initialize socket:", err);
     setTimeout(() => {
        setHistory((prev) => [
          ...prev,
          "[client] Failed to initialize shell connection.",
        ]);
      }, 0);
      return;
    }

    socketRef.current.on("connect", () => {
      setIsShellConnected(true);
    });

    socketRef.current.on("disconnect", () => {
      setIsShellConnected(false);
    });

    socketRef.current.on("connect_error", (err) => {
      setIsShellConnected(false);
      console.error("Shell connection error:", err);
      setHistory((prev) => [
        ...prev,
        "[client] Unable to connect to terminal server.",
      ]);
    });

    socketRef.current.on("output", (data: string) => {
      // Append raw terminal output to history
      let cleanData = data
        // 1. Filter out Window Title / OSC sequences (e.g. \x1b]0;...\x07)
        .replace(/[\u001b\u009b]]\d+;[^\x07]+\x07/g, "")
        // 2. Filter out CSI / SGR ANSI color codes
        .replace(
          /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
          ''
        );

      // Extract the current directory from our specific PTY prompt format
      const promptRegex = /DRIFT_SERVER_PROMPT\|(.*?)\>\s/g;
      let extractedDir: string | null = null;
      let match;
      while ((match = promptRegex.exec(cleanData)) !== null) {
        extractedDir = match[1];
      }
      if (extractedDir) {
        setCurrentDir(extractedDir);
      }

      // Filter out the prompt entirely
      cleanData = cleanData.replace(promptRegex, "");

      // Filter out typical fallback bash prompts in case they slip through
      cleanData = cleanData.replace(/[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+:[^\n]+?[#$]\s*/g, "");

      // Filter out the PTY echoed command
      if (pendingCommandRef.current) {
        const cmd = pendingCommandRef.current;
        if (cleanData.trim() === cmd) {
          // Chunk is purely the echoed command
          cleanData = "";
          pendingCommandRef.current = null;
        } else if (cleanData.trim().startsWith(cmd)) {
          // Chunk contains the echo at the beginning, strip it along with trailing newlines
          const escapedCmd = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          cleanData = cleanData.replace(new RegExp(`^\\s*${escapedCmd}\\s*\\r?\\n?`), "");
          pendingCommandRef.current = null;
        }
      }

      if (cleanData) {
        setHistory((prev) => [...prev, cleanData]);
      }
    });

    return () => {
      socketRef.current?.off("connect");
      socketRef.current?.off("disconnect");
      socketRef.current?.off("connect_error");
      socketRef.current?.off("output");
      socketRef.current?.disconnect();
    };
  }, []);

  // 2. Auto-scroll to bottom for real-time output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  if (status === "loading") return <GlobalLoader />;

  const sysName = session?.user?.username
    ? session.user.username.toLowerCase().replace(/\s+/g, "_")
    : "root_user";

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Clear local command for 'clear' keyword
    if (input === "clear") {
      setHistory([]);
      setInput("");
      return;
    }

    if (!socketRef.current?.connected) {
      setHistory((prev) => [
        ...prev,
        "[client] Shell is disconnected. Reconnect and try again.",
      ]);
      return;
    }

    // Emit the command + Enter key (\r) to the Node-pty backend [cite: 56, 76]
    try {
      pendingCommandRef.current = input.trim();
      socketRef.current.emit("input", input + "\r");
    } catch (err) {
      console.error("Failed to send command:", err);
      setHistory((prev) => [
        ...prev,
        "[client] Failed to send command to shell.",
      ]);
      return;
    }

    // Add the user command to history for visual feedback
    const prompt = `${sysName}:${currentDir}$ ${input}`;
    setHistory((prev) => [...prev, prompt]);

    setInput("");
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-5xl h-[80vh] bg-zinc-950 border border-zinc-800 shadow-2xl flex flex-col transition-all">
        {/* Window Header */}
        <div className="flex items-center justify-between bg-zinc-900 border-b border-zinc-800 px-4 py-2">
          <div className="flex items-center gap-2">
            <TerminalIcon size={14} className="text-zinc-500" />
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
              DRIFTSEEKER_SHELL // {sysName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isShellConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
              }`}
            />
            <span className="text-[9px] font-mono text-zinc-500 uppercase">
              {isShellConnected ? "SHELL_CONNECTED" : "SHELL_DISCONNECTED"}
            </span>
          </div>
        </div>

        {/* Console Body */}
        <div
          ref={scrollRef}
          className="flex-1 p-6 overflow-y-auto font-mono text-sm scrollbar-hide bg-black/50"
        >
          {/* Welcome Message */}
          <div className="text-zinc-500 mb-6 space-y-1">
            <p>DriftSeeker Secure Shell v2.1.0 [Encrypted] </p>
            <p>Target: Standard_Node_Cluster_01</p>
            <p>User: {session?.user?.name || "Admin"}</p>
            <p className="pt-2">
              Type &apos;drift scan&apos; to check for configuration
              anomalies[cite: 22].
            </p>
            <p>
              Type &apos;fix --auto&apos; to trigger remediation via
              Jenkins[cite: 45].
            </p>
          </div>

          {/* History Output */}
          <div className="space-y-1 mb-4">
            {history.map((line, i) => (
              <p
                key={i}
                className={
                  line.startsWith(`${sysName}:`) || line.includes("[client]") || line.includes("[server]")
                    ? "text-zinc-400"
                    : "text-green-400/90 whitespace-pre-wrap"
                }
              >
                {line}
              </p>
            ))}
          </div>

          {/* Active Input Line */}
          <form
            onSubmit={handleCommand}
            className="flex items-center gap-2 text-zinc-300 mt-1"
          >
            <span className="text-zinc-400 shrink-0">{sysName}:{currentDir}$</span>
            <input
              autoFocus
              className="bg-transparent border-none outline-none flex-1 text-zinc-300 caret-green-500"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </form>
        </div>
      </div>
    </div>
  );
}

export default Page;

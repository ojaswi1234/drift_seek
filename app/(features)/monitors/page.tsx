/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import MonitorCard from "@/components/monitorCard";
import React, { useEffect, useRef, useState } from "react";
import WebserverMonitorModal from "@/components/modals/webserver/webserverMonitorModal";
import SurgePredictionModal from "@/components/modals/webserver/SurgePredictionModal";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import GlobalLoader from "@/components/GlobalLoader";
import GithubRepoModal, { GitHubRepo } from "@/components/modals/githubRepos/githubrepoModal";
import ABResultStatsModal, { ABResultData } from "@/components/modals/results/ABResultStatsModal";
import { io, Socket } from "socket.io-client";
import { Activity, Eye, RefreshCw, GitFork, GitBranch } from "lucide-react";

type MonitorSocketPayload = {
  id: string;
  url: string;
  status: "up" | "down" | "online" | "offline" | "pending" | "error";
  latency: number;
  reason: string;
  lastChecked: string;
};

interface SurgeConfig {
  monitorId: string;
  monitorName: string;
  monitorUrl: string;
  events: Array<{
    id: string;
    name: string;
    date: string;
    type: "festival" | "launch" | "holiday" | "custom";
    description?: string;
    enabled: boolean;
  }>;
  baselineInterval: number;
  preEventInterval: number;
  surgeInterval: number;
  preEventWindowHours: number;
  surgeWindowHours: number;
  telegramEnabled: boolean;
  readinessChecks: {
    cdn: boolean;
    compression: boolean;
    protocol: boolean;
    cacheHeaders: boolean;
    sslExpiry: boolean;
  };
}

interface ReadinessReport {
  score: number;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
    severity: "info" | "warning" | "critical";
  }>;
  recommendations: string[];
  predictedPeakMultiplier?: number;
  crashProbability?: number;
}

export default function Page() {
  // Existing WebServer State
  const [website, setWebsite] = useState([] as any[]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const socketRef = React.useRef<Socket | null>(null);

  // Surge Prediction Modal State
  const [isSurgeModalOpen, setIsSurgeModalOpen] = useState(false);
  const [selectedMonitor, setSelectedMonitor] = useState<{ id: string; name?: string; url: string } | null>(null);

  // New Container/Stress Engine State
  const [container, setContainer] = useState([] as ABResultData[]);
  const [selectedResult, setSelectedResult] = useState<ABResultData | null>(null);
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isFetchingRepos, setIsFetchingRepos] = useState(false);
  
  // Pipeline Execution State
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [engineTarget, setEngineTarget] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const pollingTimeoutRef = useRef<number | null>(null);
  const pollingTargetRef = useRef<string | null>(null);
  const pollingBaselineRef = useRef<number>(0);

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  // --- WEBSERVER LOGIC ---
  const fetchMonitors = () => {
    setIsLoading(true);
    fetch("/api/database", { 
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP error! status: ${res.status}, body: ${text}`);
        }
        return res.json();
      })
      .then((data) => {
        const webServersData = Array.isArray(data) ? data : data.webservers || [];
        setWebsite(webServersData);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch monitors:", err);
        setIsLoading(false);
      });
  };

  useEffect(() => {
    fetchMonitors();
  }, []);

  // Socket.io connection for real-time updates
  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "", {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsSocketConnected(true);
    });

    socket.on("disconnect", () => {
      setIsSocketConnected(false);
    });

    socket.on("monitor_update", (data: MonitorSocketPayload) => {
      setWebsite((prev: any[]) =>
        prev.map((server) =>
          server._id === data.id
            ? { ...server, status: data.status, latency: data.latency, reason: data.reason, lastChecked: data.lastChecked }
            : server
        )
      );
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // --- SURGE PREDICTION LOGIC ---
  const handleOpenSurgeModal = (monitor: { id: string; name?: string; url: string }) => {
    setSelectedMonitor(monitor);
    setIsSurgeModalOpen(true);
  };

  const handleCloseSurgeModal = () => {
    setIsSurgeModalOpen(false);
    setSelectedMonitor(null);
  };

  const handleSaveSurgeConfig = async (monitorId: string, config: Partial<SurgeConfig>) => {
    try {
      const res = await fetch(`/api/monitor/${monitorId}/surge-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save config");
      console.log("Surge config saved:", data);
    } catch (err: any) {
      console.error("Save surge config error:", err);
      throw err;
    }
  };

  const handleGenerateReadinessReport = async (monitorId: string): Promise<ReadinessReport | null> => {
    try {
      const res = await fetch(`/api/monitor/${monitorId}/readiness-report`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to generate report");
      return data.report;
    } catch (err: any) {
      console.error("Generate readiness report error:", err);
      throw err;
    }
  };

  const handleTriggerCheck = async (monitorId: string): Promise<void> => {
    try {
      const res = await fetch(`/api/monitor/${monitorId}/trigger-check`, {
        method: "POST",
      });
      const data = await res.json();
      console.log("Manual check result:", data);
    } catch (err) {
      console.error("Trigger check error:", err);
    }
  };

  // --- GITHUB REPO / STRESS ENGINE LOGIC ---
  const handleOpenGithubModal = async () => {
    setIsGithubModalOpen(true);
    setIsFetchingRepos(true);
    try {
      const res = await fetch("/api/github/repos");
      const data = await res.json();
      setRepos(data.repos || []);
    } catch (err) {
      console.error("Failed to fetch repos:", err);
    } finally {
      setIsFetchingRepos(false);
    }
  };

  const handleRunStressTest = async (githubUrl: string, branches?: string[]) => {
    setIsGithubModalOpen(false);
    setIsEngineRunning(true);
    setEngineTarget(githubUrl);
    setEngineError(null);

    try {
      const res = await fetch("/api/stress/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUrl, branches }),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to trigger stress test");
      }
      
      const data = await res.json();
      console.log("Stress test triggered:", data);
      
      // Start polling for results
      startPolling(githubUrl);
    } catch (err: any) {
      setEngineError(err.message);
      setIsEngineRunning(false);
    }
  };

  const startPolling = (githubUrl: string) => {
    pollingTargetRef.current = githubUrl;
    pollingBaselineRef.current = Date.now();
    
    const poll = async () => {
      if (pollingTargetRef.current !== githubUrl) return;
      
      try {
        const res = await fetch(`/api/stress/results?url=${encodeURIComponent(githubUrl)}`);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
          setContainer(data.results);
          setIsEngineRunning(false);
          pollingIntervalRef.current && clearInterval(pollingIntervalRef.current);
          return;
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
      
      // Timeout after 10 minutes
      if (Date.now() - pollingBaselineRef.current > 10 * 60 * 1000) {
        setEngineError("Test timed out after 10 minutes");
        setIsEngineRunning(false);
        pollingIntervalRef.current && clearInterval(pollingIntervalRef.current);
      }
    };
    
    pollingIntervalRef.current = window.setInterval(poll, 5000);
    poll();
  };

  useEffect(() => {
    return () => {
      pollingIntervalRef.current && clearInterval(pollingIntervalRef.current);
      pollingTimeoutRef.current && clearTimeout(pollingTimeoutRef.current);
    };
  }, []);

  // --- RENDER ---
  if (status === "loading") return <GlobalLoader />;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold font-orbitron tracking-tight text-gray-900">
              System Monitors
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Real-time infrastructure monitoring & stress testing
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider ${
              isSocketConnected ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}>
              <span className={`w-2 h-2 rounded-full ${isSocketConnected ? "bg-green-500" : "bg-red-500"}`} />
              {isSocketConnected ? "Live" : "Offline"}
            </div>
            <button
              onClick={handleOpenGithubModal}
              className="px-4 py-2 bg-black text-white text-sm font-mono uppercase tracking-wider rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-2"
              disabled={isEngineRunning}
            >
              <GitFork className="w-4 h-4" />
              Stress Test
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-white text-black text-sm font-mono uppercase tracking-wider rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <Activity className="w-4 h-4" />
              Add Monitor
            </button>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* WebServer Monitors */}
          <div className="lg:col-span-2">
            <div className="bg-white border border-gray-100 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold font-orbitron tracking-wide text-gray-900">
                  WebServer Monitors
                </h2>
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500 font-mono">
                    {website.length} monitors
                  </span>
                </div>
              </div>

              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-32 bg-gray-100 rounded-lg" />
                    </div>
                  ))}
                </div>
              ) : website.length === 0 ? (
                <div className="text-center py-12">
                  <Eye className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-4">No monitors configured</p>
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="px-4 py-2 bg-black text-white text-sm font-mono uppercase tracking-wider rounded-lg hover:bg-zinc-800 transition-colors"
                  >
                    Add First Monitor
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {website.map((server: any) => (
                    <MonitorCard
                      key={server._id}
                      id={server._id}
                      name={server.name}
                      url={server.url}
                      status={server.status}
                      reason={server.reason}
                      latency={server.latency}
                      lastChecked={server.lastChecked}
                      onOpenSurgeModal={handleOpenSurgeModal}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Stress Engine Results Panel */}
          <aside className="bg-white border border-gray-100 rounded-xl p-6 flex flex-col h-[600px]">
            <div className="flex items-center justify-between mb-6 shrink-0">
              <h2 className="text-lg font-bold font-orbitron tracking-wide text-gray-900">
                Stress Engine
              </h2>
              {isEngineRunning && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running...
                </div>
              )}
            </div>

            {engineError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-mono">
                {engineError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-4">
              {container.length === 0 && !isEngineRunning ? (
                <div className="text-center py-12 text-gray-400">
                  <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No test results yet</p>
                  <p className="text-xs mt-1">Run a stress test to see results</p>
                </div>
              ) : (
                container.map((item) => (
                  <div
                    key={item.githubUrl + item.testedAt}
                    className="border border-gray-100 rounded-lg p-4 hover:border-gray-200 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-1">
                          {item.githubUrl.replace("https://github.com/", "")}
                        </p>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {item.metrics.baselineBranch || "baseline"} vs {item.metrics.candidateBranch || "candidate"}
                        </p>
                      </div>
                      <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                        item.metrics.passed !== false ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>
                        {item.metrics.passed !== false ? "PASSED" : "FAILED"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-px bg-gray-100 border border-gray-100 overflow-hidden rounded-md my-4">
                      <div className="bg-white p-3 flex flex-col justify-center">
                        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Branch A</span>
                        <span className="text-lg font-bold font-orbitron text-black">
                          {item.metrics.baselineBranch || "N/A"}
                        </span>
                      </div>
                      <div className="bg-white p-3 flex flex-col justify-center">
                        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Branch B</span>
                        <span className="text-lg font-bold font-orbitron text-black">
                          {item.metrics.candidateBranch || "N/A"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <button
                        onClick={() => setSelectedResult(item)}
                        className="px-3 py-1.5 text-xs font-mono bg-black text-white rounded hover:bg-zinc-800 transition-colors"
                      >
                        View Details
                      </button>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {new Date(item.testedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>

        {/* Modals */}
        <WebserverMonitorModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={fetchMonitors}
        />

        <SurgePredictionModal
          isOpen={isSurgeModalOpen}
          onClose={handleCloseSurgeModal}
          monitor={selectedMonitor}
          onSaveConfig={handleSaveSurgeConfig}
          onGenerateReport={handleGenerateReadinessReport}
          onTriggerCheck={handleTriggerCheck}
        />

        <GithubRepoModal
          isOpen={isGithubModalOpen}
          onClose={() => setIsGithubModalOpen(false)}
          onRunTest={handleRunStressTest}
          repos={repos}
          isLoading={isFetchingRepos}
        />

        <ABResultStatsModal
          isOpen={!!selectedResult}
          onClose={() => setSelectedResult(null)}
          data={selectedResult}
        />
      </div>
    </div>
  );
}
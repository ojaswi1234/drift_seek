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
import { Activity, Eye, RefreshCw } from "lucide-react";

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
      })
      .catch((err) => console.error("Error fetching webservers:", err))
      .finally(() => setIsLoading(false));
  };

  // --- NEW: FETCH AB TEST RESULTS ---
  const fetchContainerResults = async () => {
    try {
      const res = await fetch("/api/abtest/results");
      const data = await res.json();

      if (data.success && Array.isArray(data.data)) {
        const flattened = data.data
          .flatMap((repo: any) =>
            (repo.abTests || []).map((test: any) => ({
              githubUrl: repo.githubUrl,
              metrics: test,
              testedAt: test.testedAt,
            })),
          )
          .sort((a: ABResultData, b: ABResultData) => new Date(b.testedAt).getTime() - new Date(a.testedAt).getTime());

        setContainer(flattened);
        return flattened;
      }

      return [] as ABResultData[];
    } catch (err) {
      console.error("Error fetching AB test logs:", err);
      return [] as ABResultData[];
    }
  };

  const getLatestTestTimestamp = (results: ABResultData[], githubUrl: string) => {
    return results
      .filter((result) => result.githubUrl === githubUrl)
      .reduce((max, result) => Math.max(max, new Date(result.testedAt).getTime()), 0);
  };

  const stopPollingForResults = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    pollingTargetRef.current = null;
    setIsEngineRunning(false);
    setEngineTarget(null);
  };

  // --- SURGE PREDICTION API CALLS ---
  const handleSaveSurgeConfig = async (monitorId: string, config: Partial<SurgeConfig>) => {
    const res = await fetch(`/api/monitor/${monitorId}/surge-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Failed to save surge config");
    }
  };

  const handleGenerateReadinessReport = async (monitorId: string): Promise<ReadinessReport | null> => {
    const res = await fetch(`/api/monitor/${monitorId}/readiness-report`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Failed to generate readiness report");
    }
    return res.json();
  };

  const handleTriggerManualCheck = async (monitorId: string) => {
    const res = await fetch(`/api/monitor/${monitorId}/trigger-check`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Failed to trigger check");
    }
  };

  const handleOpenSurgeModal = (monitor: { id: string; name?: string; url: string }) => {
    setSelectedMonitor(monitor);
    setIsSurgeModalOpen(true);
  };

  const handleCloseSurgeModal = () => {
    setIsSurgeModalOpen(false);
    setSelectedMonitor(null);
  };

  // --- SOCKET CONNECTION ---
  React.useEffect(() => {
    if (status !== "authenticated") return;

    let cancelled = false;

    const connectSocket = async () => {
      const socketBaseUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
      const shouldUseInternalSocketRoute = !socketBaseUrl;
      const socketPath =
        process.env.NEXT_PUBLIC_SOCKET_PATH ||
        (shouldUseInternalSocketRoute ? "/api/socketio" : "/socket.io");

      if (shouldUseInternalSocketRoute) {
        try {
          await fetch("/api/socket", { method: "GET" });
        } catch (error) {
          console.error("Failed to initialize monitor socket route:", error);
        }
      }

      if (cancelled) return;

      const socket = io(socketBaseUrl || undefined, {
        path: socketPath,
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 1000,
      });

      socketRef.current = socket;

      socket.on("connect", () => setIsSocketConnected(true));
      socket.on("disconnect", () => setIsSocketConnected(false));
      socket.on("monitor:metric", (payload: MonitorSocketPayload) => {
        setWebsite((prev) =>
          prev.map((monitor: any) => {
            const monitorId = String(monitor.id || monitor._id || "");
            if (monitorId !== payload.id) return monitor;
            return {
              ...monitor,
              status: payload.status,
              latency: payload.latency,
              reason: payload.reason,
              lastChecked: payload.lastChecked,
            };
          }),
        );
      });
    };

    connectSocket().catch(console.error);

    return () => {
      cancelled = true;
      socketRef.current?.off("connect");
      socketRef.current?.off("disconnect");
      socketRef.current?.off("monitor:metric");
      socketRef.current?.disconnect();
      socketRef.current = null;
      setIsSocketConnected(false);
    };
  }, [status]);

  // --- CONTAINER / STRESS ENGINE LOGIC ---
  const handleOpenGithubModal = async () => {
    setIsGithubModalOpen(true);
    if (repos.length > 0) return;

    setIsFetchingRepos(true);
    try {
      const res = await fetch('/api/github/repos');
      if (!res.ok) throw new Error("Failed to fetch repositories");
      const data = await res.json();
      setRepos(data.repos || data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingRepos(false);
    }
  };

  const handleRunStressTest = async (githubUrl: string, branches?: string[]) => {
    setIsEngineRunning(true);
    setEngineTarget(githubUrl);
    setEngineError(null);
    pollingTargetRef.current = githubUrl;
    pollingBaselineRef.current = getLatestTestTimestamp(container, githubUrl);
    
    try {
      if (!branches || branches.length !== 2) {
        throw new Error('Please select exactly 2 branches for the A/B performance test.');
      }

      const res = await fetch('/api/abtest/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubUrl, branches }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start pipeline');
      }

      const pollForResults = async () => {
        if (!pollingTargetRef.current) return;

        const latestResults = await fetchContainerResults();
        const latestTimestamp = getLatestTestTimestamp(latestResults, pollingTargetRef.current);

        if (latestTimestamp > pollingBaselineRef.current) {
          stopPollingForResults();
        }
      };

      await pollForResults();

      pollingIntervalRef.current = window.setInterval(() => {
        pollForResults().catch((pollError) => {
          console.error("Error while polling for A/B results:", pollError);
        });
      }, 15000);

      pollingTimeoutRef.current = window.setTimeout(() => {
        if (pollingTargetRef.current) {
          setEngineError("Timed out waiting for new A/B results.");
        }
        stopPollingForResults();
      }, 10 * 60 * 1000);

    } catch (err: any) {
      setEngineError(err.message);
      stopPollingForResults();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white py-10 px-6 md:px-12 lg:px-44 font-orbitron text-black overflow-hidden">
      {/* Header Section */}
      <h1 className="text-3xl md:text-4xl font-bold mb-4 tracking-wide shrink-0">
        <span className="font-sans text-transparent bg-clip-text outlined-text">
          24/7
        </span>{" "}
        Web server Monitoring
      </h1>
      <hr className="border-gray-200 shrink-0" />

      <p className="text-md text-gray-600 mt-4 mb-10 shrink-0">
        Monitor the uptime and performance of your web servers & containers with
        real-time metrics and alerts.
      </p>

      <p className="text-xs font-mono tracking-wider text-gray-500 mb-6 shrink-0">
        SOCKET_LINK: {isSocketConnected ? "CONNECTED" : "DISCONNECTED"}
      </p>

      <div className="flex flex-col lg:flex-row w-full flex-1 gap-10 lg:gap-16 min-h-0">
        
        {/* LEFT COLUMN: WEB SERVERS */}
        <aside className="w-full lg:w-1/2 flex flex-col h-full min-h-0">
          <button 
            className="shrink-0 self-end mb-6 px-6 py-3 bg-black text-white uppercase text-sm tracking-widest hover:bg-zinc-800 transition-all cursor-pointer"
            onClick={() => setIsModalOpen(true)}
          >
            + Add Monitor
          </button>

          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-62.5 border-2 border-dashed border-gray-200 rounded-lg p-6">
              <GlobalLoader />
            </div>
          ) : website.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-62.5 border-2 border-dashed border-gray-200 rounded-lg p-6">
              <p className="text-gray-400 text-center">
                Add your website to monitor
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 pb-10 scrollbtn">
              {website.map((item, index) => (
                <MonitorCard 
                  key={index}
                  id={item.id || item._id}
                  name={item.name}
                  url={item.url}
                  status={item.status}
                  reason={item.reason}
                  latency={item.latency}
                  lastChecked={item.lastChecked || item.updatedAt}
                  onDelete={(idToRemove) => setWebsite(prev => prev.filter((w: any) => (w.id || w._id) !== idToRemove))}
                  onCheck={(id) => {
                    fetch('/api/monitor/ping', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id }),
                    }).finally(() => fetchMonitors());
                  }}
                  onOpenSurgeModal={handleOpenSurgeModal}
                />
              ))}
            </div>
          )}
        </aside>

        <div className="hidden lg:block w-0.5 bg-gray-300 self-stretch rounded-full shrink-0"></div>
        <hr className="block lg:hidden border-gray-100 w-full shrink-0" />

        {/* RIGHT COLUMN: CONTAINERS & PIPELINES */}
        <aside className="w-full lg:w-1/2 flex flex-col h-full min-h-0">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <h2 className="font-bold text-lg text-gray-800 tracking-wide uppercase">A/B Test Reports</h2>
              <button 
                onClick={fetchContainerResults}
                className="p-1.5 text-gray-400 hover:text-black hover:bg-gray-100 rounded-full transition-colors"
                title="Refresh Results"
              >
                <RefreshCw size={18} />
              </button>
            </div>
            <button 
              className="px-6 py-3 bg-black text-white uppercase text-sm tracking-widest hover:bg-zinc-800 transition-all cursor-pointer"
              onClick={handleOpenGithubModal}
              disabled={isEngineRunning}
            >
              + Add Container
            </button>
          </div>
          
          {engineError && (
             <div className="shrink-0 mb-4 bg-red-50 text-red-600 p-3 rounded-lg border border-red-200 text-sm font-sans">
               <strong>Execution Error:</strong> {engineError}
             </div>
          )}

          {isEngineRunning ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-62.5 border-2 border-dashed border-emerald-500/50 bg-emerald-50/50 rounded-lg p-6 animate-in fade-in">
              <Activity className="animate-pulse text-emerald-500 mb-4" size={40} />
              <p className="text-emerald-700 font-bold mb-2 uppercase tracking-wide">Executing Pipeline</p>
              <p className="text-xs text-emerald-600 text-center font-mono max-w-[80%]">
                Cloning & testing in Ephemeral Sandbox:<br/>
                <span className="font-bold">{engineTarget}</span>
              </p>
              <p className="text-[10px] text-emerald-500 mt-2 italic">Results will appear shortly.</p>
            </div>
          ) : container.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-62.5 border-2 border-dashed border-gray-200 rounded-lg p-6">
              <p className="text-gray-400 text-center">
                Add a GitHub repository to run A/B performance tests
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 pb-10 scrollbtn">
              {container.map((item, index) => (
                <div key={index} className="group relative p-5 bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-300 rounded-lg">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="p-2 rounded-md bg-purple-50 text-purple-600 shrink-0">
                        <Activity size={18} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-black font-orbitron font-bold tracking-wide text-sm truncate">
                          {item.githubUrl.split("/").slice(-2).join("/")}
                        </h3>
                        <p className="text-gray-500 text-[11px] font-mono mt-1 truncate">
                          {item.githubUrl}
                        </p>
                      </div>
                    </div>
                    <div className="px-2 py-1 rounded text-[10px] font-mono font-bold border border-purple-200 bg-purple-50 text-purple-700 uppercase tracking-widest">
                      A/B Test
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-px bg-gray-100 border border-gray-100 overflow-hidden rounded-md my-4">
                    <div className="bg-white p-3 flex flex-col justify-center">
                      <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Branch A</span>
                      <span className="text-lg font-bold font-orbitron text-black">
                        {item.metrics.branchA?.name || "N/A"}
                      </span>
                    </div>
                    <div className="bg-white p-3 flex flex-col justify-center">
                      <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Branch B</span>
                      <span className="text-lg font-bold font-orbitron text-black">
                        {item.metrics.branchB?.name || "N/A"}
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
              ))}
            </div>
          )}
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
        onTriggerCheck={handleTriggerManualCheck}
      />

      <GithubRepoModal
        isOpen={isGithubModalOpen}
        onClose={() => setIsGithubModalOpen(false)}
        repos={repos}
        isFetching={isFetchingRepos}
        onRunTest={handleRunStressTest}
      />

      <ABResultStatsModal
        isOpen={!!selectedResult}
        onClose={() => setSelectedResult(null)}
        data={selectedResult}
      />
    </div>
  );
}
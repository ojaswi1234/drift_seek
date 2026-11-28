/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import MonitorCard from "@/components/monitorCard";
import React, { useCallback, useEffect, useRef, useState } from "react";
import WebserverMonitorModal from "@/components/modals/webserver/webserverMonitorModal";
import SurgePredictionModal from "@/components/modals/webserver/SurgePredictionModal";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import GlobalLoader from "@/components/GlobalLoader";
import GithubRepoModal, { GitHubRepo } from "@/components/modals/githubRepos/githubrepoModal";
import ABResultStatsModal, { ABResultData } from "@/components/modals/results/ABResultStatsModal";
import { io, Socket } from "socket.io-client";
import { Activity, Eye, RefreshCw, GitBranch, GitCompare } from "lucide-react";

type MonitorSocketPayload = {
  id: string;
  url: string;
  status: "up" | "down" | "online" | "offline" | "pending" | "error";
  latency: number;
  ttfbMs?: number;
  cacheStatus?: string;
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
  actionOnlyOnScheduledDays: boolean;
  activeDaysOfWeek: number[];
  autoReadinessAlert: boolean;
  useBlackboxProbe: boolean;
  telegramChatId?: string;
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
  forecastBasis?: "historical-telemetry" | "heuristic";
  telemetry?: {
    sampleCount: number;
    baselineTtfbMs: number | null;
    recentTtfbMs: number | null;
    jitterMs: number | null;
    p95LatencyMs: number | null;
    errorRatePercent: number;
    ttfbGrowthRatio: number | null;
    lastCacheStatus: string;
    telemetrySource: "prometheus" | "blackbox" | "mongodb-history" | "heuristic";
    recentSamples: Array<{
      timestamp: string;
      latencyMs: number;
      ttfbMs: number;
      status: "up" | "down";
      mode: string;
      cacheStatus: string;
    }>;
  };
}

function flattenABLogs(logs: any[]): ABResultData[] {
  if (!Array.isArray(logs)) return [];
  const flattened: ABResultData[] = [];
  for (const doc of logs) {
    if (!doc?.githubUrl || !Array.isArray(doc.abTests)) continue;
    for (const run of doc.abTests) {
      flattened.push({
        githubUrl: doc.githubUrl,
        testedAt: run.testedAt || new Date().toISOString(),
        metrics: {
          baselineBranch: run.baselineBranch,
          candidateBranch: run.candidateBranch,
          baselineMetrics: run.baselineMetrics,
          candidateMetrics: run.candidateMetrics,
          passed: run.passed,
        },
      });
    }
  }
  return flattened.sort(
    (a, b) => new Date(b.testedAt).getTime() - new Date(a.testedAt).getTime()
  );
}

export default function Page() {
  const router = useRouter();
  const [website, setWebsite] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [monitorsError, setMonitorsError] = useState<string | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const [isSurgeModalOpen, setIsSurgeModalOpen] = useState(false);
  const [selectedMonitor, setSelectedMonitor] = useState<{
    id: string;
    name?: string;
    url: string;
  } | null>(null);

  const [container, setContainer] = useState<ABResultData[]>([]);
  const [selectedResult, setSelectedResult] = useState<ABResultData | null>(null);
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);
  const [isFetchingRepos, setIsFetchingRepos] = useState(false);

  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const pollingTargetRef = useRef<string | null>(null);
  const pollingBaselineRef = useRef<number>(0);
  const isPollingInFlightRef = useRef(false);

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      router.replace("/");
    },
  });

  const fetchMonitors = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setMonitorsError(null);
    try {
      const res = await fetch("/api/database", {
        cache: "no-store",
        signal,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch monitors (${res.status}): ${text}`);
      }
      const data = await res.json();
      const webServersData = Array.isArray(data) ? data : data.webservers || [];
      setWebsite(webServersData);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Failed to fetch monitors:", err);
      setMonitorsError("Unable to load monitors. Please try refreshing.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchABResults = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/abtest/results", { cache: "no-store", signal });
      if (!res.ok) return;
      const data = await res.json();
      setContainer(flattenABLogs(data?.data || []));
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Failed to load A/B results:", err);
      }
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();
    fetchMonitors(controller.signal);
    fetchABResults(controller.signal);
    return () => controller.abort();
  }, [status, fetchMonitors, fetchABResults]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let isMounted = true;
    let socket: Socket | null = null;

    const handleMetricUpdate = (data: MonitorSocketPayload) => {
      if (!data?.id) return;
      setWebsite((prev: any[]) =>
        prev.map((server) =>
          server._id === data.id
            ? {
                ...server,
                status: data.status,
                latency: data.latency,
                ttfbMs: data.ttfbMs ?? server.ttfbMs,
                cacheStatus: data.cacheStatus ?? server.cacheStatus,
                reason: data.reason,
                lastChecked: data.lastChecked,
              }
            : server
        )
      );
    };

    const connectSocket = async () => {
      const externalSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
      if (externalSocketUrl) {
        socket = io(externalSocketUrl, {
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
        });
      } else {
        await fetch("/api/socket").catch(() => {});
        if (!isMounted) return;
        socket = io({
          path: "/api/socketio",
          transports: ["polling", "websocket"],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
        });
      }

      if (!isMounted || !socket) {
        socket?.disconnect();
        return;
      }

      socketRef.current = socket;
      socket.on("connect", () => setIsSocketConnected(true));
      socket.on("disconnect", () => setIsSocketConnected(false));
      socket.on("monitor:metric", handleMetricUpdate);
      socket.on("monitor_update", handleMetricUpdate);
    };

    connectSocket();

    return () => {
      isMounted = false;
      if (socket) {
        socket.off("connect");
        socket.off("disconnect");
        socket.off("monitor:metric");
        socket.off("monitor_update");
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [status]);

  const handleOpenSurgeModal = (monitor: { id: string; name?: string; url: string }) => {
    setSelectedMonitor(monitor);
    setIsSurgeModalOpen(true);
  };

  const handleCloseSurgeModal = () => {
    setIsSurgeModalOpen(false);
    setSelectedMonitor(null);
  };

  const handleSaveSurgeConfig = async (monitorId: string, config: Partial<SurgeConfig>) => {
    const res = await fetch(`/api/monitor/${monitorId}/surge-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to save config");
    setWebsite((prev) =>
      prev.map((server) =>
        server._id === monitorId
          ? {
              ...server,
              actionOnlyOnScheduledDays: Boolean(config.actionOnlyOnScheduledDays),
              activeDaysOfWeek: Array.isArray(config.activeDaysOfWeek)
                ? config.activeDaysOfWeek
                : server.activeDaysOfWeek,
              scheduledEventCount: Array.isArray(config.events)
                ? config.events.filter((e) => e.enabled).length
                : server.scheduledEventCount,
            }
          : server
      )
    );
  };

  const handleGenerateReadinessReport = async (
    monitorId: string
  ): Promise<ReadinessReport | null> => {
    const res = await fetch(`/api/monitor/${monitorId}/readiness-report`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to generate report");
    return data as ReadinessReport;
  };

  const handleTriggerCheck = async (monitorId: string): Promise<void> => {
    const res = await fetch(`/api/monitor/${monitorId}/trigger-check`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || "Failed to trigger check");
    }
    if (data?.monitor) {
      setWebsite((prev) =>
        prev.map((server) =>
          server._id === monitorId
            ? {
                ...server,
                status: data.monitor.status,
                latency: data.monitor.latency,
                ttfbMs: data.monitor.ttfbMs ?? server.ttfbMs,
                cacheStatus: data.monitor.cacheStatus ?? server.cacheStatus,
                reason: data.monitor.reason,
                lastChecked: data.monitor.lastChecked,
              }
            : server
        )
      );
    }
  };

  const handleOpenGithubModal = async () => {
    setIsGithubModalOpen(true);
    setIsFetchingRepos(true);
    setReposError(null);
    try {
      const res = await fetch("/api/github/repos");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch GitHub repositories");
      }
      setRepos(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error("Failed to fetch repos:", err);
      setRepos([]);
      setReposError(err?.message || "Unable to fetch repositories");
    } finally {
      setIsFetchingRepos(false);
    }
  };

  const startPolling = (githubUrl: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    pollingTargetRef.current = githubUrl;
    pollingBaselineRef.current = Date.now();
    isPollingInFlightRef.current = false;

    const poll = async () => {
      if (pollingTargetRef.current !== githubUrl || isPollingInFlightRef.current) return;
      isPollingInFlightRef.current = true;

      try {
        const res = await fetch(`/api/abtest/results?url=${encodeURIComponent(githubUrl)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          const flattened = flattenABLogs(data?.data || []);
          if (flattened.length > 0) {
            setContainer((prev) => {
              const merged = [...flattened, ...prev.filter((p) => p.githubUrl !== githubUrl)];
              return merged.sort(
                (a, b) => new Date(b.testedAt).getTime() - new Date(a.testedAt).getTime()
              );
            });
            const hasFreshResult = flattened.some(
              (r) => new Date(r.testedAt).getTime() >= pollingBaselineRef.current - 5000
            );
            if (hasFreshResult) {
              setIsEngineRunning(false);
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
              return;
            }
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      } finally {
        isPollingInFlightRef.current = false;
      }

      if (Date.now() - pollingBaselineRef.current > 10 * 60 * 1000) {
        setEngineError("Test timed out after 10 minutes");
        setIsEngineRunning(false);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    };

    pollingIntervalRef.current = window.setInterval(poll, 5000);
    poll();
  };

  const handleRunABTest = async (githubUrl: string, branches: string[]) => {
    setIsEngineRunning(true);
    setEngineError(null);

    try {
      const res = await fetch("/api/abtest/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUrl, branches }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || data?.message || "Failed to trigger A/B test");
      }

      setIsGithubModalOpen(false);
      startPolling(githubUrl);
    } catch (err: any) {
      setEngineError(err?.message || "Failed to trigger A/B test");
      setIsEngineRunning(false);
      throw err;
    }
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen w-full bg-gray-50 text-gray-900 flex items-center justify-center pl-12 sm:pl-16 lg:pl-18">
        <GlobalLoader />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 font-sans pl-12 sm:pl-16 md:pl-16 lg:pl-18">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold font-orbitron tracking-tight text-gray-900">
              System Monitors
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Real-time infrastructure monitoring & A/B testing
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider ${
                isSocketConnected ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isSocketConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              {isSocketConnected ? "Live" : "Offline"}
            </div>
            <button
              type="button"
              onClick={handleOpenGithubModal}
              className="px-4 py-2 bg-black text-white text-sm font-mono uppercase tracking-wider rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors flex items-center gap-2 cursor-pointer"
              disabled={isEngineRunning}
            >
              <GitCompare className="w-4 h-4" />
              A/B Test
            </button>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-white text-black text-sm font-mono uppercase tracking-wider rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Activity className="w-4 h-4" />
              Add Monitor
            </button>
          </div>
        </div>

        {monitorsError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-mono">
            {monitorsError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white border border-gray-100 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold font-orbitron tracking-wide text-gray-900">
                  WebServer Monitors
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fetchMonitors()}
                    aria-label="Refresh monitors"
                    className="p-1.5 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                  </button>
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
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    className="px-4 py-2 bg-black text-white text-sm font-mono uppercase tracking-wider rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
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
                      ttfbMs={server.ttfbMs}
                      cacheStatus={server.cacheStatus}
                      actionOnlyOnScheduledDays={server.actionOnlyOnScheduledDays}
                      scheduledEventCount={server.scheduledEventCount}
                      lastChecked={server.lastChecked}
                      onCheck={handleTriggerCheck}
                      onDelete={(deletedId) =>
                        setWebsite((prev) => prev.filter((s) => s._id !== deletedId))
                      }
                      onOpenSurgeModal={handleOpenSurgeModal}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="bg-white border border-gray-100 rounded-xl p-6 flex flex-col h-[600px]">
            <div className="flex items-center justify-between mb-6 shrink-0">
              <h2 className="text-lg font-bold font-orbitron tracking-wide text-gray-900">
                A/B Test Engine
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
                  <p className="text-xs mt-1">Run an A/B test to see results</p>
                </div>
              ) : (
                container.map((item, idx) => (
                  <div
                    key={`${item.githubUrl}-${item.testedAt}-${idx}`}
                    className="border border-gray-100 rounded-lg p-4 hover:border-gray-200 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-1 truncate">
                          {item.githubUrl.replace("https://github.com/", "")}
                        </p>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {item.metrics?.baselineBranch || "baseline"} vs{" "}
                          {item.metrics?.candidateBranch || "candidate"}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 text-xs font-bold rounded-full shrink-0 ${
                          item.metrics?.passed !== false
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {item.metrics?.passed !== false ? "PASSED" : "FAILED"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-px bg-gray-100 border border-gray-100 overflow-hidden rounded-md my-4">
                      <div className="bg-white p-3 flex flex-col justify-center min-w-0">
                        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">
                          Branch A
                        </span>
                        <span className="text-sm font-bold font-orbitron text-black truncate">
                          {item.metrics?.baselineBranch || "N/A"}
                        </span>
                      </div>
                      <div className="bg-white p-3 flex flex-col justify-center min-w-0">
                        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">
                          Branch B
                        </span>
                        <span className="text-sm font-bold font-orbitron text-black truncate">
                          {item.metrics?.candidateBranch || "N/A"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setSelectedResult(item)}
                        className="px-3 py-1.5 text-xs font-mono bg-black text-white rounded hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        View Details
                      </button>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {item.testedAt ? new Date(item.testedAt).toLocaleString() : ""}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>

        <WebserverMonitorModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => fetchMonitors()}
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
          onRunTest={handleRunABTest}
          repos={repos}
          isLoading={isFetchingRepos}
          error={reposError}
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

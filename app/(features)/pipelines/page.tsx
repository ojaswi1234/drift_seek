/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  Eye, 
  Clock, 
  RefreshCw, 
  GitBranch, 
  Cpu, 
  TrendingUp, 
  Percent,
  Search,
  Activity
} from "lucide-react";
import GithubRepoModal, { GitHubRepo } from "@/components/modals/githubRepos/githubrepoModal";
import ABResultStatsModal, { ABResultData } from "@/components/modals/results/ABResultStatsModal";

export default function PipelinesPage() {
  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  const [results, setResults] = useState<ABResultData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isFetchingRepos, setIsFetchingRepos] = useState(false);

  // Pipeline execution state
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [engineTarget, setEngineTarget] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  
  const pollingIntervalRef = useRef<number | null>(null);
  const pollingTimeoutRef = useRef<number | null>(null);
  const pollingTargetRef = useRef<string | null>(null);
  const pollingBaselineRef = useRef<number>(0);

  const [selectedResult, setSelectedResult] = useState<ABResultData | null>(null);

  // Fetch results from DB
  const fetchResults = async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
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
            }))
          )
          .sort(
            (a: ABResultData, b: ABResultData) =>
              new Date(b.testedAt).getTime() - new Date(a.testedAt).getTime()
          );

        setResults(flattened);
        return flattened;
      }
      return [] as ABResultData[];
    } catch (err) {
      console.error("Error fetching pipeline results:", err);
      return [] as ABResultData[];
    } finally {
      if (showLoader) setIsLoading(false);
    }
  };

  const getLatestTestTimestamp = (list: ABResultData[], githubUrl: string) => {
    return list
      .filter((r) => r.githubUrl === githubUrl)
      .reduce((latest, r) => {
        const testedAt = new Date(r.testedAt).getTime();
        return testedAt > latest ? testedAt : latest;
      }, 0);
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current !== null) {
      window.clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    pollingTargetRef.current = null;
    pollingBaselineRef.current = 0;
    setIsEngineRunning(false);
    setEngineTarget(null);
  };

  const handleOpenGithubModal = async () => {
    setIsGithubModalOpen(true);
    if (repos.length > 0) return;

    setIsFetchingRepos(true);
    try {
      const res = await fetch("/api/github/repos");
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
    pollingBaselineRef.current = getLatestTestTimestamp(results, githubUrl);

    try {
      if (!branches || branches.length !== 2) {
        throw new Error("Please select exactly 2 branches for the A/B performance test.");
      }

      const res = await fetch("/api/abtest/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUrl, branches }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start pipeline");
      }

      const poll = async () => {
        if (!pollingTargetRef.current) return;
        const currentList = await fetchResults();
        const latestTimestamp = getLatestTestTimestamp(currentList, pollingTargetRef.current);

        if (latestTimestamp > pollingBaselineRef.current) {
          stopPolling();
        }
      };

      await poll();

      pollingIntervalRef.current = window.setInterval(() => {
        poll().catch((err) => console.error("Polling error:", err));
      }, 10000);

      pollingTimeoutRef.current = window.setTimeout(() => {
        if (pollingTargetRef.current) {
          setEngineError("Timed out waiting for new A/B performance results.");
        }
        stopPolling();
      }, 10 * 60 * 1000);

    } catch (err: any) {
      setEngineError(err.message);
      stopPolling();
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchResults(true);
    }
    return () => {
      if (pollingIntervalRef.current !== null) window.clearInterval(pollingIntervalRef.current);
      if (pollingTimeoutRef.current !== null) window.clearTimeout(pollingTimeoutRef.current);
    };
  }, [status]);

  // Statistics calculations
  const totalRuns = results.length;
  const passedRuns = results.filter((r) => r.metrics.passed).length;
  const failedRuns = totalRuns - passedRuns;
  const passRate = totalRuns > 0 ? ((passedRuns / totalRuns) * 100).toFixed(1) : "0";
  const uniqueRepos = Array.from(new Set(results.map((r) => r.githubUrl))).length;

  return (
    <div className="flex flex-col h-screen bg-white py-10 px-6 md:px-12 lg:px-44 font-orbitron text-black overflow-hidden">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4 shrink-0">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-wide">
            <span className="font-sans text-transparent bg-clip-text outlined-text">
              CI/CD
            </span>{" "}
            Automated Fixes
          </h1>
          <p className="text-sm text-gray-500 font-sans mt-1">
            Compare branch performance, evaluate test gates, and review system drifts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchResults(true)}
            className="p-3 text-gray-400 hover:text-black hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors cursor-pointer"
            title="Refresh Runs"
          >
            <RefreshCw size={18} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleOpenGithubModal}
            disabled={isEngineRunning}
            className="px-6 py-3 bg-black text-white uppercase text-xs tracking-widest hover:bg-zinc-800 transition-all cursor-pointer font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Run Stress Test
          </button>
        </div>
      </div>
      <hr className="border-gray-200 shrink-0" />

      {/* Stats Counter Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-8 shrink-0">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-sans flex flex-col justify-between">
          <div className="flex justify-between items-center text-gray-500 mb-2">
            <span className="text-xs uppercase tracking-wider font-mono">Total Runs</span>
            <Activity size={18} />
          </div>
          <p className="text-2xl font-bold font-orbitron text-black">{totalRuns}</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-sans flex flex-col justify-between">
          <div className="flex justify-between items-center text-emerald-600 mb-2">
            <span className="text-xs uppercase tracking-wider font-mono text-gray-500">Passed / Wins</span>
            <CheckCircle2 size={18} />
          </div>
          <p className="text-2xl font-bold font-orbitron text-emerald-600">{passedRuns}</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-sans flex flex-col justify-between">
          <div className="flex justify-between items-center text-red-500 mb-2">
            <span className="text-xs uppercase tracking-wider font-mono text-gray-500">Failed / Regressions</span>
            <AlertTriangle size={18} />
          </div>
          <p className="text-2xl font-bold font-orbitron text-red-500">{failedRuns}</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-sans flex flex-col justify-between">
          <div className="flex justify-between items-center text-blue-600 mb-2">
            <span className="text-xs uppercase tracking-wider font-mono text-gray-500">Success Rate</span>
            <Percent size={18} />
          </div>
          <p className="text-2xl font-bold font-orbitron text-blue-600">{passRate}%</p>
        </div>
      </div>

      {engineError && (
        <div className="shrink-0 mb-6 bg-red-50 text-red-600 p-4 rounded-xl border border-red-200 text-sm font-sans flex items-center gap-3">
          <AlertTriangle size={20} className="shrink-0" />
          <div>
            <strong className="font-bold">Test Execution Error:</strong> {engineError}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0">
        {isEngineRunning && (
          <div className="shrink-0 mb-6 border-2 border-dashed border-emerald-500/50 bg-emerald-50/50 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 animate-pulse">
            <div className="flex items-center gap-4">
              <Cpu className="text-emerald-500 animate-spin" size={28} />
              <div>
                <p className="text-emerald-800 font-bold uppercase tracking-widest text-xs font-orbitron">Running Stress Engine Pipeline</p>
                <p className="text-xs font-mono text-emerald-600 mt-1 max-w-lg truncate">{engineTarget}</p>
              </div>
            </div>
            <div className="text-xs font-sans text-emerald-700 italic bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-200">
              Triggered... Waiting for performance validation data.
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl">
            <Activity className="animate-spin text-gray-400 mb-2" size={32} />
            <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Loading Pipeline History...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
            <Cpu size={48} className="text-gray-300 mb-4" />
            <h3 className="font-bold font-orbitron text-lg mb-2 uppercase text-gray-700">No pipelines run yet</h3>
            <p className="text-sm font-sans text-gray-500 max-w-sm mx-auto mb-6">
              Compare repository branches under load in an isolated sandbox to detect latency regressions and throughput bottlenecks.
            </p>
            <button
              onClick={handleOpenGithubModal}
              className="px-6 py-3 bg-black text-white uppercase text-xs tracking-widest hover:bg-zinc-800 transition-all cursor-pointer font-bold"
            >
              + Trigger First Run
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-2 pb-10 scrollbtn space-y-4">
            {results.map((run, index) => {
              const repoPath = run.githubUrl.replace("https://github.com/", "");
              const isWin = run.metrics.passed;

              return (
                <div 
                  key={index}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow font-sans flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span className="font-bold text-gray-900 truncate font-mono text-sm" title={run.githubUrl}>
                        {repoPath}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-orbitron ${
                          isWin ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {isWin ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        {isWin ? "Passed" : "Failed / Regressed"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <GitBranch size={13} /> {run.metrics.baselineBranch || "main"}
                      </span>
                      <span>vs</span>
                      <span className="inline-flex items-center gap-1">
                        <GitBranch size={13} /> {run.metrics.candidateBranch || "candidate"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-gray-400">
                        <Clock size={13} /> {new Date(run.testedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 shrink-0">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-gray-500">
                      <div>
                        RPS: <strong className="text-gray-900 font-bold">{(run.metrics.candidateMetrics?.requestsPerSecond || 0).toFixed(0)}</strong>
                      </div>
                      <div>
                        Success: <strong className="text-gray-900 font-bold">{(run.metrics.candidateMetrics?.successRate || 0).toFixed(1)}%</strong>
                      </div>
                      <div>
                        Latency: <strong className="text-gray-900 font-bold">{(run.metrics.candidateMetrics?.latencyAverage || 0).toFixed(1)}ms</strong>
                      </div>
                      <div>
                        P99: <strong className="text-gray-900 font-bold">{(run.metrics.candidateMetrics?.latency99th || 0).toFixed(1)}ms</strong>
                      </div>
                    </div>

                    <button
                      onClick={() => setSelectedResult(run)}
                      className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white hover:bg-gray-100 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                    >
                      <Eye size={14} />
                      View Charts
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODALS */}
      <GithubRepoModal 
        isOpen={isGithubModalOpen} 
        onClose={() => setIsGithubModalOpen(false)} 
        repos={repos}
        isLoading={isFetchingRepos}
        onSelectRepo={(url, branches) => handleRunStressTest(url, branches)} 
      />

      <ABResultStatsModal
        isOpen={Boolean(selectedResult)}
        onClose={() => setSelectedResult(null)}
        data={selectedResult}
      />
    </div>
  );
}
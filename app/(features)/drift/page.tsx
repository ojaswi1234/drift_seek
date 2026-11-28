"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Search,
  Container,
  GitBranch,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileCode,
  ShieldAlert,
} from "lucide-react";
import GlobalLoader from "@/components/GlobalLoader";

interface GitHubRepo {
  id: number;
  name: string;
  owner: { login: string };
  html_url: string;
}

interface GitHubBranch {
  name: string;
}

interface LiveContainer {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

interface DriftItem {
  category: "ENV" | "RESOURCE" | "PORT" | "IMAGE" | "WORKDIR";
  key: string;
  driftType: "ADDED_IN_LIVE" | "MISSING_IN_LIVE" | "MODIFIED";
  severity: "critical" | "warning" | "info";
  expected: string;
  actual: string;
  message: string;
}

interface DriftResponse {
  repo: string;
  branch: string;
  filePath: string;
  checkedAt: string;
  report: {
    status: "IN_SYNC" | "DRIFT_DETECTED";
    driftCount: number;
    drifts: DriftItem[];
  };
  gitSpec: {
    sourceType: "dockerfile" | "compose";
    image: string | null;
    ports: string[];
    workdir: string | null;
    memoryLimitMb: number | null;
    cpus: number | null;
    env: Record<string, string>;
  };
  live: {
    id: string;
    name: string;
    image: string;
    running: boolean;
    ports: string[];
    workdir: string | null;
    memoryLimitMb: number | null;
    cpus: number | null;
    envCount: number;
  };
}

export default function DriftEnginePage() {
  const router = useRouter();
  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      router.replace("/");
    },
  });

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepoKey, setSelectedRepoKey] = useState("");
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [filePath, setFilePath] = useState("Dockerfile");
  const [serviceName, setServiceName] = useState("");
  const [alertOnDrift, setAlertOnDrift] = useState(false);

  const [containers, setContainers] = useState<LiveContainer[]>([]);
  const [dockerAvailable, setDockerAvailable] = useState<boolean>(true);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [selectedContainerId, setSelectedContainerId] = useState("");

  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isLoadingContainers, setIsLoadingContainers] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DriftResponse | null>(null);

  const fetchContainers = useCallback(async () => {
    setIsLoadingContainers(true);
    setDockerError(null);
    try {
      const res = await fetch("/api/drift/containers", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load Docker containers");
      }
      setDockerAvailable(Boolean(data.dockerAvailable));
      const list = Array.isArray(data.containers) ? (data.containers as LiveContainer[]) : [];
      setContainers(list);
      if (!data.dockerAvailable && data.error) {
        setDockerError(data.error);
      }
      if (list.length > 0) {
        setSelectedContainerId((prev) => prev || list[0].id);
      }
    } catch (err) {
      setDockerAvailable(false);
      setDockerError(err instanceof Error ? err.message : "Docker daemon unavailable");
    } finally {
      setIsLoadingContainers(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    const loadInitial = async () => {
      setIsLoadingRepos(true);
      try {
        const res = await fetch("/api/github/repos", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data)) {
          setRepos(data);
          if (data.length > 0) {
            setSelectedRepoKey(`${data[0].owner.login}/${data[0].name}`);
          }
        }
      } catch (err) {
        console.error("Failed to load repos:", err);
      } finally {
        if (!cancelled) setIsLoadingRepos(false);
      }
    };

    loadInitial();
    fetchContainers();

    return () => {
      cancelled = true;
    };
  }, [status, fetchContainers]);

  useEffect(() => {
    if (!selectedRepoKey || status !== "authenticated") return;
    const [owner, repo] = selectedRepoKey.split("/");
    if (!owner || !repo) return;

    let cancelled = false;
    setIsLoadingBranches(true);
    setBranches([]);
    setSelectedBranch("");

    fetch(
      `/api/gitbranch?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
      { cache: "no-store" }
    )
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (ok && Array.isArray(d)) {
          setBranches(d);
          if (d.length > 0) {
            const preferred =
              d.find((b: GitHubBranch) => b.name === "main" || b.name === "master") || d[0];
            setSelectedBranch(preferred.name);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingBranches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRepoKey, status]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const [owner, repo] = selectedRepoKey.split("/");
    if (!owner || !repo || !selectedBranch || !selectedContainerId) {
      setError("Select a GitHub repository, branch, and live Docker container.");
      return;
    }

    setIsScanning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/drift/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          repo,
          branch: selectedBranch,
          filePath: filePath.trim() || "Dockerfile",
          containerId: selectedContainerId,
          serviceName: serviceName.trim() || undefined,
          alertOnDrift,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Drift scan failed");
      }
      setResult(data as DriftResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drift scan failed");
    } finally {
      setIsScanning(false);
    }
  };

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
            <h1 className="text-3xl font-bold font-orbitron tracking-tight text-gray-900 flex items-center gap-3">
              <Search className="w-7 h-7" />
              Drift Detection Engine
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Compare live Docker container configuration & resource limits against your official GitHub repository
            </p>
          </div>
          <button
            type="button"
            onClick={fetchContainers}
            disabled={isLoadingContainers}
            className="px-4 py-2 bg-white border border-gray-200 text-black text-xs font-mono uppercase tracking-wider rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingContainers ? "animate-spin" : ""}`} />
            Refresh Docker
          </button>
        </div>

        {!dockerAvailable && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Docker Daemon Not Detected</p>
              <p className="text-xs font-mono text-amber-800 mt-1">
                {dockerError ||
                  "Start Docker Desktop / dockerd or set DOCKER_HOST so DriftSeeker can inspect live containers via dockerode."}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleScan}
            className="bg-white border border-gray-200 rounded-xl p-6 space-y-5 h-fit"
          >
            <h2 className="text-base font-orbitron font-bold text-gray-900 uppercase tracking-wider">
              Scan Configuration
            </h2>

            <div>
              <label
                htmlFor="drift-repo-select"
                className="block text-xs font-mono uppercase text-gray-600 mb-1"
              >
                GitHub Repository
              </label>
              <select
                id="drift-repo-select"
                value={selectedRepoKey}
                onChange={(e) => setSelectedRepoKey(e.target.value)}
                disabled={isLoadingRepos}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-black text-sm font-mono outline-none focus:border-black"
              >
                <option value="">
                  {isLoadingRepos ? "Loading repositories..." : "Select repository..."}
                </option>
                {repos.map((r) => {
                  const key = `${r.owner.login}/${r.name}`;
                  return (
                    <option key={r.id} value={key}>
                      {key}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label
                htmlFor="drift-branch-select"
                className="block text-xs font-mono uppercase text-gray-600 mb-1"
              >
                Official Branch
              </label>
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                <GitBranch size={15} className="text-gray-400 shrink-0" />
                <select
                  id="drift-branch-select"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  disabled={isLoadingBranches || branches.length === 0}
                  className="w-full bg-white text-black text-sm font-mono outline-none"
                >
                  <option value="">
                    {isLoadingBranches ? "Loading branches..." : "Select branch..."}
                  </option>
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="drift-filepath-input"
                className="block text-xs font-mono uppercase text-gray-600 mb-1"
              >
                GitHub Config File
              </label>
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                <FileCode size={15} className="text-gray-400 shrink-0" />
                <input
                  id="drift-filepath-input"
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="Dockerfile"
                  className="w-full bg-white text-black text-sm font-mono outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {["Dockerfile", "docker-compose.yaml", "docker-compose.yml"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setFilePath(preset)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded border cursor-pointer ${
                      filePath === preset
                        ? "bg-black text-white border-black"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/\.ya?ml$/i.test(filePath) && (
              <div>
                <label
                  htmlFor="drift-service-input"
                  className="block text-xs font-mono uppercase text-gray-600 mb-1"
                >
                  Compose Service Name (optional)
                </label>
                <input
                  id="drift-service-input"
                  type="text"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="e.g., app"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-black text-sm font-mono outline-none focus:border-black"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="drift-container-select"
                className="block text-xs font-mono uppercase text-gray-600 mb-1"
              >
                Live Docker Container
              </label>
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                <Container size={15} className="text-gray-400 shrink-0" />
                <select
                  id="drift-container-select"
                  value={selectedContainerId}
                  onChange={(e) => setSelectedContainerId(e.target.value)}
                  disabled={containers.length === 0}
                  className="w-full bg-white text-black text-sm font-mono outline-none"
                >
                  <option value="">
                    {containers.length === 0
                      ? "No live containers available"
                      : "Select container..."}
                  </option>
                  {containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.image}) [{c.state}]
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs font-mono text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={alertOnDrift}
                onChange={(e) => setAlertOnDrift(e.target.checked)}
                className="w-4 h-4 accent-black"
              />
              Send Telegram alert if drift detected
            </label>

            <button
              type="submit"
              disabled={isScanning || !selectedRepoKey || !selectedBranch || !selectedContainerId}
              className="w-full py-3 bg-black text-white text-xs font-mono uppercase tracking-widest rounded-lg hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Search size={14} className={isScanning ? "animate-spin" : ""} />
              {isScanning ? "Comparing Configs..." : "Run Drift Scan"}
            </button>
          </form>

          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-6 min-h-[420px]">
            <h2 className="text-base font-orbitron font-bold text-gray-900 uppercase tracking-wider mb-4">
              Drift Analysis Report
            </h2>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm font-mono text-red-700">
                {error}
              </div>
            )}

            {!result ? (
              <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                <Container className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm text-gray-600 font-medium">
                  Select a GitHub repository config and a live Docker container to detect drift.
                </p>
                <p className="text-xs font-mono text-gray-400 mt-1">
                  Flags undocumented manual hotfixes in env vars, memory/CPU limits, ports, and images.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div
                  className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 ${
                    result.report.status === "IN_SYNC"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-red-50 border-red-200 text-red-900"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {result.report.status === "IN_SYNC" ? (
                      <CheckCircle2 className="text-emerald-600 shrink-0" size={24} />
                    ) : (
                      <AlertTriangle className="text-red-600 shrink-0" size={24} />
                    )}
                    <div>
                      <p className="font-orbitron font-bold text-lg">
                        {result.report.status === "IN_SYNC"
                          ? "IN SYNC — No Configuration Drift"
                          : `DRIFT DETECTED (${result.report.driftCount} issue${
                              result.report.driftCount === 1 ? "" : "s"
                            })`}
                      </p>
                      <p className="text-xs font-mono opacity-80">
                        {result.repo}@{result.branch}:{result.filePath} vs container &quot;{result.live.name}&quot;
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono opacity-75">
                    {new Date(result.checkedAt).toLocaleTimeString()}
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-xs font-mono space-y-1">
                    <p className="font-bold uppercase text-gray-500 mb-2">GitHub Spec ({result.gitSpec.sourceType})</p>
                    <p>Image: {result.gitSpec.image || "unspecified"}</p>
                    <p>Memory Limit: {result.gitSpec.memoryLimitMb ? `${result.gitSpec.memoryLimitMb} MB` : "unspecified"}</p>
                    <p>CPU Limit: {result.gitSpec.cpus ?? "unspecified"}</p>
                    <p>Ports: {result.gitSpec.ports.join(", ") || "none"}</p>
                    <p>Declared Env Keys: {Object.keys(result.gitSpec.env).length}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-xs font-mono space-y-1">
                    <p className="font-bold uppercase text-gray-500 mb-2">Live Container ({result.live.name})</p>
                    <p>Image: {result.live.image}</p>
                    <p>Memory Limit: {result.live.memoryLimitMb ? `${result.live.memoryLimitMb} MB` : "unlimited"}</p>
                    <p>CPU Limit: {result.live.cpus ?? "unlimited"}</p>
                    <p>Ports: {result.live.ports.join(", ") || "none"}</p>
                    <p>Runtime Env Keys: {result.live.envCount}</p>
                  </div>
                </div>

                {result.report.drifts.length > 0 && (
                  <div className="space-y-3">
                    {result.report.drifts.map((drift, i) => (
                      <div
                        key={`${drift.category}-${drift.key}-${i}`}
                        className="p-4 rounded-lg border border-gray-200 bg-white space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 text-[10px] font-mono uppercase rounded bg-zinc-900 text-white">
                              {drift.category}
                            </span>
                            <span className="font-mono font-bold text-sm text-black">
                              {drift.key}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-mono uppercase rounded ${
                              drift.severity === "critical"
                                ? "bg-red-100 text-red-700"
                                : drift.severity === "warning"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {drift.driftType.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600">{drift.message}</p>
                        <div className="grid sm:grid-cols-2 gap-2 text-xs font-mono pt-1">
                          <div className="p-2 rounded bg-gray-50 border border-gray-100 truncate">
                            <span className="text-gray-400">GitHub: </span>
                            <span className="text-gray-900">{drift.expected}</span>
                          </div>
                          <div className="p-2 rounded bg-red-50/50 border border-red-100 truncate">
                            <span className="text-gray-400">Live: </span>
                            <span className="text-red-700">{drift.actual}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useSession } from "next-auth/react";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Terminal, AlertTriangle, CheckCircle2, Activity, Bot } from "lucide-react";
import GlobalLoader from "@/components/GlobalLoader";

type StatusObject = {
  statusCode: number;
  message: string;
  diagnostic?: string;
  details?: string;
};

function Page() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isstatus, setStatus] = useState<StatusObject | string | null>(null);
  const [githubData, setGithubData] = useState<number>(0);
  const [monitorCount, setMonitorCount] = useState<number>(0);
  const [pipelineCount, setPipelineCount] = useState<number>(0);
  const checkAbortRef = useRef<AbortController | null>(null);

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      router.replace("/");
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUrlInput(val);
    if (val.trim() === "") {
      checkAbortRef.current?.abort();
      setStatus(null);
      setChecking(false);
    }
  };

  const checkStatus = async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;

    checkAbortRef.current?.abort();
    const controller = new AbortController();
    checkAbortRef.current = controller;

    setChecking(true);
    setStatus(null);

    try {
      const res = await fetch(
        `/api/check_status?url=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      );
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Unexpected response (${res.status})`);
      }
      const result = await res.json();
      setStatus(result);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.error(e);
      setStatus("CONNECTION_REFUSED_OR_TIMEOUT");
    } finally {
      if (checkAbortRef.current === controller) {
        setChecking(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    checkStatus(urlInput);
  };

  useEffect(() => {
    return () => {
      checkAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();

    fetch("/api/github/repos", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const repoCount = Array.isArray(data)
          ? data.length
          : typeof data?.total_count === "number"
            ? data.total_count
            : 0;
        setGithubData(repoCount);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          console.error("Failed to fetch GitHub repos:", err);
          setGithubData(0);
        }
      });

    fetch("/api/database", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.webservers || [];
        setMonitorCount(list.length);
      })
      .catch(() => {});

    fetch("/api/abtest/results", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((data) => {
        const repos = Array.isArray(data?.data) ? data.data : [];
        const totalRuns = repos.reduce(
          (sum: number, item: { abTests?: unknown[] }) =>
            sum + (Array.isArray(item.abTests) ? item.abTests.length : 0),
          0
        );
        setPipelineCount(totalRuns);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [status]);

  if (status === "loading") {
    return (
      <div className="min-h-screen w-full bg-white text-zinc-900 flex items-center justify-center pl-12 sm:pl-16 lg:pl-18">
        <GlobalLoader />
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-white text-black py-10 pl-16 sm:pl-20 md:pl-24 pr-6 md:pr-12 lg:pr-24 overflow-y-auto scrollbtn">
      <div className="max-w-6xl mx-auto">
        <div className="w-full border border-zinc-800 bg-zinc-950 p-6 md:p-10 shadow-2xl transition-all">
          <form
            onSubmit={handleSubmit}
            className="w-full flex flex-col sm:flex-row sm:items-center gap-3 border-b border-zinc-800 pb-2 group focus-within:border-white transition-colors"
          >
            <div className="flex items-center flex-1">
              <Search
                className="text-zinc-500 group-focus-within:text-white transition-colors shrink-0"
                size={20}
              />
              <label htmlFor="target-url-input" className="sr-only">
                Target URL
              </label>
              <input
                id="target-url-input"
                type="text"
                placeholder="Enter target URL (e.g. https://example.com)"
                value={urlInput}
                onChange={handleInputChange}
                className="outline-none w-full h-12 bg-transparent text-zinc-100 px-4 font-mono text-sm tracking-wide placeholder:text-zinc-600"
              />
            </div>
            <button
              type="submit"
              disabled={checking || !urlInput.trim()}
              className="px-5 py-2.5 bg-white text-black font-mono text-xs uppercase tracking-widest hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 cursor-pointer"
            >
              {checking ? "Checking..." : "Check"}
            </button>
          </form>

          <div className="mt-8 min-h-25">
            {checking ? (
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-blue-500 animate-ping rounded-full" />
                <p className="text-sm font-mono text-zinc-400 uppercase tracking-tighter">
                  &gt; INITIALIZING_HEALTH_CHECK...
                </p>
              </div>
            ) : isstatus !== null ? (
              typeof isstatus === "object" ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    {isstatus.statusCode >= 200 && isstatus.statusCode < 400 ? (
                      <CheckCircle2 className="text-green-500" size={24} />
                    ) : (
                      <AlertTriangle className="text-red-500" size={24} />
                    )}

                    <div className="font-mono">
                      <span
                        className={`text-2xl font-bold ${
                          isstatus.statusCode < 400 ? "text-green-400" : "text-red-500"
                        }`}
                      >
                        {isstatus.statusCode}
                      </span>
                      <span className="ml-3 text-zinc-400 uppercase tracking-widest text-sm">
                        {isstatus.message}
                      </span>
                    </div>
                  </div>

                  {isstatus.details && !isstatus.diagnostic && (
                    <p className="text-xs font-mono text-red-400">{isstatus.details}</p>
                  )}

                  {isstatus.diagnostic && (
                    <div className="mt-6 border border-zinc-800 bg-black/50 p-4 relative">
                      <div className="absolute -top-3 left-4 bg-zinc-950 px-2 flex items-center gap-2">
                        <Terminal size={12} className="text-zinc-500" />
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                          Failure_Analysis_Trace
                        </span>
                      </div>

                      <pre className="text-xs font-mono text-red-400/80 leading-relaxed overflow-x-auto py-2">
                        {isstatus.diagnostic.split("|").map((part, i) => (
                          <div key={i} className="py-0.5">
                            &gt; {part.trim()}
                          </div>
                        ))}
                      </pre>

                      {isstatus.details && (
                        <p className="mt-2 text-[10px] font-mono text-zinc-500 border-t border-zinc-900 pt-2 italic">
                          SYSTEM_LOG: {isstatus.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 border border-red-900 bg-red-950/10 text-red-500 font-mono text-xs uppercase tracking-widest">
                  CRITICAL_ERROR: {isstatus}
                </div>
              )
            ) : (
              <div className="flex items-center gap-2 text-zinc-500 font-mono text-[10px] uppercase tracking-[0.2em]">
                <div className="w-1 h-1 bg-zinc-800" />
                WAITING_FOR_SEQUENCE_INITIATION
              </div>
            )}
          </div>
        </div>

        <div className="w-full grid md:grid-cols-3 justify-center items-center mt-10 gap-6 text-black">
          <Link
            href="/monitors"
            className="bg-zinc-600/20 justify-center flex flex-col items-center gap-2 font-orbitron p-8 md:p-12 hover:bg-zinc-600/30 transition-all group"
          >
            <Search className="mb-2 text-zinc-600 group-hover:text-black transition-colors" />
            <span className="text-3xl font-bold">{githubData}</span>
            <span className="text-xs uppercase tracking-widest text-zinc-600 group-hover:text-black">
              Drift Source (GitHub)
            </span>
          </Link>

          <Link
            href="/monitors"
            className="bg-zinc-600/20 justify-center flex flex-col items-center gap-2 font-orbitron p-8 md:p-12 hover:bg-zinc-600/30 transition-all group"
          >
            <Activity className="mb-2 text-zinc-600 group-hover:text-green-600 transition-colors" />
            <span className="text-3xl font-bold">{monitorCount}</span>
            <span className="text-xs uppercase tracking-widest text-zinc-600 group-hover:text-black">
              Active Monitors
            </span>
          </Link>

          <Link
            href="/pipelines"
            className="bg-zinc-600/20 justify-center flex flex-col items-center gap-2 font-orbitron p-8 md:p-12 hover:bg-zinc-600/30 transition-all group"
          >
            <Bot className="mb-2 text-zinc-600 group-hover:text-blue-600 transition-colors" />
            <span className="text-3xl font-bold">{pipelineCount}</span>
            <span className="text-xs uppercase tracking-widest text-zinc-600 group-hover:text-black">
              A/B Pipeline Runs
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Page;

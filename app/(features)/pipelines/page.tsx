/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, AlertTriangle, GitBranch, RefreshCw } from "lucide-react";
import GlobalLoader from "@/components/GlobalLoader";
import ABResultStatsModal, { ABResultData } from "@/components/modals/results/ABResultStatsModal";

export default function PipelinesPage() {
  const router = useRouter();
  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      router.replace("/");
    },
  });

  const [results, setResults] = useState<ABResultData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<ABResultData | null>(null);

  const loadPipelines = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/abtest/results", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch pipeline history");
      const data = await res.json();
      const flattened: ABResultData[] = [];
      for (const doc of data?.data || []) {
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
      flattened.sort((a, b) => new Date(b.testedAt).getTime() - new Date(a.testedAt).getTime());
      setResults(flattened);
    } catch (err: any) {
      setError(err?.message || "Unable to load pipelines");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      loadPipelines();
    }
  }, [status]);

  if (status === "loading") {
    return (
      <div className="min-h-screen w-full bg-white text-zinc-900 flex items-center justify-center pl-12 sm:pl-16 lg:pl-18">
        <GlobalLoader />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 pl-12 sm:pl-16 md:pl-16 lg:pl-18">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold font-orbitron tracking-tight text-gray-900 flex items-center gap-3">
              <Bot className="w-7 h-7" />
              A/B Test Pipelines
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Historical performance gate runs across your connected GitHub repositories
            </p>
          </div>
          <button
            type="button"
            onClick={loadPipelines}
            disabled={isLoading}
            className="px-4 py-2 bg-black text-white text-xs font-mono uppercase tracking-wider rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-mono">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, idx) => (
              <div key={idx} className="h-44 bg-white border border-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <GitBranch className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <h2 className="text-lg font-orbitron font-bold text-gray-800 mb-2">
              No Pipeline Runs Yet
            </h2>
            <p className="text-sm text-gray-500">
              Trigger an A/B performance test from the Monitors page to compare branches.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {results.map((item, idx) => {
              const passed = item.metrics?.passed !== false;
              return (
                <div
                  key={`${item.githubUrl}-${item.testedAt}-${idx}`}
                  className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <p className="text-xs font-mono text-gray-500 truncate">
                        {item.githubUrl.replace("https://github.com/", "")}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full shrink-0 ${
                          passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {passed ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        {passed ? "Passed" : "Failed"}
                      </span>
                    </div>
                    <p className="font-orbitron font-bold text-sm text-gray-900 truncate mb-3">
                      {item.metrics?.baselineBranch || "baseline"} vs{" "}
                      {item.metrics?.candidateBranch || "candidate"}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <span className="text-[11px] font-mono text-gray-400">
                      {item.testedAt ? new Date(item.testedAt).toLocaleString() : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedResult(item)}
                      className="px-3 py-1.5 text-xs font-mono bg-black text-white rounded hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ABResultStatsModal
          isOpen={!!selectedResult}
          onClose={() => setSelectedResult(null)}
          data={selectedResult}
        />
      </div>
    </div>
  );
}

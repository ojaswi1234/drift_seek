"use client";

import React, { useEffect, useMemo } from "react";
import { X, GitBranch, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  RadialLinearScale,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Radar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  RadialLinearScale,
  Filler,
  Tooltip,
  Legend
);

type MetricSet = {
  requestsPerSecond?: number;
  latencyAverage?: number;
  latency99th?: number;
  successRate?: number;
};

type TestMetrics = {
  baselineBranch?: string;
  candidateBranch?: string;
  baselineMetrics?: MetricSet;
  candidateMetrics?: MetricSet;
  passed?: boolean;
};

export type ABResultData = {
  githubUrl: string;
  testedAt: string;
  metrics: TestMetrics;
};

interface ABResultStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ABResultData | null;
}

const toFixedSafe = (value: number, decimals = 2) => {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(decimals);
};

const percentDelta = (base: number, next: number) => {
  if (!Number.isFinite(base) || !Number.isFinite(next)) return 0;
  if (base === 0) return next === 0 ? 0 : 100;
  return ((next - base) / base) * 100;
};

export default function ABResultStatsModal({ isOpen, onClose, data }: ABResultStatsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const normalized = useMemo(() => {
    if (!data) {
      return {
        repoName: "",
        testedAt: "",
        baselineBranch: "baseline",
        candidateBranch: "candidate",
        baseline: { requestsPerSecond: 0, latencyAverage: 0, latency99th: 0, successRate: 0 },
        candidate: { requestsPerSecond: 0, latencyAverage: 0, latency99th: 0, successRate: 0 },
        passed: false,
      };
    }

    const metrics = data.metrics || {};
    const baseline = {
      requestsPerSecond: Number(metrics.baselineMetrics?.requestsPerSecond || 0),
      latencyAverage: Number(metrics.baselineMetrics?.latencyAverage || 0),
      latency99th: Number(metrics.baselineMetrics?.latency99th || 0),
      successRate: Number(metrics.baselineMetrics?.successRate || 0),
    };

    const candidate = {
      requestsPerSecond: Number(metrics.candidateMetrics?.requestsPerSecond || 0),
      latencyAverage: Number(metrics.candidateMetrics?.latencyAverage || 0),
      latency99th: Number(metrics.candidateMetrics?.latency99th || 0),
      successRate: Number(metrics.candidateMetrics?.successRate || 0),
    };

    const parsedDate = data.testedAt ? new Date(data.testedAt) : null;
    const testedAtStr =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleString() : "N/A";

    return {
      repoName: (data.githubUrl || "").replace("https://github.com/", ""),
      testedAt: testedAtStr,
      baselineBranch: metrics.baselineBranch || "baseline",
      candidateBranch: metrics.candidateBranch || "candidate",
      baseline,
      candidate,
      passed: metrics.passed !== false,
    };
  }, [data]);

  const comparisonBarData = {
    labels: ["Requests/s", "Avg Latency (ms)", "P99 Latency (ms)", "Success %"],
    datasets: [
      {
        label: normalized.baselineBranch,
        data: [
          normalized.baseline.requestsPerSecond,
          normalized.baseline.latencyAverage,
          normalized.baseline.latency99th,
          normalized.baseline.successRate,
        ],
        backgroundColor: "rgba(2, 132, 199, 0.75)",
        borderRadius: 8,
      },
      {
        label: normalized.candidateBranch,
        data: [
          normalized.candidate.requestsPerSecond,
          normalized.candidate.latencyAverage,
          normalized.candidate.latency99th,
          normalized.candidate.successRate,
        ],
        backgroundColor: "rgba(22, 163, 74, 0.75)",
        borderRadius: 8,
      },
    ],
  };

  const maxRps = Math.max(normalized.baseline.requestsPerSecond, normalized.candidate.requestsPerSecond, 1);
  const maxAvgLat = Math.max(normalized.baseline.latencyAverage, normalized.candidate.latencyAverage, 1);
  const maxP99Lat = Math.max(normalized.baseline.latency99th, normalized.candidate.latency99th, 1);

  const radarData = {
    labels: ["Throughput (norm)", "Stability (%)", "Avg Speed (norm)", "Tail Speed (norm)"],
    datasets: [
      {
        label: normalized.baselineBranch,
        data: [
          (normalized.baseline.requestsPerSecond / maxRps) * 100,
          normalized.baseline.successRate,
          normalized.baseline.latencyAverage > 0
            ? Math.max(0, 100 - (normalized.baseline.latencyAverage / maxAvgLat) * 50)
            : 100,
          normalized.baseline.latency99th > 0
            ? Math.max(0, 100 - (normalized.baseline.latency99th / maxP99Lat) * 50)
            : 100,
        ],
        borderColor: "rgba(2, 132, 199, 1)",
        backgroundColor: "rgba(2, 132, 199, 0.2)",
      },
      {
        label: normalized.candidateBranch,
        data: [
          (normalized.candidate.requestsPerSecond / maxRps) * 100,
          normalized.candidate.successRate,
          normalized.candidate.latencyAverage > 0
            ? Math.max(0, 100 - (normalized.candidate.latencyAverage / maxAvgLat) * 50)
            : 100,
          normalized.candidate.latency99th > 0
            ? Math.max(0, 100 - (normalized.candidate.latency99th / maxP99Lat) * 50)
            : 100,
        ],
        borderColor: "rgba(22, 163, 74, 1)",
        backgroundColor: "rgba(22, 163, 74, 0.2)",
      },
    ],
  };

  if (!isOpen || !data) return null;

  const rpsDelta = percentDelta(
    normalized.baseline.requestsPerSecond,
    normalized.candidate.requestsPerSecond
  );
  const avgLatencyDelta = percentDelta(
    normalized.baseline.latencyAverage,
    normalized.candidate.latencyAverage
  );
  const p99Delta = percentDelta(normalized.baseline.latency99th, normalized.candidate.latency99th);
  const successDelta = percentDelta(
    normalized.baseline.successRate,
    normalized.candidate.successRate
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ab-stats-modal-title"
        className="relative w-full max-w-7xl max-h-[92vh] overflow-hidden bg-white text-gray-900 border border-gray-200 rounded-2xl shadow-2xl flex flex-col"
      >
        <div className="px-6 sm:px-8 py-6 border-b border-gray-200 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2
              id="ab-stats-modal-title"
              className="text-2xl font-orbitron font-bold tracking-wide text-black truncate"
            >
              Results Stats Dashboard
            </h2>
            <p className="text-sm font-mono text-gray-500 mt-2 truncate">{normalized.repoName}</p>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-xs font-mono text-gray-600">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-gray-200 bg-gray-50">
                <GitBranch size={13} /> {normalized.baselineBranch}
              </span>
              <span>vs</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-gray-200 bg-gray-50">
                <GitBranch size={13} /> {normalized.candidateBranch}
              </span>
              <span className="text-gray-400">{normalized.testedAt}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded ${
                normalized.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              }`}
            >
              {normalized.passed ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {normalized.passed ? "Performance Win" : "Performance Regression"}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
              aria-label="Close stats modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto overscroll-contain p-6 sm:p-8 space-y-8 scrollbtn">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DeltaStatCard label="RPS Delta" value={`${toFixedSafe(rpsDelta)}%`} positive={rpsDelta >= 0} />
            <DeltaStatCard
              label="Avg Latency Delta"
              value={`${toFixedSafe(avgLatencyDelta)}%`}
              positive={avgLatencyDelta <= 0}
            />
            <DeltaStatCard
              label="P99 Latency Delta"
              value={`${toFixedSafe(p99Delta)}%`}
              positive={p99Delta <= 0}
            />
            <DeltaStatCard
              label="Success Rate Delta"
              value={`${toFixedSafe(successDelta)}%`}
              positive={successDelta >= 0}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <section className="bg-gray-50 border border-gray-200 rounded-xl p-5">
              <h3 className="font-bold text-gray-800 mb-4">Metric Comparison</h3>
              <div className="h-[320px]">
                <Bar
                  data={comparisonBarData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: "bottom" } },
                  }}
                />
              </div>
            </section>

            <section className="bg-gray-50 border border-gray-200 rounded-xl p-5">
              <h3 className="font-bold text-gray-800 mb-4">Normalized Performance Profile</h3>
              <div className="h-[320px]">
                <Radar
                  data={radarData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { backdropColor: "transparent" },
                      },
                    },
                    plugins: { legend: { position: "bottom" } },
                  }}
                />
              </div>
            </section>
          </div>

          <section className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm text-gray-900">
              <thead className="bg-gray-50 text-gray-700 uppercase tracking-wider text-xs">
                <tr>
                  <th scope="col" className="text-left px-4 py-3">Metric</th>
                  <th scope="col" className="text-left px-4 py-3">{normalized.baselineBranch}</th>
                  <th scope="col" className="text-left px-4 py-3">{normalized.candidateBranch}</th>
                  <th scope="col" className="text-left px-4 py-3">Delta</th>
                </tr>
              </thead>
              <tbody>
                <MetricRow
                  label="Requests Per Second"
                  baseline={normalized.baseline.requestsPerSecond}
                  candidate={normalized.candidate.requestsPerSecond}
                  unit="req/s"
                  invertGoal={false}
                />
                <MetricRow
                  label="Average Latency"
                  baseline={normalized.baseline.latencyAverage}
                  candidate={normalized.candidate.latencyAverage}
                  unit="ms"
                  invertGoal
                />
                <MetricRow
                  label="P99 Latency"
                  baseline={normalized.baseline.latency99th}
                  candidate={normalized.candidate.latency99th}
                  unit="ms"
                  invertGoal
                />
                <MetricRow
                  label="Success Rate"
                  baseline={normalized.baseline.successRate}
                  candidate={normalized.candidate.successRate}
                  unit="%"
                  invertGoal={false}
                />
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}

function DeltaStatCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500 font-mono">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${positive ? "text-emerald-600" : "text-red-600"}`}>
        {value}
      </p>
    </div>
  );
}

function MetricRow({
  label,
  baseline,
  candidate,
  unit,
  invertGoal,
}: {
  label: string;
  baseline: number;
  candidate: number;
  unit: string;
  invertGoal: boolean;
}) {
  const delta = percentDelta(baseline, candidate);
  const isGood = invertGoal ? delta <= 0 : delta >= 0;

  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-3 text-gray-700">{label}</td>
      <td className="px-4 py-3 font-mono text-gray-900">
        {toFixedSafe(baseline)} {unit}
      </td>
      <td className="px-4 py-3 font-mono text-gray-900">
        {toFixedSafe(candidate)} {unit}
      </td>
      <td className={`px-4 py-3 font-mono font-bold ${isGood ? "text-emerald-600" : "text-red-600"}`}>
        {toFixedSafe(delta)}%
      </td>
    </tr>
  );
}

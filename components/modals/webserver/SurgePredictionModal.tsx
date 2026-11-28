/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Calendar,
  Bell,
  Shield,
  Zap,
  AlertTriangle,
  CheckCircle,
  Save,
  FileText,
  RefreshCw,
  Trash2,
  Plus,
  ChevronDown,
} from "lucide-react";

interface Event {
  id: string;
  name: string;
  date: string;
  type: "festival" | "launch" | "holiday" | "custom";
  description?: string;
  enabled: boolean;
}

interface SurgeConfig {
  monitorId: string;
  monitorName?: string;
  monitorUrl: string;
  events: Event[];
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
  readinessChecks: {
    cdn: boolean;
    compression: boolean;
    protocol: boolean;
    cacheHeaders: boolean;
    sslExpiry: boolean;
  };
}

interface TelemetrySummary {
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
  telemetry?: TelemetrySummary;
}

interface Monitor {
  id: string;
  name?: string;
  url: string;
}

interface SurgePredictionModalProps {
  isOpen: boolean;
  onClose: () => void;
  monitor: Monitor | null;
  onSaveConfig: (monitorId: string, config: Partial<SurgeConfig>) => Promise<void>;
  onGenerateReport: (monitorId: string) => Promise<ReadinessReport | null>;
  onTriggerCheck: (monitorId: string) => Promise<void>;
}

const EVENT_TYPES = [
  { value: "festival", label: "Festival", color: "bg-purple-100 text-purple-700", icon: Zap },
  { value: "launch", label: "Product Launch", color: "bg-blue-100 text-blue-700", icon: Shield },
  { value: "holiday", label: "Holiday", color: "bg-green-100 text-green-700", icon: Calendar },
  { value: "custom", label: "Custom", color: "bg-gray-100 text-gray-700", icon: AlertTriangle },
];

const SEVERITY_COLORS = {
  info: "bg-blue-100 text-blue-700 border-blue-200",
  warning: "bg-yellow-100 text-yellow-700 border-yellow-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

const SEVERITY_ICONS = {
  info: CheckCircle,
  warning: AlertTriangle,
  critical: AlertTriangle,
};

function toLocalDateTimeInput(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function createDefaultConfig(monitor?: Monitor | null): SurgeConfig {
  return {
    monitorId: monitor?.id || "",
    monitorName: monitor?.name || "",
    monitorUrl: monitor?.url || "",
    events: [],
    baselineInterval: 5,
    preEventInterval: 1,
    surgeInterval: 15,
    preEventWindowHours: 24,
    surgeWindowHours: 24,
    telegramEnabled: true,
    actionOnlyOnScheduledDays: false,
    activeDaysOfWeek: [],
    autoReadinessAlert: true,
    useBlackboxProbe: true,
    readinessChecks: {
      cdn: true,
      compression: true,
      protocol: true,
      cacheHeaders: true,
      sslExpiry: true,
    },
  };
}

const WEEK_DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export default function SurgePredictionModal({
  isOpen,
  onClose,
  monitor,
  onSaveConfig,
  onGenerateReport,
  onTriggerCheck,
}: SurgePredictionModalProps) {
  const [activeTab, setActiveTab] = useState<"config" | "readiness" | "timeline">("config");
  const [config, setConfig] = useState<SurgeConfig>(() => createDefaultConfig(monitor));
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [telemetryPreview, setTelemetryPreview] = useState<TelemetrySummary | null>(null);
  const [integrations, setIntegrations] = useState<{
    blackboxConfigured: boolean;
    prometheusConfigured: boolean;
  }>({ blackboxConfigured: false, prometheusConfigured: false });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isTriggeringCheck, setIsTriggeringCheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const eventIdCounter = useRef(0);
  const successTimerRef = useRef<number | null>(null);

  const showSuccess = useCallback((message: string) => {
    setSuccess(message);
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    successTimerRef.current = window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const loadConfig = useCallback(
    async (signal?: AbortSignal) => {
      if (!monitor) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/monitor/${monitor.id}/surge-config`, { signal });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.message || "Failed to load configuration");
        }
        if (data.config) {
          setConfig((prev) => ({
            ...prev,
            ...data.config,
            monitorId: monitor.id,
            monitorName: monitor.name || "",
            monitorUrl: monitor.url,
            activeDaysOfWeek: Array.isArray(data.config.activeDaysOfWeek)
              ? data.config.activeDaysOfWeek
              : [],
            actionOnlyOnScheduledDays: Boolean(data.config.actionOnlyOnScheduledDays),
            autoReadinessAlert: data.config.autoReadinessAlert ?? true,
            useBlackboxProbe: data.config.useBlackboxProbe ?? true,
            events: Array.isArray(data.config.events)
              ? data.config.events.map((e: any) => ({
                  ...e,
                  date: toLocalDateTimeInput(e.date),
                }))
              : [],
          }));
          if (data.config.lastReadinessReport?.report) {
            setReport(data.config.lastReadinessReport.report);
          }
        }
        if (data.telemetry) {
          setTelemetryPreview(data.telemetry);
        }
        if (data.integrations) {
          setIntegrations(data.integrations);
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setError(err?.message || "Failed to load configuration");
        }
      } finally {
        setIsLoading(false);
      }
    },
    [monitor]
  );

  useEffect(() => {
    if (!isOpen || !monitor) {
      setReport(null);
      setError(null);
      setSuccess(null);
      setActiveTab("config");
      setExpandedEvents(new Set());
      return;
    }

    setConfig(createDefaultConfig(monitor));
    setReport(null);
    setTelemetryPreview(null);
    setError(null);
    setSuccess(null);
    setActiveTab("config");
    setExpandedEvents(new Set());

    const controller = new AbortController();
    loadConfig(controller.signal);
    return () => controller.abort();
  }, [monitor, isOpen, loadConfig]);

  const handleSaveConfig = async (closeAfterSave = false) => {
    if (!monitor) return;

    for (const evt of config.events) {
      if (!evt.name.trim()) {
        setError("Every scheduled event must have a name.");
        return;
      }
      if (!evt.date || Number.isNaN(new Date(evt.date).getTime())) {
        setError(`Invalid date for event "${evt.name}".`);
        return;
      }
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Partial<SurgeConfig> = {
        ...config,
        baselineInterval: Math.min(60, Math.max(1, Number(config.baselineInterval) || 5)),
        preEventInterval: Math.min(10, Math.max(1, Number(config.preEventInterval) || 1)),
        surgeInterval: Math.min(60, Math.max(5, Number(config.surgeInterval) || 15)),
        preEventWindowHours: Math.min(72, Math.max(1, Number(config.preEventWindowHours) || 24)),
        surgeWindowHours: Math.min(72, Math.max(1, Number(config.surgeWindowHours) || 24)),
        events: config.events.map((e) => ({
          ...e,
          name: e.name.trim(),
          date: new Date(e.date).toISOString(),
        })),
      };

      await onSaveConfig(monitor.id, payload);
      if (closeAfterSave) {
        onClose();
      } else {
        showSuccess("Configuration saved successfully!");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!monitor) return;
    setIsGeneratingReport(true);
    setError(null);
    try {
      const result = await onGenerateReport(monitor.id);
      if (result) {
        setReport(result);
        showSuccess("Readiness report generated!");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to generate report");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleTriggerCheck = async () => {
    if (!monitor) return;
    setIsTriggeringCheck(true);
    setError(null);
    try {
      await onTriggerCheck(monitor.id);
      showSuccess("Manual check completed!");
      await loadConfig();
    } catch (err: any) {
      setError(err?.message || "Failed to trigger check");
    } finally {
      setIsTriggeringCheck(false);
    }
  };

  const addEvent = () => {
    const defaultDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const newEvent: Event = {
      id: `evt_${Date.now()}_${eventIdCounter.current++}`,
      name: "",
      date: toLocalDateTimeInput(defaultDate),
      type: "custom",
      description: "",
      enabled: true,
    };
    setConfig((prev) => ({ ...prev, events: [...prev.events, newEvent] }));
    setExpandedEvents((prev) => new Set([...prev, newEvent.id]));
  };

  const updateEvent = (id: string, updates: Partial<Event>) => {
    setConfig((prev) => ({
      ...prev,
      events: prev.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    }));
  };

  const deleteEvent = (id: string) => {
    setConfig((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== id) }));
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleEventExpanded = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!isOpen || !monitor) return null;

  const enabledEvents = config.events
    .filter((e) => e.enabled && e.date && !Number.isNaN(new Date(e.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="surge-modal-title"
        className="relative bg-white text-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <div className="min-w-0 pr-4">
            <h2 id="surge-modal-title" className="text-2xl font-orbitron font-bold text-black">
              Surge Prediction
            </h2>
            <p className="text-sm text-gray-500 font-mono mt-1 truncate">{monitor.url}</p>
          </div>
          <button
            type="button"
            aria-label="Close surge prediction dialog"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <X size={24} />
          </button>
        </div>

        <div role="tablist" aria-label="Surge prediction views" className="flex border-b border-gray-100 shrink-0">
          {[
            { id: "config", label: "Configuration", icon: Shield },
            { id: "readiness", label: "Readiness Report", icon: FileText },
            { id: "timeline", label: "Event Timeline", icon: Calendar },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id as "config" | "readiness" | "timeline")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "text-black border-b-2 border-black"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg border border-red-200 text-sm flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-lg border border-green-200 text-sm flex items-center gap-2">
              <CheckCircle size={16} className="shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {activeTab === "config" && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <h3 className="font-orbitron font-bold text-lg text-black mb-4 flex items-center gap-2">
                  <Zap className="text-black" size={20} />
                  Adaptive Monitoring Intervals
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Configure how frequently the watchtower checks your monitor during different phases.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label
                      htmlFor="baseline-interval"
                      className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                    >
                      Baseline (min)
                    </label>
                    <input
                      id="baseline-interval"
                      type="number"
                      min={1}
                      max={60}
                      value={config.baselineInterval}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          baselineInterval: Number.isNaN(val) ? 1 : val,
                        }));
                      }}
                      className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Normal operation (1-60m)</p>
                  </div>
                  <div>
                    <label
                      htmlFor="preevent-interval"
                      className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                    >
                      Pre-Event (min)
                    </label>
                    <input
                      id="preevent-interval"
                      type="number"
                      min={1}
                      max={10}
                      value={config.preEventInterval}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          preEventInterval: Number.isNaN(val) ? 1 : val,
                        }));
                      }}
                      className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Ramp-up before event (1-10m)</p>
                  </div>
                  <div>
                    <label
                      htmlFor="surge-interval"
                      className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                    >
                      Surge (sec)
                    </label>
                    <input
                      id="surge-interval"
                      type="number"
                      min={5}
                      max={60}
                      value={config.surgeInterval}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          surgeInterval: Number.isNaN(val) ? 5 : val,
                        }));
                      }}
                      className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">During event (5-60s)</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <h3 className="font-orbitron font-bold text-lg text-black mb-4 flex items-center gap-2">
                  <Calendar className="text-black" size={20} />
                  Event Windows
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="preevent-window"
                      className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                    >
                      Pre-Event Window (hrs)
                    </label>
                    <input
                      id="preevent-window"
                      type="number"
                      min={1}
                      max={72}
                      value={config.preEventWindowHours}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          preEventWindowHours: Number.isNaN(val) ? 1 : val,
                        }));
                      }}
                      className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Hours before event to increase frequency</p>
                  </div>
                  <div>
                    <label
                      htmlFor="surge-window"
                      className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                    >
                      Surge Window (hrs)
                    </label>
                    <input
                      id="surge-window"
                      type="number"
                      min={1}
                      max={72}
                      value={config.surgeWindowHours}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          surgeWindowHours: Number.isNaN(val) ? 1 : val,
                        }));
                      }}
                      className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Hours after event to maintain surge frequency</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-orbitron font-bold text-lg text-black flex items-center gap-2">
                    <Bell className="text-black" size={20} />
                    Notifications &amp; Active Days
                  </h3>
                  <div className="flex items-center gap-2 text-[10px] font-mono">
                    <span
                      className={`px-2 py-0.5 rounded border ${
                        integrations.blackboxConfigured
                          ? "bg-green-100 text-green-700 border-green-200"
                          : "bg-gray-100 text-gray-600 border-gray-200"
                      }`}
                    >
                      Blackbox: {integrations.blackboxConfigured ? "Connected" : "Fallback HTTP"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded border ${
                        integrations.prometheusConfigured
                          ? "bg-green-100 text-green-700 border-green-200"
                          : "bg-gray-100 text-gray-600 border-gray-200"
                      }`}
                    >
                      Prometheus: {integrations.prometheusConfigured ? "Connected" : "Mongo History"}
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.telegramEnabled}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, telegramEnabled: e.target.checked }))
                      }
                      className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                    />
                    <span className="text-sm text-gray-700">
                      Send Telegram alerts for outages &amp; surge briefs
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.autoReadinessAlert}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, autoReadinessAlert: e.target.checked }))
                      }
                      className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                    />
                    <span className="text-sm text-gray-700">
                      Auto-run Pre-Event Readiness Audit &amp; send Telegram brief before events
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.useBlackboxProbe}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, useBlackboxProbe: e.target.checked }))
                      }
                      className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                    />
                    <span className="text-sm text-gray-700">
                      Prefer Prometheus Blackbox Exporter phase probing (TTFB / connect / TLS) when configured
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={config.actionOnlyOnScheduledDays}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          actionOnlyOnScheduledDays: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 mt-0.5 accent-black rounded border-gray-300 focus:ring-black"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">
                        Run 24/7 silently — take action only on specified days
                      </span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Collects baseline TTFB &amp; jitter metrics 24/7, while Telegram alerts and automated
                        readiness actions only fire on your selected days below or during active Scheduled Events.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="pt-2 border-t border-gray-200/80">
                  <p className="text-xs font-mono text-gray-600 uppercase tracking-wider mb-2">
                    Recurring Active Days (UTC)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {WEEK_DAYS.map((day) => {
                      const selected = config.activeDaysOfWeek.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              activeDaysOfWeek: selected
                                ? prev.activeDaysOfWeek.filter((d) => d !== day.value)
                                : [...prev.activeDaysOfWeek, day.value].sort((a, b) => a - b),
                            }))
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors cursor-pointer ${
                            selected
                              ? "bg-black text-white border-black"
                              : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <h3 className="font-orbitron font-bold text-lg text-black mb-4 flex items-center gap-2">
                  <Shield className="text-black" size={20} />
                  Readiness Checks
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Select which checks to run during readiness report generation.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { key: "cdn", label: "CDN Detection", desc: "Cloudflare, CloudFront, etc." },
                    { key: "compression", label: "Compression", desc: "Gzip, Brotli, Deflate" },
                    { key: "protocol", label: "HTTP Protocol", desc: "HTTP/2, HTTP/3 support" },
                    { key: "cacheHeaders", label: "Cache Headers", desc: "Cache-Control, stale-while-revalidate" },
                    { key: "sslExpiry", label: "SSL Expiry", desc: "Certificate validity check" },
                  ].map((check) => (
                    <label
                      key={check.key}
                      className="flex items-center gap-3 cursor-pointer p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={
                          config.readinessChecks[check.key as keyof typeof config.readinessChecks]
                        }
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            readinessChecks: {
                              ...prev.readinessChecks,
                              [check.key]: e.target.checked,
                            },
                          }))
                        }
                        className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{check.label}</p>
                        <p className="text-[10px] text-gray-500">{check.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-orbitron font-bold text-lg text-black flex items-center gap-2">
                    <Calendar className="text-black" size={20} />
                    Scheduled Events
                  </h3>
                  <button
                    type="button"
                    onClick={addEvent}
                    className="px-3 py-1.5 text-xs font-mono bg-black text-white rounded hover:bg-zinc-800 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={12} /> Add Event
                  </button>
                </div>

                {config.events.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                    <Calendar className="mx-auto text-gray-300 mb-2" size={32} />
                    <p>No events scheduled. Add events to enable adaptive monitoring.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {config.events.map((event) => {
                      const eventType =
                        EVENT_TYPES.find((t) => t.value === event.type) || EVENT_TYPES[3];
                      const EventIcon = eventType.icon;
                      const isExpanded = expandedEvents.has(event.id);
                      const eventDate = new Date(event.date);
                      const isValidDate = !Number.isNaN(eventDate.getTime());
                      const now = new Date();
                      const isUpcoming = isValidDate && eventDate > now;
                      const daysUntil = isValidDate
                        ? Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        : 0;

                      return (
                        <div
                          key={event.id}
                          className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => toggleEventExpanded(event.id)}
                            className="w-full p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                          >
                            <div className={`p-2 rounded-lg ${eventType.color} shrink-0`}>
                              <EventIcon size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-gray-900 truncate">
                                  {event.name || "Unnamed Event"}
                                </span>
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${eventType.color}`}>
                                  {eventType.label}
                                </span>
                                {event.enabled ? (
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-green-100 text-green-700">
                                    Active
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                                    Disabled
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500 font-mono mt-1">
                                {isValidDate
                                  ? `${eventDate.toLocaleDateString()} at ${eventDate.toLocaleTimeString(
                                      [],
                                      { hour: "2-digit", minute: "2-digit" }
                                    )}${
                                      isUpcoming
                                        ? ` • in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`
                                        : ` • ${Math.abs(daysUntil)} day${
                                            Math.abs(daysUntil) !== 1 ? "s" : ""
                                          } ago`
                                    }`
                                  : "No date selected"}
                              </p>
                            </div>
                            <ChevronDown
                              className={`text-gray-400 transition-transform ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              size={16}
                            />
                          </button>

                          {isExpanded && (
                            <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label
                                    htmlFor={`evt-name-${event.id}`}
                                    className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                                  >
                                    Event Name
                                  </label>
                                  <input
                                    id={`evt-name-${event.id}`}
                                    type="text"
                                    value={event.name}
                                    onChange={(e) =>
                                      updateEvent(event.id, { name: e.target.value })
                                    }
                                    className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                    placeholder="e.g., Black Friday Sale"
                                  />
                                </div>
                                <div>
                                  <label
                                    htmlFor={`evt-type-${event.id}`}
                                    className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                                  >
                                    Type
                                  </label>
                                  <select
                                    id={`evt-type-${event.id}`}
                                    value={event.type}
                                    onChange={(e) =>
                                      updateEvent(event.id, {
                                        type: e.target.value as Event["type"],
                                      })
                                    }
                                    className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                  >
                                    {EVENT_TYPES.map((t) => (
                                      <option key={t.value} value={t.value}>
                                        {t.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label
                                    htmlFor={`evt-date-${event.id}`}
                                    className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                                  >
                                    Date & Time
                                  </label>
                                  <input
                                    id={`evt-date-${event.id}`}
                                    type="datetime-local"
                                    value={event.date}
                                    onChange={(e) =>
                                      updateEvent(event.id, { date: e.target.value })
                                    }
                                    className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                  />
                                </div>
                                <div className="flex items-end">
                                  <label className="flex items-center gap-2 cursor-pointer w-full">
                                    <input
                                      type="checkbox"
                                      checked={event.enabled}
                                      onChange={(e) =>
                                        updateEvent(event.id, { enabled: e.target.checked })
                                      }
                                      className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                                    />
                                    <span className="text-sm text-gray-700">Enabled</span>
                                  </label>
                                </div>
                              </div>
                              <div>
                                <label
                                  htmlFor={`evt-desc-${event.id}`}
                                  className="block text-xs font-mono text-gray-600 mb-1 uppercase tracking-wider"
                                >
                                  Description
                                </label>
                                <textarea
                                  id={`evt-desc-${event.id}`}
                                  value={event.description || ""}
                                  onChange={(e) =>
                                    updateEvent(event.id, { description: e.target.value })
                                  }
                                  rows={2}
                                  className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                  placeholder="Optional description..."
                                />
                              </div>
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => deleteEvent(event.id)}
                                  className="px-3 py-1.5 text-xs font-mono text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 size={12} /> Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => handleSaveConfig(false)}
                  disabled={isSaving || isLoading}
                  className="px-6 py-3 bg-black text-white uppercase text-sm tracking-widest hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Save size={16} />
                  {isSaving ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "readiness" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="font-orbitron font-bold text-lg text-black flex items-center gap-2">
                  <FileText className="text-black" size={20} />
                  Readiness Report
                </h3>
                <button
                  type="button"
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport}
                  className="px-4 py-2 bg-black text-white text-sm font-mono rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw size={14} className={isGeneratingReport ? "animate-spin" : ""} />
                  {isGeneratingReport ? "Generating..." : "Generate Report"}
                </button>
              </div>

              {report ? (
                <div className="space-y-6">
                  <div
                    className={`rounded-xl p-6 border ${
                      report.score >= 80
                        ? "border-green-200 bg-green-50"
                        : report.score >= 60
                          ? "border-yellow-200 bg-yellow-50"
                          : "border-red-200 bg-red-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-gray-500 font-mono uppercase tracking-wider">
                            Readiness Score
                          </p>
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/80 border border-gray-200 text-gray-700">
                            {report.forecastBasis === "historical-telemetry"
                              ? "Historical Telemetry Forecast"
                              : "Header Heuristic Forecast"}
                          </span>
                        </div>
                        <p
                          className={`text-5xl font-orbitron font-bold ${
                            report.score >= 80
                              ? "text-green-700"
                              : report.score >= 60
                                ? "text-yellow-700"
                                : "text-red-700"
                          }`}
                        >
                          {report.score}/100
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {report.checks.filter((c) => c.passed).length} of {report.checks.length}{" "}
                          checks passed
                        </p>
                      </div>
                      <div className="text-right">
                        {report.predictedPeakMultiplier !== undefined && (
                          <div className="mb-2">
                            <p className="text-sm text-gray-500 font-mono uppercase tracking-wider">
                              Risk Multiplier
                            </p>
                            <p className="text-2xl font-orbitron font-bold text-orange-600">
                              {report.predictedPeakMultiplier}x
                            </p>
                          </div>
                        )}
                        {report.crashProbability !== undefined && (
                          <div>
                            <p className="text-sm text-gray-500 font-mono uppercase tracking-wider">
                              Crash Probability
                            </p>
                            <p className="text-2xl font-orbitron font-bold text-red-600">
                              {report.crashProbability}%
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {(report.telemetry || telemetryPreview) && (() => {
                    const telemetry = report.telemetry || telemetryPreview!;
                    const samples = telemetry.recentSamples || [];
                    const maxLatency = Math.max(100, ...samples.map((s) => s.latencyMs || 0));
                    return (
                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-orbitron font-bold text-xs text-gray-800 uppercase tracking-wider">
                            24/7 Collected External Telemetry ({telemetry.sampleCount} samples)
                          </h4>
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                            Source: {telemetry.telemetrySource}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-white p-3 rounded-lg border border-gray-100">
                            <p className="text-[10px] font-mono text-gray-500 uppercase">Baseline TTFB</p>
                            <p className="text-base font-bold font-orbitron text-gray-900">
                              {telemetry.baselineTtfbMs !== null ? `${telemetry.baselineTtfbMs}ms` : "--"}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded-lg border border-gray-100">
                            <p className="text-[10px] font-mono text-gray-500 uppercase">Recent TTFB</p>
                            <p className="text-base font-bold font-orbitron text-gray-900">
                              {telemetry.recentTtfbMs !== null ? `${telemetry.recentTtfbMs}ms` : "--"}
                              {telemetry.ttfbGrowthRatio !== null && (
                                <span className="text-[10px] font-mono text-gray-500 ml-1">
                                  ({telemetry.ttfbGrowthRatio}x)
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded-lg border border-gray-100">
                            <p className="text-[10px] font-mono text-gray-500 uppercase">Jitter (StdDev)</p>
                            <p className="text-base font-bold font-orbitron text-gray-900">
                              {telemetry.jitterMs !== null ? `±${telemetry.jitterMs}ms` : "--"}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded-lg border border-gray-100">
                            <p className="text-[10px] font-mono text-gray-500 uppercase">
                              Error % / Cache
                            </p>
                            <p className="text-base font-bold font-orbitron text-gray-900">
                              {telemetry.errorRatePercent}% / {telemetry.lastCacheStatus}
                            </p>
                          </div>
                        </div>
                        {samples.length > 0 && (
                          <div>
                            <p className="text-[10px] font-mono text-gray-500 uppercase mb-1.5">
                              Recent Probe Latency Curve (Last {samples.length} checks)
                            </p>
                            <div className="h-14 flex items-end gap-1.5 bg-white p-2 rounded-lg border border-gray-100">
                              {samples.map((s, idx) => {
                                const heightPct = Math.max(
                                  12,
                                  Math.round(((s.latencyMs || 0) / maxLatency) * 100)
                                );
                                return (
                                  <div
                                    key={`${s.timestamp}-${idx}`}
                                    title={`${new Date(s.timestamp).toLocaleString()} • ${s.latencyMs}ms (TTFB ${s.ttfbMs}ms) • ${s.mode}`}
                                    className={`flex-1 rounded-t transition-all ${
                                      s.status === "down"
                                        ? "bg-red-500"
                                        : s.mode === "surge"
                                          ? "bg-amber-500"
                                          : "bg-emerald-500"
                                    }`}
                                    style={{ height: `${heightPct}%` }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div>
                    <h4 className="font-orbitron font-bold text-sm text-gray-700 mb-3 uppercase tracking-wider">
                      Individual Checks
                    </h4>
                    <div className="space-y-2">
                      {report.checks.map((check, index) => {
                        const SeverityIcon = SEVERITY_ICONS[check.severity];
                        return (
                          <div
                            key={index}
                            className={`flex items-start gap-3 p-4 rounded-lg border ${
                              SEVERITY_COLORS[check.severity]
                            }`}
                          >
                            <div className="shrink-0 mt-0.5">
                              <SeverityIcon size={18} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">{check.name}</span>
                                <span
                                  className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize ${
                                    check.passed
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {check.passed ? "Passed" : "Failed"}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{check.message}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {report.recommendations.length > 0 && (
                    <div>
                      <h4 className="font-orbitron font-bold text-sm text-gray-700 mb-3 uppercase tracking-wider">
                        Recommendations
                      </h4>
                      <div className="space-y-2">
                        {report.recommendations.map((rec, index) => (
                          <div
                            key={index}
                            className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-lg"
                          >
                            <AlertTriangle className="text-blue-600 mt-0.5 shrink-0" size={18} />
                            <p className="text-sm text-blue-800">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                !isGeneratingReport && (
                  <div className="text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                    <FileText className="mx-auto text-gray-300 mb-3" size={48} />
                    <p className="text-gray-500">
                      Click &quot;Generate Report&quot; to run readiness checks on your monitor.
                    </p>
                    <p className="text-sm text-gray-400 mt-2">
                      This will test CDN, compression, protocol, caching, and SSL.
                    </p>
                  </div>
                )
              )}
            </div>
          )}

          {activeTab === "timeline" && (
            <div className="space-y-6">
              <h3 className="font-orbitron font-bold text-lg text-black flex items-center gap-2">
                <Calendar className="text-black" size={20} />
                Event Timeline
              </h3>
              <p className="text-sm text-gray-500">
                Visual overview of your active scheduled events and monitoring phases.
              </p>

              {enabledEvents.length === 0 ? (
                <div className="text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                  <Calendar className="mx-auto text-gray-300 mb-3" size={48} />
                  <p className="text-gray-500">No active events scheduled.</p>
                  <p className="text-sm text-gray-400 mt-2">
                    Add or enable events in the Configuration tab to see the timeline.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {enabledEvents.map((event) => {
                    const eventType =
                      EVENT_TYPES.find((t) => t.value === event.type) || EVENT_TYPES[3];
                    const EventIcon = eventType.icon;
                    const eventDate = new Date(event.date);
                    const now = new Date();
                    const preEventStart = new Date(
                      eventDate.getTime() - config.preEventWindowHours * 60 * 60 * 1000
                    );
                    const surgeEnd = new Date(
                      eventDate.getTime() + config.surgeWindowHours * 60 * 60 * 1000
                    );

                    const isPast = eventDate < now;
                    const isPreEvent = now >= preEventStart && now < eventDate;
                    const isSurge = now >= eventDate && now <= surgeEnd;
                    const isUpcoming = now < preEventStart;

                    return (
                      <div
                        key={event.id}
                        className="relative p-4 bg-white rounded-lg border border-gray-200"
                      >
                        <div className="flex items-start gap-4">
                          <div className={`p-3 rounded-lg ${eventType.color} shrink-0`}>
                            <EventIcon size={20} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900">
                                {event.name || "Unnamed Event"}
                              </span>
                              <span
                                className={`text-[10px] font-mono px-2 py-0.5 rounded ${eventType.color}`}
                              >
                                {eventType.label}
                              </span>
                            </div>
                            <p className="text-sm text-gray-500 font-mono">
                              {eventDate.toLocaleDateString()} at{" "}
                              {eventDate.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                            {event.description && (
                              <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <span
                              className={`text-xs font-mono px-2 py-1 rounded ${
                                isSurge
                                  ? "bg-red-100 text-red-700"
                                  : isPreEvent
                                    ? "bg-orange-100 text-orange-700"
                                    : isUpcoming
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {isSurge
                                ? "SURGE"
                                : isPreEvent
                                  ? "PRE-EVENT"
                                  : isUpcoming
                                    ? "UPCOMING"
                                    : "COMPLETED"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 relative h-10">
                          <div className="absolute left-0 right-0 top-3 h-1.5 bg-gray-200 rounded-full" />

                          <div
                            className="absolute top-3 h-1.5 bg-orange-300 rounded-l-full"
                            style={{
                              left: "0%",
                              width: `${isPast || isPreEvent || isSurge ? 30 : 0}%`,
                            }}
                          />

                          <div
                            className="absolute top-1 w-0.5 h-5 bg-black"
                            style={{ left: "30%" }}
                          />

                          <div
                            className="absolute top-3 h-1.5 bg-red-300 rounded-r-full"
                            style={{
                              left: "30%",
                              width: `${isSurge || isPast ? 70 : 0}%`,
                            }}
                          />

                          {(isPreEvent || isSurge) && (
                            <div
                              className="absolute top-1.5 w-3 h-3 bg-black rounded-full -translate-x-1/2 border-2 border-white shadow-lg"
                              style={{ left: isPreEvent ? "15%" : "65%" }}
                            />
                          )}

                          <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] font-mono text-gray-400">
                            <span>Pre-Event</span>
                            <span>Event</span>
                            <span>Surge</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-gray-100 shrink-0 bg-gray-50">
          <button
            type="button"
            onClick={handleTriggerCheck}
            disabled={isTriggeringCheck}
            className="px-4 py-2 text-sm font-mono text-gray-700 hover:text-black hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            <Zap size={14} className={isTriggeringCheck ? "animate-spin" : ""} />
            {isTriggeringCheck ? "Checking..." : "Trigger Manual Check"}
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-mono text-gray-700 hover:text-black hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handleSaveConfig(true)}
              disabled={isSaving || isLoading}
              className="px-4 py-2 bg-black text-white text-sm font-mono rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <Save size={14} />
              {isSaving ? "Saving..." : "Save & Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

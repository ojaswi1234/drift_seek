"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Calendar, Bell, Shield, Zap, AlertTriangle, CheckCircle, Loader2, Save, FileText, RefreshCw, Trash2, Plus, ChevronDown, ChevronUp } from "lucide-react";

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

export default function SurgePredictionModal({
  isOpen,
  onClose,
  monitor,
  onSaveConfig,
  onGenerateReport,
  onTriggerCheck,
}: SurgePredictionModalProps) {
  const [activeTab, setActiveTab] = useState<"config" | "readiness" | "timeline">("config");
  const [config, setConfig] = useState<SurgeConfig>({
    monitorId: "",
    monitorName: "",
    monitorUrl: "",
    events: [],
    baselineInterval: 5,
    preEventInterval: 1,
    surgeInterval: 15,
    preEventWindowHours: 24,
    surgeWindowHours: 24,
    telegramEnabled: true,
    readinessChecks: {
      cdn: true,
      compression: true,
      protocol: true,
      cacheHeaders: true,
      sslExpiry: true,
    },
  });
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isTriggeringCheck, setIsTriggeringCheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const eventIdCounter = useRef(0);

  // Load config when monitor changes
  useEffect(() => {
    if (monitor && isOpen) {
      loadConfig();
    }
  }, [monitor, isOpen]);

  const loadConfig = async () => {
    if (!monitor) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/monitor/${monitor.id}/surge-config`);
      const data = await res.json();
      if (data.config) {
        setConfig({
          ...config,
          ...data.config,
          monitorId: monitor.id,
          monitorName: monitor.name || "",
          monitorUrl: monitor.url,
          events: data.config.events?.map((e: any) => ({
            ...e,
            date: new Date(e.date).toISOString().slice(0, 16),
          })) || [],
        });
      }
    } catch (err: any) {
      setError("Failed to load configuration");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!monitor) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await onSaveConfig(monitor.id, config);
      setSuccess("Configuration saved successfully!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to save configuration");
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
        setSuccess("Readiness report generated!");
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || "Failed to generate report");
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
      setSuccess("Manual check triggered!");
      setTimeout(() => setSuccess(null), 3000);
      // Reload config to get updated stats
      loadConfig();
    } catch (err: any) {
      setError(err.message || "Failed to trigger check");
    } finally {
      setIsTriggeringCheck(false);
    }
  };

  const addEvent = () => {
    const newEvent: Event = {
      id: `evt_${Date.now()}_${eventIdCounter.current++}`,
      name: "",
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
      type: "custom",
      description: "",
      enabled: true,
    };
    setConfig(prev => ({ ...prev, events: [...prev.events, newEvent] }));
    setExpandedEvents(prev => new Set([...prev, newEvent.id]));
  };

  const updateEvent = (id: string, updates: Partial<Event>) => {
    setConfig(prev => ({
      ...prev,
      events: prev.events.map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  };

  const deleteEvent = (id: string) => {
    setConfig(prev => ({ ...prev, events: prev.events.filter(e => e.id !== id) }));
    setExpandedEvents(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleEventExpanded = (id: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!isOpen || !monitor) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-2xl font-orbitron font-bold text-black">Surge Prediction</h2>
            <p className="text-sm text-gray-500 font-mono mt-1">{monitor.url}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0">
          {[
            { id: "config", label: "Configuration", icon: Shield },
            { id: "readiness", label: "Readiness Report", icon: FileText },
            { id: "timeline", label: "Event Timeline", icon: Calendar },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg border border-red-200 text-sm flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-lg border border-green-200 text-sm flex items-center gap-2">
              <CheckCircle size={16} />
              {success}
            </div>
          )}

          {/* CONFIG TAB */}
          {activeTab === "config" && (
            <div className="space-y-6">
              {/* Monitoring Intervals */}
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
                    <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Baseline (min)</label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={config.baselineInterval}
                      onChange={e => setConfig(prev => ({ ...prev, baselineInterval: parseInt(e.target.value) || 5 }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Normal operation interval</p>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Pre-Event (min)</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={config.preEventInterval}
                      onChange={e => setConfig(prev => ({ ...prev, preEventInterval: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Ramp-up before event</p>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Surge (sec)</label>
                    <input
                      type="number"
                      min="5"
                      max="60"
                      value={config.surgeInterval}
                      onChange={e => setConfig(prev => ({ ...prev, surgeInterval: parseInt(e.target.value) || 15 }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">During event (seconds)</p>
                  </div>
                </div>
              </div>

              {/* Event Windows */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <h3 className="font-orbitron font-bold text-lg text-black mb-4 flex items-center gap-2">
                  <Calendar className="text-black" size={20} />
                  Event Windows
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Pre-Event Window (hrs)</label>
                    <input
                      type="number"
                      min="1"
                      max="72"
                      value={config.preEventWindowHours}
                      onChange={e => setConfig(prev => ({ ...prev, preEventWindowHours: parseInt(e.target.value) || 24 }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Hours before event to increase frequency</p>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Surge Window (hrs)</label>
                    <input
                      type="number"
                      min="1"
                      max="72"
                      value={config.surgeWindowHours}
                      onChange={e => setConfig(prev => ({ ...prev, surgeWindowHours: parseInt(e.target.value) || 24 }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Hours after event to maintain surge frequency</p>
                  </div>
                </div>
              </div>

              {/* Notifications */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <h3 className="font-orbitron font-bold text-lg text-black mb-4 flex items-center gap-2">
                  <Bell className="text-black" size={20} />
                  Notifications
                </h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.telegramEnabled}
                    onChange={e => setConfig(prev => ({ ...prev, telegramEnabled: e.target.checked }))}
                    className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                  />
                  <span className="text-sm text-gray-700">Send Telegram alerts for status changes</span>
                </label>
              </div>

              {/* Readiness Checks */}
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
                  ].map(check => (
                    <label key={check.key} className="flex items-center gap-3 cursor-pointer p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                      <input
                        type="checkbox"
                        checked={config.readinessChecks[check.key as keyof typeof config.readinessChecks]}
                        onChange={e => setConfig(prev => ({
                          ...prev,
                          readinessChecks: { ...prev.readinessChecks, [check.key]: e.target.checked }
                        }))}
                        className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{check.label}</p>
                        <p className="text-[10px] text-gray-400">{check.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Events */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-orbitron font-bold text-lg text-black flex items-center gap-2">
                    <Calendar className="text-black" size={20} />
                    Scheduled Events
                  </h3>
                  <button
                    onClick={addEvent}
                    className="px-3 py-1.5 text-xs font-mono bg-black text-white rounded hover:bg-zinc-800 transition-colors flex items-center gap-1"
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
                    {config.events.map((event, index) => {
                      const eventType = EVENT_TYPES.find(t => t.value === event.type) || EVENT_TYPES[3];
                      const EventIcon = eventType.icon;
                      const isExpanded = expandedEvents.has(event.id);
                      const eventDate = new Date(event.date);
                      const now = new Date();
                      const isUpcoming = eventDate > now;
                      const daysUntil = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                      return (
                        <div key={event.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                          <button
                            onClick={() => toggleEventExpanded(event.id)}
                            className="w-full p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                          >
                            <div className={`p-2 rounded-lg ${eventType.color} shrink-0`}>
                              <EventIcon size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 truncate">{event.name || "Unnamed Event"}</span>
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${eventType.color}`}>
                                  {eventType.label}
                                </span>
                                {event.enabled && (
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-green-100 text-green-700">
                                    Active
                                  </span>
                                )}
                                {!event.enabled && (
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                                    Disabled
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500 font-mono mt-1">
                                {eventDate.toLocaleDateString()} at {eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                {isUpcoming && ` • in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`}
                                {!isUpcoming && ` • ${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} ago`}
                              </p>
                            </div>
                            <ChevronDown className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} size={16} />
                          </button>

                          {isExpanded && (
                            <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Event Name</label>
                                  <input
                                    type="text"
                                    value={event.name}
                                    onChange={e => updateEvent(event.id, { name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                    placeholder="e.g., Black Friday Sale"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Type</label>
                                  <select
                                    value={event.type}
                                    onChange={e => updateEvent(event.id, { type: e.target.value as Event['type'] })}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                  >
                                    {EVENT_TYPES.map(t => (
                                      <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Date & Time</label>
                                  <input
                                    type="datetime-local"
                                    value={event.date}
                                    onChange={e => updateEvent(event.id, { date: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                  />
                                </div>
                                <div className="flex items-end">
                                  <label className="flex items-center gap-2 cursor-pointer w-full">
                                    <input
                                      type="checkbox"
                                      checked={event.enabled}
                                      onChange={e => updateEvent(event.id, { enabled: e.target.checked })}
                                      className="w-4 h-4 accent-black rounded border-gray-300 focus:ring-black"
                                    />
                                    <span className="text-sm text-gray-700">Enabled</span>
                                  </label>
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-mono text-gray-500 mb-1 uppercase tracking-wider">Description</label>
                                <textarea
                                  value={event.description || ""}
                                  onChange={e => updateEvent(event.id, { description: e.target.value })}
                                  rows={2}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-sm"
                                  placeholder="Optional description..."
                                />
                              </div>
                              <div className="flex justify-end">
                                <button
                                  onClick={() => deleteEvent(event.id)}
                                  className="px-3 py-1.5 text-xs font-mono text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors flex items-center gap-1"
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

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                  onClick={handleSaveConfig}
                  disabled={isSaving || isLoading}
                  className="px-6 py-3 bg-black text-white uppercase text-sm tracking-widest hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Save size={16} />
                  {isSaving ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </div>
          )}

          {/* READINESS TAB */}
          {activeTab === "readiness" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="font-orbitron font-bold text-lg text-black flex items-center gap-2">
                  <FileText className="text-black" size={20} />
                  Readiness Report
                </h3>
                <button
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport}
                  className="px-4 py-2 bg-black text-white text-sm font-mono rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <RefreshCw size={14} className={isGeneratingReport ? "animate-spin" : ""} />
                  {isGeneratingReport ? "Generating..." : "Generate Report"}
                </button>
              </div>

              {report && (
                <div className="space-y-6">
                  {/* Score Card */}
                  <div className={`rounded-xl p-6 border ${
                    report.score >= 80 ? "border-green-200 bg-green-50" :
                    report.score >= 60 ? "border-yellow-200 bg-yellow-50" :
                    "border-red-200 bg-red-50"
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 font-mono uppercase tracking-wider">Readiness Score</p>
                        <p className={`text-5xl font-orbitron font-bold ${
                          report.score >= 80 ? "text-green-700" :
                          report.score >= 60 ? "text-yellow-700" :
                          "text-red-700"
                        }`}>
                          {report.score}/100
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {report.checks.filter(c => c.passed).length} of {report.checks.length} checks passed
                        </p>
                      </div>
                      <div className="text-right">
                        {report.predictedPeakMultiplier && (
                          <div className="mb-2">
                            <p className="text-sm text-gray-500 font-mono uppercase tracking-wider">Predicted Peak Multiplier</p>
                            <p className="text-2xl font-orbitron font-bold text-orange-600">{report.predictedPeakMultiplier}x</p>
                          </div>
                        )}
                        {report.crashProbability !== undefined && (
                          <div>
                            <p className="text-sm text-gray-500 font-mono uppercase tracking-wider">Crash Probability</p>
                            <p className="text-2xl font-orbitron font-bold text-red-600">{report.crashProbability}%</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Checks */}
                  <div>
                    <h4 className="font-orbitron font-bold text-sm text-gray-700 mb-3 uppercase tracking-wider">Individual Checks</h4>
                    <div className="space-y-2">
                      {report.checks.map((check, index) => {
                        const SeverityIcon = SEVERITY_ICONS[check.severity];
                        return (
                          <div key={index} className={`flex items-start gap-3 p-4 rounded-lg border ${SEVERITY_COLORS[check.severity]}`}>
                            <div className="flex-shrink-0 mt-0.5">
                              <SeverityIcon size={18} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">{check.name}</span>
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize ${check.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
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

                  {/* Recommendations */}
                  {report.recommendations.length > 0 && (
                    <div>
                      <h4 className="font-orbitron font-bold text-sm text-gray-700 mb-3 uppercase tracking-wider">Recommendations</h4>
                      <div className="space-y-2">
                        {report.recommendations.map((rec, index) => (
                          <div key={index} className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-lg">
                            <AlertTriangle className="text-blue-600 mt-0.5" size={18} />
                            <p className="text-sm text-blue-800">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!report && !isGeneratingReport && (
                <div className="text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                  <FileText className="mx-auto text-gray-300 mb-3" size={48} />
                  <p className="text-gray-500">Click "Generate Report" to run readiness checks on your monitor.</p>
                  <p className="text-sm text-gray-400 mt-2">This will test CDN, compression, protocol, caching, and SSL.</p>
                </div>
              )}
            </div>
          )}

          {/* TIMELINE TAB */}
          {activeTab === "timeline" && (
            <div className="space-y-6">
              <h3 className="font-orbitron font-bold text-lg text-black flex items-center gap-2">
                <Calendar className="text-black" size={20} />
                Event Timeline
              </h3>
              <p className="text-sm text-gray-500">
                Visual overview of your scheduled events and monitoring phases.
              </p>

              {config.events.length === 0 ? (
                <div className="text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                  <Calendar className="mx-auto text-gray-300 mb-3" size={48} />
                  <p className="text-gray-500">No events scheduled.</p>
                  <p className="text-sm text-gray-400 mt-2">Add events in the Configuration tab to see the timeline.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {config.events
                    .filter(e => e.enabled)
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((event, index) => {
                      const eventType = EVENT_TYPES.find(t => t.value === event.type) || EVENT_TYPES[3];
                      const EventIcon = eventType.icon;
                      const eventDate = new Date(event.date);
                      const now = new Date();
                      const preEventStart = new Date(eventDate.getTime() - config.preEventWindowHours * 60 * 60 * 1000);
                      const surgeEnd = new Date(eventDate.getTime() + config.surgeWindowHours * 60 * 60 * 1000);
                      
                      const isPast = eventDate < now;
                      const isPreEvent = now >= preEventStart && now < eventDate;
                      const isSurge = now >= eventDate && now <= surgeEnd;
                      const isUpcoming = now < preEventStart;

                      return (
                        <div key={event.id} className="relative p-4 bg-white rounded-lg border border-gray-200">
                          <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-lg ${eventType.color} shrink-0`}>
                              <EventIcon size={20} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-gray-900">{event.name}</span>
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${eventType.color}`}>
                                  {eventType.label}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 font-mono">
                                {eventDate.toLocaleDateString()} at {eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              {event.description && (
                                <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <span className={`text-xs font-mono px-2 py-1 rounded ${
                                isSurge ? "bg-red-100 text-red-700" :
                                isPreEvent ? "bg-orange-100 text-orange-700" :
                                isUpcoming ? "bg-blue-100 text-blue-700" :
                                "bg-gray-100 text-gray-500"
                              }`}>
                                {isSurge ? "SURGE" : isPreEvent ? "PRE-EVENT" : isUpcoming ? "UPCOMING" : "COMPLETED"}
                              </span>
                            </div>
                          </div>

                          {/* Timeline Bar */}
                          <div className="mt-4 relative h-8">
                            <div className="absolute left-0 right-0 top-3 h-1 bg-gray-200 rounded-full" />
                            
                            {/* Pre-event phase */}
                            <div className="absolute top-0 h-8 flex items-center">
                              <div 
                                className="bg-orange-200 h-1.5 rounded-full"
                                style={{ 
                                  left: '0%', 
                                  width: `${isPast || isPreEvent || isSurge ? 30 : 0}%` 
                                }}
                              />
                            </div>
                            
                            {/* Event marker */}
                            <div className="absolute top-0 h-8 flex items-center">
                              <div 
                                className="w-0.5 h-6 bg-black"
                                style={{ left: '30%' }}
                              />
                            </div>
                            
                            {/* Surge phase */}
                            <div className="absolute top-0 h-8 flex items-center">
                              <div 
                                className="bg-red-200 h-1.5 rounded-full"
                                style={{ 
                                  left: '30%', 
                                  width: `${isSurge ? 70 : isPast ? 70 : 0}%` 
                                }}
                              />
                            </div>

                            {/* Current position indicator */}
                            {(isPreEvent || isSurge) && (
                              <div 
                                className="absolute top-0 h-8 flex items-center"
                                style={{ left: isPreEvent ? '15%' : '65%' }}
                              >
                                <div className="w-3 h-3 bg-black rounded-full -translate-x-1/2 border-2 border-white shadow-lg" />
                              </div>
                            )}

                            {/* Labels */}
                            <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] font-mono text-gray-400">
                              <span>Baseline</span>
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

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-4 border-t border-gray-100 shrink-0 bg-gray-50">
          <button
            onClick={handleTriggerCheck}
            disabled={isTriggeringCheck}
            className="px-4 py-2 text-sm font-mono text-gray-700 hover:text-black hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Zap size={14} className={isTriggeringCheck ? "animate-spin" : ""} />
            {isTriggeringCheck ? "Checking..." : "Trigger Manual Check"}
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-mono text-gray-700 hover:text-black hover:bg-gray-100 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={isSaving || isLoading}
              className="px-4 py-2 bg-black text-white text-sm font-mono rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-2"
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
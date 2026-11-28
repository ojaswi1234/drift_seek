import React, { useState } from 'react';
import { Activity, Globe, Clock, Trash2, PlayCircle, AlertTriangle, Zap } from 'lucide-react';

interface MonitorCardProps {
  id: string;
  name?: string;
  url: string;
  status: 'online' | 'offline' | 'pending' | 'error' | 'up' | 'down';
  reason?: string;
  latency?: number;
  lastChecked?: string;
  onDelete?: (id: string) => void;
  onCheck?: (id: string) => void | Promise<void>;
  onOpenSurgeModal?: (monitor: { id: string; name?: string; url: string }) => void;
}

function getSafeHttpHref(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function formatLastChecked(raw?: string): string {
  if (!raw) return 'NEVER';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const MonitorCard: React.FC<MonitorCardProps> = ({
  id,
  name,
  url,
  status,
  reason,
  latency,
  lastChecked,
  onDelete,
  onCheck,
  onOpenSurgeModal,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const isOnline = status === 'online' || status === 'up';
  const isError = status === 'offline' || status === 'error' || status === 'down';

  const statusColor = isOnline ? 'text-green-600' : isError ? 'text-red-600' : 'text-gray-500';
  const bgColor = isOnline ? 'bg-green-50' : isError ? 'bg-red-50' : 'bg-gray-100';
  const borderColor = isOnline ? 'border-green-200' : isError ? 'border-red-200' : 'border-gray-200';
  const safeHref = getSafeHttpHref(url);

  async function deleteTarget(targetId: string) {
    if (isDeleting) return;
    setIsDeleting(true);
    setCardError(null);
    try {
      const response = await fetch(`/api/database?id=${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        onDelete?.(targetId);
      } else {
        const msg = await response.text();
        setCardError('Delete failed');
        console.error('Failed to delete target:', msg);
      }
    } catch (error) {
      setCardError('Delete failed');
      console.error('Failed to delete target:', error);
    } finally {
      setIsDeleting(false);
    }
  }

  async function triggerPing() {
    if (isPinging || !onCheck) return;
    setIsPinging(true);
    setCardError(null);
    try {
      await onCheck(id);
    } catch {
      setCardError('Ping check failed');
    } finally {
      setIsPinging(false);
    }
  }

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('a') ||
      target.closest('button') ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'A'
    ) {
      return;
    }
    onOpenSurgeModal?.({ id, name, url });
  };

  return (
    <div
      className={`group relative w-full p-5 bg-white text-black border ${borderColor} shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-300 rounded-lg cursor-pointer`}
      onClick={handleCardClick}
    >
      <div className="flex justify-between items-start gap-2 mb-4">
        <div className="flex items-center gap-3 overflow-hidden min-w-0">
          <div className={`p-2 rounded-md ${bgColor} ${statusColor} shrink-0`}>
            {isError ? <AlertTriangle size={18} /> : <Activity size={18} />}
          </div>
          <div className="min-w-0">
            <h3 className="text-black font-orbitron font-bold tracking-wide text-sm truncate">
              {name || 'UNNAMED_TARGET'}
            </h3>
            <div className="flex items-center gap-1.5 text-gray-500 text-[11px] font-mono mt-1 group-hover:text-black transition-colors">
              <Globe size={11} className="shrink-0" />
              {safeHref ? (
                <a
                  href={safeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:underline decoration-gray-400 underline-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {url}
                </a>
              ) : (
                <span className="truncate">{url}</span>
              )}
            </div>
          </div>
        </div>

        <div
          className={`px-2 py-1 rounded text-[10px] font-mono font-bold border ${borderColor} ${bgColor} ${statusColor} uppercase tracking-widest shrink-0`}
        >
          {status}
        </div>
      </div>

      {isError && reason && (
        <div className="mb-4 text-[10px] font-mono text-red-600 bg-red-50 p-2 rounded border border-red-100 uppercase tracking-widest">
          {reason}
        </div>
      )}

      {cardError && (
        <div className="mb-3 text-[10px] font-mono text-red-600 bg-red-50 p-2 rounded border border-red-100">
          {cardError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-px bg-gray-100 border border-gray-100 overflow-hidden rounded-md my-4">
        <div className="bg-white p-3 flex flex-col justify-center">
          <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">
            Response
          </span>
          <span
            className={`text-xl font-bold font-orbitron ${
              typeof latency === 'number' && latency > 500 ? 'text-orange-500' : 'text-black'
            }`}
          >
            {typeof latency === 'number' && Number.isFinite(latency) ? `${latency}ms` : '--'}
          </span>
        </div>
        <div className="bg-white p-3 flex flex-col justify-center">
          <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">
            Last Ping
          </span>
          <div className="flex items-center gap-1.5 text-gray-600 font-mono text-[11px]">
            <Clock size={12} className="shrink-0" />
            <span className="truncate">{formatLastChecked(lastChecked)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isPinging}
            onClick={(e) => {
              e.stopPropagation();
              triggerPing();
            }}
            className="p-2 text-gray-500 hover:text-black hover:bg-gray-100 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
            title="Ping now"
            aria-label="Ping now"
          >
            <PlayCircle size={16} className={isPinging ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSurgeModal?.({ id, name, url });
            }}
            className="p-2 text-gray-500 hover:text-black hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            title="Surge Prediction & Readiness"
            aria-label="Surge Prediction & Readiness"
          >
            <Zap size={16} />
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={(e) => {
              e.stopPropagation();
              deleteTarget(id);
            }}
            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
            title="Delete monitor"
            aria-label="Delete monitor"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSurgeModal?.({ id, name, url });
          }}
          className="text-[10px] text-gray-500 hover:text-black font-mono uppercase tracking-wider cursor-pointer"
        >
          Surge config
        </button>
      </div>
    </div>
  );
};

export default MonitorCard;

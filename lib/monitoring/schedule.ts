export interface ScheduledEventLike {
  id?: string;
  name?: string;
  date: string | Date;
  type?: 'festival' | 'launch' | 'holiday' | 'custom';
  enabled?: boolean;
}

export interface SurgeScheduleConfigLike {
  events?: ScheduledEventLike[];
  baselineInterval?: number;
  preEventInterval?: number;
  surgeInterval?: number;
  preEventWindowHours?: number;
  surgeWindowHours?: number;
  telegramEnabled?: boolean;
  actionOnlyOnScheduledDays?: boolean;
  activeDaysOfWeek?: number[];
  autoReadinessAlert?: boolean;
  useBlackboxProbe?: boolean;
}

export type MonitoringMode = 'baseline' | 'pre-event' | 'surge';

export interface MonitoringModeResult {
  mode: MonitoringMode;
  intervalMs: number;
  activeEvent?: {
    id?: string;
    name: string;
    type: string;
    date: string;
  };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function getMonitoringMode(
  surgeConfig: SurgeScheduleConfigLike | null | undefined,
  now = new Date()
): MonitoringModeResult {
  const baselineIntervalMs = Math.max(1, surgeConfig?.baselineInterval || 5) * 60 * 1000;
  if (!surgeConfig || !Array.isArray(surgeConfig.events) || surgeConfig.events.length === 0) {
    return { mode: 'baseline', intervalMs: baselineIntervalMs };
  }

  let selected: MonitoringModeResult = {
    mode: 'baseline',
    intervalMs: baselineIntervalMs,
  };

  for (const event of surgeConfig.events) {
    if (!event?.enabled || !event?.date) continue;

    const eventDate = new Date(event.date);
    if (Number.isNaN(eventDate.getTime())) continue;

    const preEventStart = new Date(
      eventDate.getTime() - (surgeConfig.preEventWindowHours || 24) * 60 * 60 * 1000
    );
    const surgeEnd = new Date(
      eventDate.getTime() + (surgeConfig.surgeWindowHours || 24) * 60 * 60 * 1000
    );

    const eventInfo = {
      id: event.id,
      name: event.name || 'Scheduled Event',
      type: event.type || 'custom',
      date: eventDate.toISOString(),
    };

    if (now >= eventDate && now <= surgeEnd) {
      const surgeMs = Math.max(5, surgeConfig.surgeInterval || 15) * 1000;
      if (selected.mode !== 'surge' || surgeMs < selected.intervalMs) {
        selected = { mode: 'surge', intervalMs: surgeMs, activeEvent: eventInfo };
      }
    } else if (now >= preEventStart && now < eventDate && selected.mode !== 'surge') {
      const preMs = Math.max(1, surgeConfig.preEventInterval || 1) * 60 * 1000;
      if (selected.mode === 'baseline' || preMs < selected.intervalMs) {
        selected = { mode: 'pre-event', intervalMs: preMs, activeEvent: eventInfo };
      }
    }
  }

  return selected;
}

/**
 * Determines whether active actions (Telegram outage alerts & automated readiness briefs)
 * are allowed right now. Passive telemetry collection still runs 24/7 even when this returns false.
 */
export function isActionAllowedToday(
  surgeConfig: SurgeScheduleConfigLike | null | undefined,
  now = new Date()
): { allowed: boolean; reason: string; modeResult: MonitoringModeResult } {
  const modeResult = getMonitoringMode(surgeConfig, now);

  if (!surgeConfig?.actionOnlyOnScheduledDays) {
    return {
      allowed: true,
      reason: '24/7 active alerts enabled',
      modeResult,
    };
  }

  if (modeResult.mode === 'surge' || modeResult.mode === 'pre-event') {
    return {
      allowed: true,
      reason: `Active event window (${modeResult.activeEvent?.name || modeResult.mode})`,
      modeResult,
    };
  }

  const utcDay = now.getUTCDay();
  const activeDays = Array.isArray(surgeConfig.activeDaysOfWeek) ? surgeConfig.activeDaysOfWeek : [];
  if (activeDays.includes(utcDay)) {
    return {
      allowed: true,
      reason: `Scheduled action day (${DAY_NAMES[utcDay]} UTC)`,
      modeResult,
    };
  }

  return {
    allowed: false,
    reason: `Silent 24/7 learning mode (${DAY_NAMES[utcDay]} UTC is outside specified action days)`,
    modeResult,
  };
}

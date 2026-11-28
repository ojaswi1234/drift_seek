/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import redis from '@/lib/redis';
import { sendTelegramAlert } from '@/lib/mailer';
import { safeFetchWithRedirects } from '@/lib/security/urlValidator';
import { safeTimingEqual } from '@/lib/auth/session';

function getMonitoringMode(surgeConfig: any): {
  mode: 'baseline' | 'pre-event' | 'surge';
  intervalMs: number;
} {
  const baselineIntervalMs = (surgeConfig?.baselineInterval || 5) * 60 * 1000;
  if (!surgeConfig || !Array.isArray(surgeConfig.events) || surgeConfig.events.length === 0) {
    return { mode: 'baseline', intervalMs: baselineIntervalMs };
  }

  const now = new Date();
  let selected: { mode: 'baseline' | 'pre-event' | 'surge'; intervalMs: number } = {
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

    if (now >= eventDate && now <= surgeEnd) {
      const surgeMs = (surgeConfig.surgeInterval || 15) * 1000;
      if (surgeMs < selected.intervalMs || selected.mode !== 'surge') {
        selected = { mode: 'surge', intervalMs: surgeMs };
      }
    } else if (now >= preEventStart && now < eventDate && selected.mode !== 'surge') {
      const preMs = (surgeConfig.preEventInterval || 1) * 60 * 1000;
      if (selected.mode === 'baseline' || preMs < selected.intervalMs) {
        selected = { mode: 'pre-event', intervalMs: preMs };
      }
    }
  }

  return selected;
}

async function shouldCheck(monitorId: string, intervalMs: number): Promise<boolean> {
  try {
    const lastCheck = await redis.get(`monitor:lastcheck:${monitorId}`);
    if (!lastCheck) return true;
    const lastCheckTime = new Date(lastCheck).getTime();
    if (Number.isNaN(lastCheckTime)) return true;
    return Date.now() - lastCheckTime >= intervalMs;
  } catch {
    return true;
  }
}

async function updateLastCheck(monitorId: string): Promise<void> {
  try {
    await redis.set(`monitor:lastcheck:${monitorId}`, new Date().toISOString(), 'EX', 86400);
  } catch (err) {
    console.warn(`Failed to update lastcheck for ${monitorId}:`, err);
  }
}

async function checkTarget(url: string): Promise<{
  latency: number;
  status: 'up' | 'down';
  reason: string;
  headers: Record<string, string>;
}> {
  const start = performance.now();
  let status: 'up' | 'down' = 'down';
  let reason = '';
  const headers: Record<string, string> = {};

  try {
    const { response } = await safeFetchWithRedirects(url, {
      method: 'HEAD',
      timeoutMs: 10000,
      allowHttp: true,
      fallbackToGetOn405: true,
    });
    await response.body?.cancel().catch(() => {});

    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    if (response.ok) {
      status = 'up';
    } else {
      reason = `HTTP ${response.status}`;
    }
  } catch (error) {
    reason =
      error instanceof Error && error.name === 'AbortError'
        ? 'Timeout'
        : error instanceof Error
          ? error.message
          : 'Network Failure';
  }

  return { latency: Math.round(performance.now() - start), status, reason, headers };
}

export async function GET(req: Request) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (!cronSecret) {
    console.error('CRON_SECRET environment variable is not configured');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ') || !safeTimingEqual(authHeader.slice(7).trim(), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let lockAcquired = false;
  const lockKey = 'watchtower:cron:lock';
  try {
    const lockRes = await redis.set(lockKey, '1', 'EX', 50, 'NX');
    if (lockRes !== 'OK') {
      return NextResponse.json({ success: true, skipped: true, reason: 'Watchtower run already in progress' });
    }
    lockAcquired = true;
  } catch (lockErr) {
    console.warn('Watchtower Redis lock skipped:', lockErr);
  }

  try {
    await dbConnect();

    const [servers, surgeConfigs] = await Promise.all([
      WebServer.find({}).lean(),
      SurgeConfig.find({}).lean(),
    ]);

    const configMap = new Map<string, any>();
    for (const config of surgeConfigs) {
      configMap.set(config.monitorId.toString(), config);
    }

    let checkedCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    const processServer = async (server: any) => {
      const monitorId = server._id.toString();
      const surgeConfig = configMap.get(monitorId);
      const { mode, intervalMs } = getMonitoringMode(surgeConfig);

      const shouldRun = await shouldCheck(monitorId, intervalMs);
      if (!shouldRun) {
        skippedCount++;
        return {
          id: monitorId,
          name: server.name,
          url: server.url,
          mode,
          skipped: true,
          nextCheckIn: Math.round(intervalMs / 1000),
        };
      }

      const { latency, status, reason, headers } = await checkTarget(server.url);
      await updateLastCheck(monitorId);

      const nowIso = new Date().toISOString();
      const statsKey = `monitor:stats:${monitorId}`;
      try {
        await redis.hset(statsKey, {
          status,
          latency: String(latency),
          reason,
          lastChecked: nowIso,
          mode,
          headers: JSON.stringify(headers),
        });
        await redis.expire(statsKey, 3600);
      } catch (redisErr) {
        console.warn(`Redis hset failed for ${monitorId}:`, redisErr);
      }

      const metricPayload = {
        id: monitorId,
        url: server.url,
        status,
        latency,
        reason,
        lastChecked: nowIso,
        mode,
      };

      try {
        await redis.publish('system_metrics', JSON.stringify(metricPayload));
      } catch (publishError) {
        console.error('Failed to publish system_metrics update:', publishError);
      }

      const telegramEnabled = surgeConfig?.telegramEnabled ?? true;
      const alertKey = `alert_sent:${monitorId}`;
      if (status === 'down' && telegramEnabled) {
        try {
          const alreadyAlerted = await redis.get(alertKey);
          if (!alreadyAlerted) {
            await sendTelegramAlert({
              url: server.url,
              reason: reason || 'Service Unreachable',
              ownerEmail: server.ownerEmail,
              status: 'down',
              latencyMs: latency,
            });
            await redis.set(alertKey, 'true', 'EX', 7200);
          }
        } catch (alertErr) {
          console.error(`Alert delivery failed for ${server.url}:`, alertErr);
        }
      } else if (status === 'up') {
        try {
          await redis.del(alertKey);
        } catch {
          // ignore
        }
      }

      checkedCount++;
      return {
        id: monitorId,
        name: server.name,
        url: server.url,
        status,
        latency,
        reason,
        mode,
        checked: true,
      };
    };

    const BATCH_SIZE = 5;
    for (let i = 0; i < servers.length; i += BATCH_SIZE) {
      const batch = servers.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(batch.map(processServer));
      for (const item of settled) {
        if (item.status === 'fulfilled') {
          results.push(item.value);
        } else {
          console.error('Monitor check error:', item.reason);
        }
      }
    }

    return NextResponse.json({
      success: true,
      targetsChecked: checkedCount,
      targetsSkipped: skippedCount,
      results,
    });
  } catch (error) {
    console.error('Watchtower Error:', error);
    return NextResponse.json({ error: 'Watchtower execution failed' }, { status: 500 });
  } finally {
    if (lockAcquired) {
      await redis.del(lockKey).catch(() => {});
    }
  }
}

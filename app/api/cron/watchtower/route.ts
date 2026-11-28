/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import MonitorMetric from '@/lib/models/MonitorMetric';
import redis from '@/lib/redis';
import { sendTelegramAlert } from '@/lib/mailer';
import { safeTimingEqual } from '@/lib/auth/session';
import { isActionAllowedToday } from '@/lib/monitoring/schedule';
import { probeTargetUnified } from '@/lib/monitoring/probe';
import { generateReadinessAndForecast } from '@/lib/monitoring/forecaster';

export const dynamic = 'force-dynamic';

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
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);

    const processServer = async (server: any) => {
      const monitorId = server._id.toString();
      const surgeConfig = configMap.get(monitorId);
      const { allowed: actionAllowed, reason: actionReason, modeResult } = isActionAllowedToday(
        surgeConfig,
        now
      );
      const { mode, intervalMs, activeEvent } = modeResult;

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

      const preferBlackbox = surgeConfig?.useBlackboxProbe ?? true;
      const probe = await probeTargetUnified(server.url, { preferBlackbox });
      await updateLastCheck(monitorId);

      const nowIso = new Date().toISOString();

      await MonitorMetric.create({
        monitorId: server._id,
        url: server.url,
        ownerEmail: server.ownerEmail,
        status: probe.status,
        latencyMs: probe.latencyMs,
        ttfbMs: probe.ttfbMs,
        connectMs: probe.connectMs,
        tlsMs: probe.tlsMs,
        resolveMs: probe.resolveMs,
        transferMs: probe.transferMs,
        httpStatusCode: probe.httpStatusCode,
        httpVersion: probe.httpVersion,
        compressed: probe.compressed,
        cacheStatus: probe.cacheStatus,
        cdnProvider: probe.cdnProvider,
        mode,
        source: probe.source,
        reason: probe.reason,
        timestamp: now,
      }).catch((err) => console.warn(`MonitorMetric insert failed for ${monitorId}:`, err));

      const statsKey = `monitor:stats:${monitorId}`;
      try {
        await redis.hset(statsKey, {
          status: probe.status,
          latency: String(probe.latencyMs),
          ttfbMs: String(probe.ttfbMs),
          cacheStatus: probe.cacheStatus,
          source: probe.source,
          reason: probe.reason,
          lastChecked: nowIso,
          mode,
          headers: JSON.stringify(probe.headers),
        });
        await redis.expire(statsKey, 3600);
      } catch (redisErr) {
        console.warn(`Redis hset failed for ${monitorId}:`, redisErr);
      }

      const metricPayload = {
        id: monitorId,
        url: server.url,
        status: probe.status,
        latency: probe.latencyMs,
        ttfbMs: probe.ttfbMs,
        cacheStatus: probe.cacheStatus,
        reason: probe.reason,
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

      // 24/7 passive telemetry always runs; Telegram notifications respect actionAllowed (day gating)
      if (probe.status === 'down' && telegramEnabled && actionAllowed) {
        try {
          const alreadyAlerted = await redis.get(alertKey);
          if (!alreadyAlerted) {
            await sendTelegramAlert({
              url: server.url,
              reason: probe.reason || 'Service Unreachable',
              ownerEmail: server.ownerEmail,
              status: 'down',
              latencyMs: probe.latencyMs,
              chatId: surgeConfig?.telegramChatId,
            });
            await redis.set(alertKey, 'true', 'EX', 7200);
          }
        } catch (alertErr) {
          console.error(`Alert delivery failed for ${server.url}:`, alertErr);
        }
      } else if (probe.status === 'up') {
        await redis.del(alertKey).catch(() => {});
      }

      // Automated Pre-Event Readiness Audit & Telegram Brief during active event windows or specified action days
      let readinessDispatched = false;
      const autoReadiness = surgeConfig?.autoReadinessAlert ?? true;
      if (
        telegramEnabled &&
        actionAllowed &&
        autoReadiness &&
        (mode === 'pre-event' || mode === 'surge')
      ) {
        const readinessKey = `readiness_alert_sent:${monitorId}:${activeEvent?.id || dayKey}`;
        try {
          const alreadySent = await redis.get(readinessKey);
          if (!alreadySent) {
            const checks = surgeConfig?.readinessChecks || {
              cdn: true,
              compression: true,
              protocol: true,
              cacheHeaders: true,
              sslExpiry: true,
            };
            const report = await generateReadinessAndForecast(monitorId, server.url, checks);
            await SurgeConfig.findOneAndUpdate(
              { monitorId: server._id, ownerEmail: server.ownerEmail },
              {
                $set: {
                  lastReadinessReport: {
                    score: report.score,
                    report,
                    generatedAt: new Date(),
                  },
                },
              }
            );

            const topRecs =
              report.recommendations.length > 0
                ? `Top Fixes: ${report.recommendations.slice(0, 2).join(' | ')}`
                : 'All infrastructure readiness checks passed.';

            await sendTelegramAlert({
              url: server.url,
              status: 'info',
              ownerEmail: server.ownerEmail,
              latencyMs: report.telemetry.recentTtfbMs ?? probe.latencyMs,
              title: `<b>Pre-Event Readiness Brief (${activeEvent?.name || mode.toUpperCase()})</b>`,
              reason: `Readiness Score: ${report.score}/100 | Predicted Peak Multiplier: ${report.predictedPeakMultiplier}x | Crash Risk: ${report.crashProbability}% (${report.forecastBasis}) | ${topRecs}`,
              chatId: surgeConfig?.telegramChatId,
            });

            await redis.set(readinessKey, 'true', 'EX', 86400);
            readinessDispatched = true;
          }
        } catch (readinessErr) {
          console.warn(`Automated pre-event readiness brief failed for ${monitorId}:`, readinessErr);
        }
      }

      checkedCount++;
      return {
        id: monitorId,
        name: server.name,
        url: server.url,
        status: probe.status,
        latency: probe.latencyMs,
        ttfbMs: probe.ttfbMs,
        source: probe.source,
        mode,
        actionAllowed,
        actionReason,
        readinessDispatched,
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

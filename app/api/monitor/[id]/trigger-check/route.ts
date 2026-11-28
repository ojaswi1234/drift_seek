import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import MonitorMetric from '@/lib/models/MonitorMetric';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import redis from '@/lib/redis';
import { sendTelegramAlert } from '@/lib/mailer';
import { objectIdSchema } from '@/lib/validation/schemas';
import { probeTargetUnified } from '@/lib/monitoring/probe';
import { getMonitoringMode } from '@/lib/monitoring/schedule';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const idCheck = objectIdSchema.safeParse(id);
    if (!idCheck.success) {
      return NextResponse.json({ message: 'Invalid monitor ID' }, { status: 400 });
    }

    await dbConnect();

    const server = await WebServer.findOne({ _id: idCheck.data, ownerEmail: session.user.email });
    if (!server) {
      return NextResponse.json({ message: 'Monitor not found' }, { status: 404 });
    }

    const surgeConfig = await SurgeConfig.findOne({
      monitorId: idCheck.data,
      ownerEmail: session.user.email,
    });
    const telegramEnabled = surgeConfig?.telegramEnabled ?? false;
    const preferBlackbox = surgeConfig?.useBlackboxProbe ?? true;
    const { mode } = getMonitoringMode(surgeConfig);

    const probe = await probeTargetUnified(server.url, { preferBlackbox });
    const now = new Date();
    const nowIso = now.toISOString();

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
    }).catch((err) => console.warn('Failed to persist MonitorMetric:', err));

    const redisKey = `monitor:stats:${idCheck.data}`;
    try {
      await redis.hset(redisKey, {
        status: probe.status,
        reason: probe.reason,
        latency: probe.latencyMs.toString(),
        ttfbMs: probe.ttfbMs.toString(),
        cacheStatus: probe.cacheStatus,
        source: probe.source,
        lastChecked: nowIso,
        headers: JSON.stringify(probe.headers),
      });
      await redis.expire(redisKey, 3600);
    } catch (redisErr) {
      console.warn('Redis update failed:', redisErr);
    }

    const metricPayload = {
      id: idCheck.data,
      url: server.url,
      status: probe.status,
      latency: probe.latencyMs,
      ttfbMs: probe.ttfbMs,
      cacheStatus: probe.cacheStatus,
      reason: probe.reason,
      lastChecked: nowIso,
    };

    try {
      await redis.publish('system_metrics', JSON.stringify(metricPayload));
    } catch (publishErr) {
      console.warn('Redis publish failed:', publishErr);
    }

    if (telegramEnabled && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        await sendTelegramAlert({
          url: server.url,
          reason:
            probe.reason ||
            (probe.status === 'up'
              ? `Target responded normally (TTFB: ${probe.ttfbMs}ms, Cache: ${probe.cacheStatus})`
              : 'Service unreachable'),
          ownerEmail: server.ownerEmail,
          status: probe.status,
          latencyMs: probe.latencyMs,
          title: `<b>Manual Check: ${server.name}</b>`,
        });
      } catch (telegramErr) {
        console.warn('Telegram alert failed:', telegramErr);
      }
    }

    return NextResponse.json({
      success: true,
      monitor: {
        id: server._id,
        name: server.name,
        url: server.url,
        status: probe.status,
        latency: probe.latencyMs,
        ttfbMs: probe.ttfbMs,
        cacheStatus: probe.cacheStatus,
        source: probe.source,
        reason: probe.reason,
        lastChecked: nowIso,
      },
    });
  } catch (err) {
    console.error('Trigger check error:', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

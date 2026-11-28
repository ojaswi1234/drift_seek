import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import redis from '@/lib/redis';
import { sendTelegramAlert } from '@/lib/mailer';
import { objectIdSchema } from '@/lib/validation/schemas';
import { safeFetchWithRedirects } from '@/lib/security/urlValidator';

export const dynamic = 'force-dynamic';

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

    const { latency, status, reason, headers } = await checkTarget(server.url);
    const now = new Date().toISOString();

    const redisKey = `monitor:stats:${idCheck.data}`;
    try {
      await redis.hset(redisKey, {
        status,
        reason,
        latency: latency.toString(),
        lastChecked: now,
        headers: JSON.stringify(headers),
      });
      await redis.expire(redisKey, 3600);
    } catch (redisErr) {
      console.warn('Redis update failed:', redisErr);
    }

    const metricPayload = {
      id: idCheck.data,
      url: server.url,
      status,
      latency,
      reason,
      lastChecked: now,
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
          reason: reason || (status === 'up' ? 'Target responded normally' : 'Service unreachable'),
          ownerEmail: server.ownerEmail,
          status,
          latencyMs: latency,
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
        status,
        latency,
        reason,
        lastChecked: now,
      },
    });
  } catch (err) {
    console.error('Trigger check error:', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

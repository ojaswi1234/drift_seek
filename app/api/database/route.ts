/* eslint-disable @typescript-eslint/no-explicit-any */
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import MonitorMetric from '@/lib/models/MonitorMetric';
import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createMonitorSchema, deleteMonitorSchema } from '@/lib/validation/schemas';
import { parseJsonBody } from '@/lib/auth/session';
import { validateAndResolveUrl } from '@/lib/security/urlValidator';
import { checkTargetViaGrpc } from '@/lib/grpc_client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const [servers, surgeConfigs] = await Promise.all([
      WebServer.find({ ownerEmail: session.user.email }),
      SurgeConfig.find({ ownerEmail: session.user.email }).lean(),
    ]);

    const configByMonitorId = new Map<string, any>();
    for (const cfg of surgeConfigs) {
      configByMonitorId.set(String(cfg.monitorId), cfg);
    }

    const serversWithData = await Promise.all(
      servers.map(async (server: any) => {
        let stats: Record<string, string> = {};
        try {
          const redisKey = `monitor:stats:${server._id}`;
          stats = await redis.hgetall(redisKey);
        } catch (redisErr) {
          console.warn(`Redis fetch failed for ${server._id}:`, redisErr);
        }

        const parsedLatency = stats.latency !== undefined ? Number(stats.latency) : 0;
        const parsedTtfb = stats.ttfbMs !== undefined ? Number(stats.ttfbMs) : undefined;
        const surgeCfg = configByMonitorId.get(String(server._id));

        return {
          ...server.toObject(),
          status: stats.status || 'pending',
          reason: stats.reason || 'Awaiting first check',
          latency: Number.isFinite(parsedLatency) ? parsedLatency : 0,
          ttfbMs: typeof parsedTtfb === 'number' && Number.isFinite(parsedTtfb) ? parsedTtfb : undefined,
          cacheStatus: stats.cacheStatus || undefined,
          mode: stats.mode || undefined,
          actionOnlyOnScheduledDays: Boolean(surgeCfg?.actionOnlyOnScheduledDays),
          activeDaysOfWeek: Array.isArray(surgeCfg?.activeDaysOfWeek) ? surgeCfg.activeDaysOfWeek : [],
          scheduledEventCount: Array.isArray(surgeCfg?.events)
            ? surgeCfg.events.filter((e: any) => e?.enabled).length
            : 0,
          lastChecked: stats.lastChecked || server.updatedAt,
        };
      })
    );

    return NextResponse.json(serversWithData);
  } catch (err) {
    console.error('GET Database error:', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ message: 'Invalid JSON request body' }, { status: 400 });
    }

    const validationResult = createMonitorSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Validation failed', errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { name, url } = validationResult.data;

    // Resolve DNS and block private/internal targets at creation time
    const resolvedCheck = await validateAndResolveUrl(url, { allowHttp: true });
    if (!resolvedCheck.valid) {
      return NextResponse.json(
        { message: 'Target URL is not allowed', details: resolvedCheck.reason },
        { status: 400 }
      );
    }

    await dbConnect();

    const webserver = await WebServer.create({
      name,
      url,
      ownerEmail: session.user.email,
    });

    let initialStatus: 'up' | 'down' | 'pending' = 'pending';
    let initialReason = 'Pending initial check';
    let initialLatency = 0;

    try {
      const grpcResult = await checkTargetViaGrpc(webserver.url, 4000);
      initialStatus = grpcResult.status;
      initialReason = grpcResult.reason || '';
      initialLatency = grpcResult.latency_ms || 0;
      const nowIso = new Date().toISOString();

      await redis
        .hset(`monitor:stats:${webserver._id}`, {
          status: initialStatus,
          latency: String(initialLatency),
          reason: initialReason,
          lastChecked: nowIso,
        })
        .catch(() => {});
      await redis.expire(`monitor:stats:${webserver._id}`, 3600).catch(() => {});
    } catch {
      // gRPC worker may be unavailable in standalone/dev setups; keep accurate pending status
    }

    return NextResponse.json(
      {
        ...webserver.toObject(),
        status: initialStatus,
        reason: initialReason,
        latency: initialLatency,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { message: 'A web server with this URL already exists.' },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error('Database error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    const validationResult = deleteMonitorSchema.safeParse({ id });
    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Validation failed', errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const validatedId = validationResult.data.id;

    const serverToDelete = await WebServer.findById(validatedId);
    if (!serverToDelete) {
      return NextResponse.json({ message: 'Server not found' }, { status: 404 });
    }

    if (serverToDelete.ownerEmail !== session.user.email) {
      return NextResponse.json(
        { message: 'Forbidden: You do not own this monitor' },
        { status: 403 }
      );
    }

    await WebServer.findByIdAndDelete(validatedId);
    await Promise.all([
      SurgeConfig.deleteOne({ monitorId: validatedId }).catch((err) =>
        console.warn(`Failed to delete SurgeConfig for ${validatedId}:`, err)
      ),
      MonitorMetric.deleteMany({ monitorId: validatedId }).catch((err) =>
        console.warn(`Failed to delete MonitorMetrics for ${validatedId}:`, err)
      ),
    ]);
    await redis
      .del(
        `monitor:stats:${validatedId}`,
        `monitor:lastcheck:${validatedId}`,
        `alert_sent:${validatedId}`,
        `monitor:readiness:${validatedId}`
      )
      .catch((err) => console.warn(`Failed to clean Redis keys for ${validatedId}:`, err));

    return NextResponse.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

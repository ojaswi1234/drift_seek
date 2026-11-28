import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import redis from '@/lib/redis';
import { pingMonitorSchema } from '@/lib/validation/schemas';
import { checkTargetViaGrpc } from '@/lib/grpc_client';
import { parseJsonBody, safeTimingEqual } from '@/lib/auth/session';
import { validateAndResolveUrl } from '@/lib/security/urlValidator';

export async function POST(req: NextRequest) {
  try {
    const expectedToken = (process.env.SEEK_API_TOKEN || '').trim();
    const incomingToken = (req.headers.get('x-seek-api-token') || '').trim();
    const isInternalAuthorized = Boolean(
      expectedToken && incomingToken && safeTimingEqual(incomingToken, expectedToken)
    );

    const session = isInternalAuthorized ? null : await getServerSession(authOptions);
    if (!isInternalAuthorized && !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const validationResult = pingMonitorSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    await dbConnect();
    const { id, url: reqUrl } = validationResult.data;

    let webServer;
    if (id) {
      webServer = await WebServer.findById(id);
    } else if (session?.user?.email) {
      webServer = await WebServer.findOne({ url: reqUrl, ownerEmail: session.user.email });
    } else {
      webServer = await WebServer.findOne({ url: reqUrl });
    }

    if (!webServer) {
      return NextResponse.json({ error: 'Web server not found' }, { status: 404 });
    }

    if (!isInternalAuthorized && webServer.ownerEmail !== session?.user?.email) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const targetUrl = webServer.url;
    const urlCheck = await validateAndResolveUrl(targetUrl, { allowHttp: true });
    if (!urlCheck.valid) {
      return NextResponse.json({ error: urlCheck.reason }, { status: 400 });
    }

    const grpcResult = await checkTargetViaGrpc(targetUrl, 15000);
    const latency = grpcResult.latency_ms;
    const status = grpcResult.status;
    const reason = grpcResult.reason;
    const nowIso = new Date().toISOString();

    const redisKey = `monitor:stats:${webServer._id}`;
    try {
      await redis.hset(redisKey, {
        status,
        latency: String(latency),
        reason,
        lastChecked: nowIso,
      });
      await redis.expire(redisKey, 3600);
    } catch (redisErr) {
      console.warn('Redis hset failed in ping:', redisErr);
    }

    const metricPayload = {
      id: webServer._id.toString(),
      url: targetUrl,
      status,
      latency,
      reason,
      lastChecked: nowIso,
    };

    try {
      await redis.publish('system_metrics', JSON.stringify(metricPayload));
    } catch (publishError) {
      console.error('Failed to publish system_metrics update:', publishError);
    }

    return NextResponse.json(
      {
        message: 'Ping successful via gRPC',
        data: {
          _id: webServer._id,
          name: webServer.name,
          url: webServer.url,
          status,
          latency,
          reason,
          lastChecked: nowIso,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Ping API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


import { NextResponse } from 'next/server';
import dbConnect from '../../../../lib/db_connect';
import WebServer from '../../../../lib/models/WebServer';
import redis from "../../../../lib/redis/index";

async function calculateLatency(url: string): Promise<{ latency: number; status: 'up' | 'down'; reason: string }> {
  const start = performance.now();
  let status: 'up' | 'down' = 'down';
  let reason = '';
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) {
      status = 'up';
    } else {
      reason = `HTTP Error: ${res.status} ${res.statusText}`;
    }
  } catch (error: any) {
    reason = error.message || 'Connection failed';
  }
  const end = performance.now();
  return { latency: Math.round(end - start), status, reason };
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();
    const { id, url: reqUrl } = body;

    if (!id && !reqUrl) {
      return NextResponse.json({ error: 'Must provide id or url' }, { status: 400 });
    }

    let webServer;
    if (id) {
      webServer = await WebServer.findById(id);
    } else {
      webServer = await WebServer.findOne({ url: reqUrl });
    }

    if (!webServer) {
      return NextResponse.json({ error: 'Web server not found' }, { status: 404 });
    }

    const targetUrl = webServer.url;
     const { latency, status, reason } = await calculateLatency(targetUrl);

   const redisKey = `monitor:stats:${webServer._id}`;
    await redis.hset(redisKey, {
        status,
        latency,
        reason,
        lastChecked: new Date().toISOString()
    });
    // Set expiry if you want, e.g., 24 hours
    // await redis.expire(redisKey, 86400);

    // 2. Prepare response
    const responseData = webServer.toObject();
    responseData.status = status;
    responseData.latency = latency;
    responseData.reason = reason;
    // await webServer.save();

    return NextResponse.json({ message: 'Ping successful', data: responseData }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';
import dbConnect from '../../../../lib/db_connect';
import WebServer from '../../../../lib/models/WebServer';
import redis from '@/lib/redis';
import { pingMonitorSchema } from '@/lib/validation/schemas';
import { grpcClient } from '@/lib/grpc_client';


export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();

    const validationResult = pingMonitorSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { id, url: reqUrl } = validationResult.data;

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
    console.log(`Pinging ${targetUrl} via gRPC Worker...`);
    
    const grpcResult: any = await new Promise((resolve, reject) => {
      grpcClient.CheckTarget({ url: targetUrl }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });

    const latency = grpcResult.latency_ms;
    const status = grpcResult.status;
    const reason = grpcResult.reason;

    console.log(`Ping result for ${targetUrl}: status=${status}, latency=${latency}ms, reason=${reason}`);

    const redisKey = `monitor:stats:${webServer._id}`;
    await redis.hset(redisKey, {
        status,
        latency,
        reason,
        lastChecked: new Date().toISOString()
    });

    const metricPayload = {
      id: webServer._id.toString(),
      url: targetUrl,
      status,
      latency,
      reason,
      lastChecked: new Date().toISOString(),
    };

    try {
      await redis.publish("system_metrics", JSON.stringify(metricPayload));
    } catch (publishError) {
      console.error("Failed to publish system_metrics update:", publishError);
    }

    // 2. Prepare response
    const responseData = webServer.toObject();
    responseData.status = status;
    responseData.latency = latency;
    responseData.reason = reason;

    return NextResponse.json({ message: 'Ping successful via gRPC', data: responseData }, { status: 200 });
  } catch (error: any) {
    console.error('Ping API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

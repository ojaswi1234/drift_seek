import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import redis from '@/lib/redis';
import { objectIdSchema } from '@/lib/validation/schemas';
import { generateReadinessAndForecast } from '@/lib/monitoring/forecaster';

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

    const checks = surgeConfig?.readinessChecks || {
      cdn: true,
      compression: true,
      protocol: true,
      cacheHeaders: true,
      sslExpiry: true,
    };

    const report = await generateReadinessAndForecast(idCheck.data, server.url, checks);

    try {
      const redisKey = `monitor:readiness:${idCheck.data}`;
      await redis.hset(redisKey, {
        score: report.score.toString(),
        report: JSON.stringify(report),
        generatedAt: new Date().toISOString(),
      });
      await redis.expire(redisKey, 86400);
    } catch (redisErr) {
      console.warn('Redis store failed for readiness report:', redisErr);
    }

    await SurgeConfig.findOneAndUpdate(
      { monitorId: idCheck.data, ownerEmail: session.user.email },
      {
        $set: {
          lastReadinessReport: {
            score: report.score,
            report,
            generatedAt: new Date(),
          },
        },
        $setOnInsert: {
          monitorId: idCheck.data,
          ownerEmail: session.user.email,
        },
      },
      { upsert: true }
    );

    return NextResponse.json(report);
  } catch (err) {
    console.error('Readiness report error:', err);
    return NextResponse.json({ message: 'Failed to generate readiness report' }, { status: 500 });
  }
}

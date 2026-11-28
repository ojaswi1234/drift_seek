import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { z } from 'zod';
import { objectIdSchema } from '@/lib/validation/schemas';
import { parseJsonBody } from '@/lib/auth/session';
import { computeHistoricalTelemetry } from '@/lib/monitoring/forecaster';

export const dynamic = 'force-dynamic';

const surgeConfigSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().trim().min(1, 'Event name cannot be empty').max(100),
        date: z
          .string()
          .refine((val) => !Number.isNaN(Date.parse(val)), 'Invalid event date format')
          .transform((val) => new Date(val).toISOString()),
        type: z.enum(['festival', 'launch', 'holiday', 'custom']),
        description: z.string().max(500).optional(),
        enabled: z.boolean(),
      })
    )
    .max(50)
    .optional(),
  baselineInterval: z.number().int().min(1).max(60).optional(),
  preEventInterval: z.number().int().min(1).max(10).optional(),
  surgeInterval: z.number().int().min(5).max(60).optional(),
  preEventWindowHours: z.number().int().min(1).max(72).optional(),
  surgeWindowHours: z.number().int().min(1).max(72).optional(),
  telegramEnabled: z.boolean().optional(),
  actionOnlyOnScheduledDays: z.boolean().optional(),
  activeDaysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  autoReadinessAlert: z.boolean().optional(),
  useBlackboxProbe: z.boolean().optional(),
  readinessChecks: z
    .object({
      cdn: z.boolean(),
      compression: z.boolean(),
      protocol: z.boolean(),
      cacheHeaders: z.boolean(),
      sslExpiry: z.boolean(),
    })
    .optional(),
});

export async function GET(
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

    const config = await SurgeConfig.findOneAndUpdate(
      { monitorId: idCheck.data, ownerEmail: session.user.email },
      {
        $setOnInsert: {
          monitorId: idCheck.data,
          ownerEmail: session.user.email,
          events: [],
          baselineInterval: 5,
          preEventInterval: 1,
          surgeInterval: 15,
          preEventWindowHours: 24,
          surgeWindowHours: 24,
          telegramEnabled: true,
          actionOnlyOnScheduledDays: false,
          activeDaysOfWeek: [],
          autoReadinessAlert: true,
          useBlackboxProbe: true,
          readinessChecks: {
            cdn: true,
            compression: true,
            protocol: true,
            cacheHeaders: true,
            sslExpiry: true,
          },
        },
      },
      { upsert: true, new: true }
    );

    const telemetry = await computeHistoricalTelemetry(idCheck.data, server.url).catch(() => null);

    return NextResponse.json({
      config,
      telemetry,
      integrations: {
        blackboxConfigured: Boolean((process.env.BLACKBOX_URL || '').trim()),
        prometheusConfigured: Boolean((process.env.PROMETHEUS_URL || '').trim()),
      },
    });
  } catch (err) {
    console.error('GET surge config error:', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
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

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ message: 'Invalid JSON request body' }, { status: 400 });
    }

    const validationResult = surgeConfigSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Validation failed', errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    await dbConnect();

    const server = await WebServer.findOne({ _id: idCheck.data, ownerEmail: session.user.email });
    if (!server) {
      return NextResponse.json({ message: 'Monitor not found' }, { status: 404 });
    }

    const config = await SurgeConfig.findOneAndUpdate(
      { monitorId: idCheck.data, ownerEmail: session.user.email },
      {
        $set: validationResult.data,
        $setOnInsert: {
          monitorId: idCheck.data,
          ownerEmail: session.user.email,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Surge configuration saved',
      config,
    });
  } catch (err) {
    console.error('POST surge config error:', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

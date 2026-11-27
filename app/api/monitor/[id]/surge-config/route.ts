import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import WebServer from "@/lib/models/WebServer";
import SurgeConfig from "@/lib/models/SurgeConfig";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { z } from "zod";

export const dynamic = 'force-dynamic';

// Validation schema for surge config
const surgeConfigSchema = z.object({
  events: z.array(z.object({
    id: z.string(),
    name: z.string().min(1).max(100),
    date: z.string().datetime(),
    type: z.enum(["festival", "launch", "holiday", "custom"]),
    description: z.string().optional(),
    enabled: z.boolean(),
  })).optional(),
  baselineInterval: z.number().int().min(1).max(60).optional(),
  preEventInterval: z.number().int().min(1).max(10).optional(),
  surgeInterval: z.number().int().min(5).max(60).optional(),
  preEventWindowHours: z.number().int().min(1).max(72).optional(),
  surgeWindowHours: z.number().int().min(1).max(72).optional(),
  telegramEnabled: z.boolean().optional(),
  readinessChecks: z.object({
    cdn: z.boolean(),
    compression: z.boolean(),
    protocol: z.boolean(),
    cacheHeaders: z.boolean(),
    sslExpiry: z.boolean(),
  }).optional(),
});

// GET - Fetch surge config for a monitor
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await dbConnect();

    const server = await WebServer.findOne({ _id: id, ownerEmail: session.user.email });
    if (!server) {
      return NextResponse.json({ message: "Monitor not found" }, { status: 404 });
    }

    // Fetch or create surge config
    let config = await SurgeConfig.findOne({ monitorId: id, ownerEmail: session.user.email });
    
    if (!config) {
      // Create default config
      config = await SurgeConfig.create({
        monitorId: id,
        ownerEmail: session.user.email,
        events: [],
        baselineInterval: 5,
        preEventInterval: 1,
        surgeInterval: 15,
        preEventWindowHours: 24,
        surgeWindowHours: 24,
        telegramEnabled: true,
        readinessChecks: {
          cdn: true,
          compression: true,
          protocol: true,
          cacheHeaders: true,
          sslExpiry: true,
        },
      });
    }

    return NextResponse.json({ config });
  } catch (err: any) {
    console.error("GET surge config error:", err);
    return NextResponse.json({ message: "Internal server error", error: err.message }, { status: 500 });
  }
}

// POST - Save surge config for a monitor
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await dbConnect();

    const server = await WebServer.findOne({ _id: id, ownerEmail: session.user.email });
    if (!server) {
      return NextResponse.json({ message: "Monitor not found" }, { status: 404 });
    }

    const body = await req.json();
    const validationResult = surgeConfigSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        { message: "Validation failed", errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    // Update or create surge config
    const config = await SurgeConfig.findOneAndUpdate(
      { monitorId: id, ownerEmail: session.user.email },
      { 
        $set: validationResult.data,
        monitorId: id,
        ownerEmail: session.user.email,
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({ 
      success: true, 
      message: "Surge configuration saved",
      config,
    });
  } catch (err: any) {
    console.error("POST surge config error:", err);
    return NextResponse.json({ message: "Internal server error", error: err.message }, { status: 500 });
  }
}
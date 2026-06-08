/* eslint-disable @typescript-eslint/no-explicit-any */
import dbConnect from "@/lib/db_connect";
import WebServer from "@/lib/models/WebServer";
import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import { getServerSession } from "next-auth/next";
// UPDATE THIS PATH TO MATCH YOUR NEXTAUTH CONFIG LOCATION:
import { authOptions } from "@/app/api/auth/[...nextauth]/route"; 
import { createMonitorSchema, deleteMonitorSchema } from "@/lib/validation/schemas";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Authenticate the GET request
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    // 2. Fetch ONLY the servers owned by the logged-in user
    const servers = await WebServer.find({ ownerEmail: session.user.email });
    
    const serversWithData = await Promise.all(servers.map(async (server: any) => {
      let stats: any = {};
      try {
        const redisKey = `monitor:stats:${server._id}`;
        stats = await redis.hgetall(redisKey);
      } catch (redisErr) {
        console.warn(`Redis fetch failed for ${server._id}:`, redisErr);
      }
      
      return {
        ...server.toObject(),
        status: stats.status || 'pending',
        reason: stats.reason || 'Redis Pending/Unavailable',
        latency: stats.latency ? parseInt(stats.latency) : 0,
        lastChecked: stats.lastChecked || server.updatedAt
      };
    }));

    return NextResponse.json(serversWithData);
  } catch (err: any) {
    console.error("GET Database error:", err);
    return NextResponse.json({ message: "Internal server error", error: err.message }, { status: 500 });
  }
}

interface WebServerDocument {
  _id: string;
  name: string;
  url: string;
  ownerEmail: string;
  createdAt?: Date;
  updatedAt?: Date;
  toObject(): any;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // 1. Authenticate the POST request
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const body = await req.json();

    // Validate request body using Zod schema
    const validationResult = createMonitorSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: "Validation failed", errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { name, url } = validationResult.data;

    // 2. Create the monitor document, explicitly selecting only allowed fields to prevent mass-assignment
    const webserver: WebServerDocument = await WebServer.create({
      name,
      url,
      ownerEmail: session.user.email,
    });

    const localUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
    fetch(`${localUrl}/api/monitor/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: webserver._id }),
    }).catch(console.error);

    return NextResponse.json({
        ...webserver.toObject(),
        status: 'up',
        reason: 'Redis Pending',
        latency: 0
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json(
        { message: "A web server with this URL already exists." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }
    console.error("Database error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    // 1. Authenticate the DELETE request
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    
    // Validate ID parameter using Zod schema
    const validationResult = deleteMonitorSchema.safeParse({ id });
    if (!validationResult.success) {
      return NextResponse.json(
        { message: "Validation failed", errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const validatedId = validationResult.data.id;

    // 2. Ensure the user actually owns the server they are deleting
    const serverToDelete = await WebServer.findById(validatedId);
    if (!serverToDelete) {
      return NextResponse.json({ message: "Server not found" }, { status: 404 });
    }
    
    if (serverToDelete.ownerEmail !== session.user.email) {
      return NextResponse.json({ message: "Forbidden: You do not own this monitor" }, { status: 403 });
    }

    await WebServer.findByIdAndDelete(validatedId);
    return NextResponse.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
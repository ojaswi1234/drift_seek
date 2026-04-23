import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimiter";
import dbConnect from "@/lib/db_connect";
import StressTestLogs from "@/lib/models/StressTestLogs";

export async function POST(req: NextRequest) {
  try {
    // FATAL FLAW FIX: You allowed 20 requests per minute here originally. 
    // If a user clicks this 20 times, your GCP server spins up 20 Node containers 
    // and instantly crashes. Lowered to 2.
    await checkRateLimit(req, 2); 

    const { githubUrl } = await req.json();
    if (!githubUrl) return NextResponse.json({ success: false, error: "Missing GitHub URL" }, { status: 400 });

    // 1. Command GCP to execute the pipeline
    // NOTE: Replace YOUR_GCP_IP in production with process.env.GCP_SERVER_URL
    const server = process.env.NEXT_PUBLIC_SERVER_BASE_URL || "http://localhost:3001";
    const gcpResponse = await fetch(server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubUrl }),
    });

    const data = await gcpResponse.json();

    if (!gcpResponse.ok || !data.success) {
      return NextResponse.json({ success: false, error: data.error || "GCP Execution Failed" }, { status: 500 });
    }

    // 2. Save stats to MongoDB
    await dbConnect();
    
    // Find existing logs for this repo, or create a new one
    let logDoc = await StressTestLogs.findOne({ githubUrl });
    if (!logDoc) {
      logDoc = new StressTestLogs({ githubUrl, stressTests: [] });
    }

    logDoc.stressTests.push({
      requestsPerSecond: data.metrics.requestsPerSecond,
      latencyAverage: data.metrics.latencyAverage,
      latency99th: data.metrics.latency99th,
      successRate: data.metrics.successRate,
      totalRequests: data.metrics.totalRequests
    });

    await logDoc.save();

    // 3. Return to UI
    return NextResponse.json({ success: true, metrics: data.metrics }, { status: 200 });

  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json({ success: false, error: "Too many tests running. Cool down your server." }, { status: 429 });
    }
    console.error("Pipeline trigger error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import ABTestLogs from "@/lib/models/ABTestLogs";

export async function POST(req: NextRequest) {
  try {
    // Simple token-based auth to prevent unwanted posts from public callers
    const incomingToken = (req.headers.get('x-seek-api-token') || '').trim();
    const expectedToken = process.env.SEEK_API_TOKEN || '';

    if (expectedToken && incomingToken !== expectedToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const { checkRateLimit } = await import("@/lib/rateLimiter");
      await checkRateLimit(req, 20);
    } catch (err: any) {
      if (err.message === "RATE_LIMIT_EXCEEDED") {
        return NextResponse.json({ success: false, error: "Rate limit exceeded" }, { status: 429 });
      }
    }

    await dbConnect();
    const body = await req.json();
    const { githubUrl, metrics } = body;

    if (!githubUrl || !metrics) {
      return NextResponse.json(
        { success: false, error: "Missing required fields githubUrl or metrics" },
        { status: 400 }
      );
    }

    if (typeof githubUrl !== "string" || !githubUrl.startsWith("https://github.com/")) {
      return NextResponse.json(
        { success: false, error: "Invalid githubUrl format. Must start with https://github.com/" },
        { status: 400 }
      );
    }

    // Map single-process stress metrics into the ABTestLogs schema structure.
    // For single-process runs, we treat baseline and candidate metrics identically.
    const testData = {
      testedAt: new Date(),
      baselineBranch: "main (Baseline Run)",
      candidateBranch: "main (Stress Run)",
      baselineMetrics: {
        requestsPerSecond: metrics.requestsPerSecond || 0,
        latencyAverage: metrics.latencyAverage || 0,
        latency99th: metrics.latency99th || 0,
        successRate: metrics.successRate || 0,
      },
      candidateMetrics: {
        requestsPerSecond: metrics.requestsPerSecond || 0,
        latencyAverage: metrics.latencyAverage || 0,
        latency99th: metrics.latency99th || 0,
        successRate: metrics.successRate || 0,
      },
      passed: metrics.successRate >= 95.0, // Mark as passed if success rate is at least 95%
    };

    // Use atomic update with upsert: true to prevent duplicate logs race conditions
    const logEntity = await ABTestLogs.findOneAndUpdate(
      { githubUrl },
      { $push: { abTests: testData } },
      { upsert: true, new: true }
    );

    console.log(`[PIPELINES CALLBACK] Successfully stored stress test data for ${githubUrl}`);

    return NextResponse.json({ success: true, data: logEntity }, { status: 201 });
  } catch (error: any) {
    console.error("[PIPELINES CALLBACK ERROR]:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}

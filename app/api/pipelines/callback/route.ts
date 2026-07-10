import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import ABTestLogs from "@/lib/models/ABTestLogs";

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = await req.json();
    const { githubUrl, metrics } = body;

    if (!githubUrl || !metrics) {
      return NextResponse.json(
        { success: false, error: "Missing required fields githubUrl or metrics" },
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

    let logEntity = await ABTestLogs.findOne({ githubUrl });
    if (!logEntity) {
      logEntity = new ABTestLogs({
        githubUrl,
        abTests: [testData],
      });
    } else {
      logEntity.abTests.push(testData);
    }

    await logEntity.save();

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

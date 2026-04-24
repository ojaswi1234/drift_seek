import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import StressTestLogs from "@/lib/models/StressTestLogs";

export async function POST(req: NextRequest) {
  try {
    // GCP will send the githubUrl and the final metrics to this endpoint
    const { githubUrl, metrics } = await req.json();
    
    if (!githubUrl || !metrics) {
        return NextResponse.json({ success: false, error: "Missing payload" }, { status: 400 });
    }

    // Connect to the database
    await dbConnect();
    
    const updateResult = await StressTestLogs.findOneAndUpdate(
      { githubUrl },
      {
        $push: {
          stressTests: {
            requestsPerSecond: metrics.requestsPerSecond,
            latencyAverage: metrics.latencyAverage,
            latency99th: metrics.latency99th || metrics.latency95th,
            successRate: metrics.successRate,
            totalRequests: metrics.totalRequests,
            testedAt: new Date()
          }
        }
      },
      { upsert: true, new: true }
    );

    if (!updateResult) {
      throw new Error("Failed to upsert metric");
    }

    return NextResponse.json({ success: true, message: "Metrics saved successfully" }, { status: 200 });

  } catch (error: any) {
    console.error("[CALLBACK ERROR]:", error);
    return NextResponse.json({ success: false, error: "Database save failed" }, { status: 500 });
  }
}
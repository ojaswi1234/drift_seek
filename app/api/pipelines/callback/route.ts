import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import StressTestLogs from "@/lib/models/StressTestLogs";

export async function POST(req: NextRequest) {
  try {
    const { githubUrl, metrics } = await req.json();
    await dbConnect();
    
    let logDoc = await StressTestLogs.findOne({ githubUrl });
    if (!logDoc) logDoc = new StressTestLogs({ githubUrl, stressTests: [] });

    logDoc.stressTests.push({ ...metrics, testedAt: new Date() });
    await logDoc.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
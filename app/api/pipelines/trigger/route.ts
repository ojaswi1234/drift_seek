import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimiter";

export async function POST(req: NextRequest) {
  try {
    // 1. Enforce rate limiting: allow max 20 requests per 60 seconds
    await checkRateLimit(req, 20);

    // 2. Your actual route logic here
    const data = await req.json();
    
    return NextResponse.json({ 
      success: true, 
      message: "Pipeline triggered successfully!", 
      data 
    }, { status: 200 });

  } catch (error) {
    // 3. Catch the specific rate limit error and return 429
    if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { success: false, error: "Too many requests, please try again later." },
        { status: 429 }
      );
    }

    // Handle other regular errors
    console.error("Pipeline trigger error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

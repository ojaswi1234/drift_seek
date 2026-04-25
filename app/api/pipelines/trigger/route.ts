import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimiter";

export async function POST(req: NextRequest) {
  try {
    await checkRateLimit(req, 2); 

    const { githubUrl } = await req.json();
    if (!githubUrl) return NextResponse.json({ success: false, error: "Missing GitHub URL" }, { status: 400 });

    // Ensure no trailing slashes ruin the URL
    let server = process.env.GCP_BACKEND_URL || "http://localhost:3001";
    if (server.endsWith('/')) server = server.slice(0, -1);

    const gcpResponse = await fetch(`${server}/run-github-stress-test`, {
      method: "POST",
      headers: { 
        ...Object.fromEntries(req.headers),
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true" 
      },
      body: JSON.stringify({ githubUrl }),
    });

    // STOP blindly parsing JSON. Read the raw text first.
    const responseText = await gcpResponse.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      if (gcpResponse.status === 502 || responseText.includes("<!DOCTYPE html>")) {
        console.error(`[GCP FETCH ERROR] Reverse proxy issue. Status: ${gcpResponse.status}.`);
        return NextResponse.json({ success: false, error: "Cloud backend proxy is returning HTML (likely ngrok or gateway issue)." }, { status: gcpResponse.status });
      }
      console.error(`[GCP FETCH ERROR] Status: ${gcpResponse.status} | Raw Response:`, responseText.substring(0, 200));
      return NextResponse.json({ success: false, error: `Backend returned non-JSON. (Status ${gcpResponse.status})` }, { status: 500 });
    }

    if (!gcpResponse.ok) {
      const isHTML = responseText.includes("<!DOCTYPE html>");
      return NextResponse.json({ success: false, error: isHTML ? "Reverse proxy crash. Ngrok might be down." : data?.error || "server error" }, { status: gcpResponse.status });
    }

    if (!data?.success) {
      return NextResponse.json({ success: false, error: data?.error || "server error" }, { status: gcpResponse.status });
    }

    return NextResponse.json({ success: true, message: "Pipeline started" }, { status: 200 });

  } catch (error: any) {
    if (error.message === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json({ success: false, error: "Too many tests running. Cool down your server." }, { status: 429 });
    }
    console.error("[VERCEL API FATAL ERROR]:", error);
    return NextResponse.json({ success: false, error: `Vercel API Crash: ${error.message || "Unknown Failure"}` }, { status: 500 });
  }
}
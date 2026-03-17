import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

/**
 * Runs a specialized curl command to get a network trace
 * %{time_namelookup} : DNS Lookup
 * %{time_connect}    : TCP Connect
 * %{time_appconnect} : TLS Handshake
 */
async function runDiagnostic(url: string) {
  try {
    const { stdout } = await execPromise(
      `curl -s -o /dev/null -w "DNS: %{time_namelookup}s | TCP: %{time_connect}s | TLS: %{time_appconnect}s | TTFB: %{time_starttransfer}s" "${url}"`
    );
    return stdout;
  } catch (err) {
    return "DIAGNOSTIC_UNAVAILABLE";
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json(
      { message: 'Please provide a URL to check.' }, 
      { status: 400 }
    );
  }

  // 1. Ensure the URL has a protocol
  let urlToFetch = targetUrl;
  if (!urlToFetch.startsWith('http://') && !urlToFetch.startsWith('https://')) {
    urlToFetch = 'https://' + urlToFetch;
  }

  try {
    const response = await fetch(urlToFetch, { cache: 'no-store' });

    // 2. If the response is not OK (e.g., 404, 500, etc.)
    if (!response.ok) {
      const trace = await runDiagnostic(urlToFetch);
      return NextResponse.json({ 
        statusCode: response.status, 
        message: response.statusText,
        diagnostic: trace // Extra data for failures
      });
    }

    // 3. Success case
    return NextResponse.json({ 
      statusCode: response.status, 
      message: response.statusText, 
    });

  } catch (error: any) {
    // 4. Critical failure (DNS down, timeout, or server unreachable)
    // This is the most important place for the diagnostic
    const trace = await runDiagnostic(urlToFetch);

    return NextResponse.json({ 
      statusCode: 500,
      message: 'Service Unreachable', 
      details: error.message,
      diagnostic: trace 
    }, { status: 500 });
  }
}
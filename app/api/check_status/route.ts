import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { rateLimit, rateLimiters } from '@/lib/rateLimiter';
import { safeFetchWithRedirects, validateAndResolveUrl } from '@/lib/security/urlValidator';

const execFilePromise = promisify(execFile);

async function runDiagnostic(url: string): Promise<string> {
  try {
    const { stdout } = await execFilePromise(
      'curl',
      [
        '-s',
        '-o',
        '/dev/null',
        '-m',
        '10',
        '--proto',
        '=http,https',
        '-w',
        'DNS: %{time_namelookup}s | TCP: %{time_connect}s | TLS: %{time_appconnect}s | TTFB: %{time_starttransfer}s',
        url,
      ],
      { timeout: 11000 }
    );
    return stdout || 'DIAGNOSTIC_UNAVAILABLE';
  } catch {
    return 'DIAGNOSTIC_UNAVAILABLE';
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.email) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const rl = await rateLimit(request, {
    ...rateLimiters.standard,
    identifier: session.user.email,
  });
  if (!rl.success) {
    return NextResponse.json(
      { message: 'Too Many Requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
    );
  }

  const targetUrl = request.nextUrl.searchParams.get('url')?.trim();
  if (!targetUrl) {
    return NextResponse.json({ message: 'Please provide a URL to check.' }, { status: 400 });
  }

  const urlToFetch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(targetUrl)
    ? targetUrl
    : `https://${targetUrl}`;

  const validation = await validateAndResolveUrl(urlToFetch, { allowHttp: true });
  if (!validation.valid) {
    return NextResponse.json(
      {
        statusCode: 400,
        message: 'Invalid or blocked target URL',
        details: validation.reason,
      },
      { status: 400 }
    );
  }

  try {
    const { response, finalUrl } = await safeFetchWithRedirects(urlToFetch, {
      method: 'GET',
      timeoutMs: 10000,
      allowHttp: true,
    });
    await response.body?.cancel().catch(() => {});

    if (!response.ok) {
      const trace = await runDiagnostic(finalUrl);
      return NextResponse.json({
        statusCode: response.status,
        message: response.statusText || `HTTP ${response.status}`,
        diagnostic: trace,
      });
    }

    return NextResponse.json({
      statusCode: response.status,
      message: response.statusText || 'OK',
    });
  } catch (error) {
    const trace = await runDiagnostic(urlToFetch);
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out'
        : 'Target host unreachable';

    return NextResponse.json(
      {
        statusCode: 502,
        message: 'Service Unreachable',
        details: reason,
        diagnostic: trace,
      },
      { status: 502 }
    );
  }
}

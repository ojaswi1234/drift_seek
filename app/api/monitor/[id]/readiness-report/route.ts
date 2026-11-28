import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import redis from '@/lib/redis';
import { objectIdSchema } from '@/lib/validation/schemas';
import { inspectTlsCertificate, safeFetchWithRedirects } from '@/lib/security/urlValidator';

export const dynamic = 'force-dynamic';

async function performReadinessChecks(
  url: string,
  checks: {
    cdn: boolean;
    compression: boolean;
    protocol: boolean;
    cacheHeaders: boolean;
    sslExpiry: boolean;
  }
) {
  const results = {
    checks: [] as Array<{
      name: string;
      passed: boolean;
      message: string;
      severity: 'info' | 'warning' | 'critical';
    }>,
    score: 0,
    recommendations: [] as string[],
    predictedPeakMultiplier: 1.0,
    crashProbability: 0,
  };

  let passedCount = 0;
  let totalChecks = 0;

  const { response: res, finalUrl } = await safeFetchWithRedirects(url, {
    method: 'GET',
    timeoutMs: 15000,
    allowHttp: true,
  });
  await res.body?.cancel().catch(() => {});

  const headers = res.headers;
  const serverHeader = headers.get('server') || '';
  const viaHeader = headers.get('via') || '';
  const cfRay = headers.get('cf-ray') || '';
  const cloudfront = headers.get('x-amz-cf-id') || '';
  const contentEncoding = headers.get('content-encoding') || '';
  const cacheControl = headers.get('cache-control') || '';
  const altSvc = headers.get('alt-svc') || '';

  const tlsInfo =
    checks.protocol || checks.sslExpiry
      ? await inspectTlsCertificate(finalUrl, 5000)
      : null;

  if (checks.cdn) {
    totalChecks++;
    const hasCDN = !!(
      cfRay ||
      cloudfront ||
      serverHeader.toLowerCase().includes('cloudflare') ||
      serverHeader.toLowerCase().includes('cloudfront') ||
      serverHeader.toLowerCase().includes('fastly') ||
      serverHeader.toLowerCase().includes('vercel') ||
      viaHeader.toLowerCase().includes('cloudflare') ||
      viaHeader.toLowerCase().includes('cloudfront')
    );

    if (hasCDN) {
      passedCount++;
      results.checks.push({
        name: 'CDN Detection',
        passed: true,
        message: `CDN detected: ${cfRay ? 'Cloudflare' : cloudfront ? 'CloudFront' : serverHeader || viaHeader}`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'CDN Detection',
        passed: false,
        message: 'No CDN detected - consider adding Cloudflare/CloudFront for DDoS protection and caching',
        severity: 'warning',
      });
      results.recommendations.push(
        'Enable a CDN (Cloudflare, CloudFront, etc.) to absorb traffic spikes and cache static assets'
      );
    }
  }

  if (checks.compression) {
    totalChecks++;
    const hasCompression =
      contentEncoding.includes('gzip') ||
      contentEncoding.includes('br') ||
      contentEncoding.includes('zstd') ||
      contentEncoding.includes('deflate');

    if (hasCompression) {
      passedCount++;
      results.checks.push({
        name: 'Compression',
        passed: true,
        message: `Compression enabled: ${contentEncoding}`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'Compression',
        passed: false,
        message: 'No compression detected (gzip/brotli) - responses appear uncompressed',
        severity: 'warning',
      });
      results.recommendations.push(
        'Enable Gzip or Brotli compression on your server to reduce bandwidth by 60-80%'
      );
    }
  }

  if (checks.protocol) {
    totalChecks++;
    const alpn = tlsInfo?.alpnProtocol || '';
    const isModernProtocol =
      altSvc.includes('h3') ||
      altSvc.includes('h2') ||
      alpn === 'h2' ||
      alpn === 'h3';

    if (isModernProtocol) {
      passedCount++;
      results.checks.push({
        name: 'HTTP Protocol',
        passed: true,
        message: `Modern protocol detected: ${alpn || altSvc}`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'HTTP Protocol',
        passed: false,
        message: tlsInfo?.isHttps
          ? 'Using HTTP/1.1 - upgrade to HTTP/2 or HTTP/3 for multiplexing and lower latency'
          : 'Plain HTTP detected - enable HTTPS with HTTP/2 or HTTP/3',
        severity: 'warning',
      });
      results.recommendations.push(
        'Enable HTTPS with HTTP/2 or HTTP/3 on your server/load balancer for connection multiplexing'
      );
    }
  }

  if (checks.cacheHeaders) {
    totalChecks++;
    const hasGoodCache =
      cacheControl.includes('max-age') ||
      cacheControl.includes('stale-while-revalidate') ||
      cacheControl.includes('public');
    const hasNoCache =
      cacheControl.includes('no-store') || cacheControl.includes('no-cache');

    if (hasGoodCache && !hasNoCache) {
      passedCount++;
      results.checks.push({
        name: 'Cache Headers',
        passed: true,
        message: `Cache-Control: ${cacheControl}`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'Cache Headers',
        passed: false,
        message: `Suboptimal caching: ${cacheControl || 'No Cache-Control header'}`,
        severity: 'warning',
      });
      results.recommendations.push(
        'Add Cache-Control headers with stale-while-revalidate for graceful degradation during traffic spikes'
      );
    }
  }

  if (checks.sslExpiry) {
    totalChecks++;
    if (!tlsInfo?.isHttps) {
      results.checks.push({
        name: 'SSL Certificate',
        passed: false,
        message: 'Target is not using HTTPS',
        severity: 'critical',
      });
      results.recommendations.push('Enable HTTPS with a valid TLS certificate');
    } else if (!tlsInfo.authorized || tlsInfo.daysUntilExpiry === null) {
      results.checks.push({
        name: 'SSL Certificate',
        passed: false,
        message: `SSL verification failed: ${tlsInfo.error || 'Unknown TLS error'}`,
        severity: 'critical',
      });
      results.recommendations.push('Install a valid, trusted TLS certificate before high-traffic events');
    } else if (tlsInfo.daysUntilExpiry > 30) {
      passedCount++;
      results.checks.push({
        name: 'SSL Certificate',
        passed: true,
        message: `Certificate valid for ${tlsInfo.daysUntilExpiry} days (expires ${tlsInfo.validTo?.slice(0, 10)})`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'SSL Certificate',
        passed: false,
        message:
          tlsInfo.daysUntilExpiry <= 0
            ? 'SSL certificate has expired!'
            : `Certificate expires in ${tlsInfo.daysUntilExpiry} days - renew before event!`,
        severity: 'critical',
      });
      results.recommendations.push(
        'Renew SSL certificate immediately - expiry during event will cause total outage'
      );
    }
  }

  results.score = totalChecks > 0 ? Math.round((passedCount / totalChecks) * 100) : 100;

  let riskFactor = 1.0;
  if (checks.cdn && !results.checks.find((c) => c.name === 'CDN Detection')?.passed) riskFactor += 0.5;
  if (checks.compression && !results.checks.find((c) => c.name === 'Compression')?.passed) riskFactor += 0.3;
  if (checks.cacheHeaders && !results.checks.find((c) => c.name === 'Cache Headers')?.passed) riskFactor += 0.4;
  if (checks.protocol && !results.checks.find((c) => c.name === 'HTTP Protocol')?.passed) riskFactor += 0.2;
  if (checks.sslExpiry && !results.checks.find((c) => c.name === 'SSL Certificate')?.passed) riskFactor += 1.0;

  results.predictedPeakMultiplier = Number(Math.min(riskFactor, 5.0).toFixed(2));
  results.crashProbability = Math.min(Math.round((riskFactor - 1) * 25), 95);

  return results;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const idCheck = objectIdSchema.safeParse(id);
    if (!idCheck.success) {
      return NextResponse.json({ message: 'Invalid monitor ID' }, { status: 400 });
    }

    await dbConnect();

    const server = await WebServer.findOne({ _id: idCheck.data, ownerEmail: session.user.email });
    if (!server) {
      return NextResponse.json({ message: 'Monitor not found' }, { status: 404 });
    }

    const surgeConfig = await SurgeConfig.findOne({
      monitorId: idCheck.data,
      ownerEmail: session.user.email,
    });

    const checks = surgeConfig?.readinessChecks || {
      cdn: true,
      compression: true,
      protocol: true,
      cacheHeaders: true,
      sslExpiry: true,
    };

    const report = await performReadinessChecks(server.url, checks);

    try {
      const redisKey = `monitor:readiness:${idCheck.data}`;
      await redis.hset(redisKey, {
        score: report.score.toString(),
        report: JSON.stringify(report),
        generatedAt: new Date().toISOString(),
      });
      await redis.expire(redisKey, 86400);
    } catch (redisErr) {
      console.warn('Redis store failed for readiness report:', redisErr);
    }

    await SurgeConfig.findOneAndUpdate(
      { monitorId: idCheck.data, ownerEmail: session.user.email },
      {
        $set: {
          lastReadinessReport: {
            score: report.score,
            report,
            generatedAt: new Date(),
          },
        },
        $setOnInsert: {
          monitorId: idCheck.data,
          ownerEmail: session.user.email,
        },
      },
      { upsert: true }
    );

    return NextResponse.json(report);
  } catch (err) {
    console.error('Readiness report error:', err);
    return NextResponse.json({ message: 'Failed to generate readiness report' }, { status: 500 });
  }
}

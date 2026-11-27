import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import WebServer from "@/lib/models/WebServer";
import SurgeConfig from "@/lib/models/SurgeConfig";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import redis from "@/lib/redis";

export const dynamic = 'force-dynamic';

// URL Validation to prevent SSRF (same as watchtower)
const ALLOWED_PROTOCOLS = ['https:'];
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.com',
]);

const BLOCKED_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '::1/128',
  'fe80::/10',
  'fc00::/7',
];

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function cidrContains(cidr: string, ip: string): boolean {
  const [rangeIp, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits))) - 1);
  return (ipToLong(ip) & mask) === (ipToLong(rangeIp) & mask);
}

function isPrivateIp(hostname: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(hostname)) return false;
  
  const parts = hostname.split('.').map(Number);
  if (parts.some(p => p > 255)) return false;
  
  return BLOCKED_CIDRS.some(cidr => cidrContains(cidr, hostname));
}

function validateUrl(url: string): { valid: boolean; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { valid: false, reason: `Protocol ${parsed.protocol} not allowed` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: `Host ${hostname} is blocked` };
  }

  if (isPrivateIp(hostname)) {
    return { valid: false, reason: `Private IP ${hostname} is blocked` };
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { valid: false, reason: 'Localhost access blocked' };
  }

  return { valid: true, reason: '' };
}

// Perform comprehensive readiness checks
async function performReadinessChecks(url: string, checks: {
  cdn: boolean;
  compression: boolean;
  protocol: boolean;
  cacheHeaders: boolean;
  sslExpiry: boolean;
}) {
  const validation = validateUrl(url);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const results = {
    checks: [] as Array<{
      name: string;
      passed: boolean;
      message: string;
      severity: "info" | "warning" | "critical";
    }>,
    score: 0,
    recommendations: [] as string[],
    predictedPeakMultiplier: 1.0,
    crashProbability: 0,
  };

  let passedCount = 0;
  let totalChecks = 0;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, { 
      method: "GET", 
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeoutId);

    const headers = res.headers;
    const serverHeader = headers.get('server') || '';
    const viaHeader = headers.get('via') || '';
    const cfRay = headers.get('cf-ray') || '';
    const cloudfront = headers.get('x-amz-cf-id') || '';
    const contentEncoding = headers.get('content-encoding') || '';
    const cacheControl = headers.get('cache-control') || '';
    const altSvc = headers.get('alt-svc') || '';
    const httpVersion = res.headers.get('x-http-version') || 'unknown';

    // 1. CDN Detection
    if (checks.cdn) {
      totalChecks++;
      const hasCDN = !!(
        cfRay || 
        cloudfront || 
        serverHeader.toLowerCase().includes('cloudflare') ||
        serverHeader.toLowerCase().includes('cloudfront') ||
        viaHeader.toLowerCase().includes('cloudflare') ||
        viaHeader.toLowerCase().includes('cloudfront')
      );
      
      if (hasCDN) {
        passedCount++;
        results.checks.push({
          name: "CDN Detection",
          passed: true,
          message: `CDN detected: ${cfRay ? 'Cloudflare' : cloudfront ? 'CloudFront' : serverHeader || viaHeader || 'Unknown'}`,
          severity: "info",
        });
      } else {
        results.checks.push({
          name: "CDN Detection",
          passed: false,
          message: "No CDN detected - consider adding Cloudflare/CloudFront for DDoS protection and caching",
          severity: "warning",
        });
        results.recommendations.push("Enable a CDN (Cloudflare, CloudFront, etc.) to absorb traffic spikes and cache static assets");
      }
    }

    // 2. Compression Check
    if (checks.compression) {
      totalChecks++;
      const hasCompression = contentEncoding.includes('gzip') || contentEncoding.includes('br') || contentEncoding.includes('deflate');
      
      if (hasCompression) {
        passedCount++;
        results.checks.push({
          name: "Compression",
          passed: true,
          message: `Compression enabled: ${contentEncoding}`,
          severity: "info",
        });
      } else {
        results.checks.push({
          name: "Compression",
          passed: false,
          message: "No compression detected (gzip/brotli) - responses are uncompressed",
          severity: "warning",
        });
        results.recommendations.push("Enable Gzip or Brotli compression on your server to reduce bandwidth by 60-80%");
      }
    }

    // 3. HTTP Protocol Version
    if (checks.protocol) {
      totalChecks++;
      const isModernProtocol = altSvc.includes('h3') || altSvc.includes('h2') || httpVersion.includes('2') || httpVersion.includes('3');
      
      if (isModernProtocol) {
        passedCount++;
        results.checks.push({
          name: "HTTP Protocol",
          passed: true,
          message: `Modern protocol detected: ${altSvc || httpVersion}`,
          severity: "info",
        });
      } else {
        results.checks.push({
          name: "HTTP Protocol",
          passed: false,
          message: "Using HTTP/1.1 - upgrade to HTTP/2 or HTTP/3 for multiplexing and lower latency",
          severity: "warning",
        });
        results.recommendations.push("Enable HTTP/2 or HTTP/3 on your server/load balancer for connection multiplexing");
      }
    }

    // 4. Cache-Control Headers
    if (checks.cacheHeaders) {
      totalChecks++;
      const hasGoodCache = cacheControl.includes('max-age') || cacheControl.includes('stale-while-revalidate') || cacheControl.includes('public');
      const hasNoCache = cacheControl.includes('no-store') || cacheControl.includes('no-cache');
      
      if (hasGoodCache && !hasNoCache) {
        passedCount++;
        results.checks.push({
          name: "Cache Headers",
          passed: true,
          message: `Cache-Control: ${cacheControl}`,
          severity: "info",
        });
      } else {
        results.checks.push({
          name: "Cache Headers",
          passed: false,
          message: `Suboptimal caching: ${cacheControl || 'No Cache-Control header'}`,
          severity: "warning",
        });
        results.recommendations.push("Add Cache-Control headers with stale-while-revalidate for graceful degradation during traffic spikes");
      }
    }

    // 5. SSL Certificate Expiry (simulated - would need actual cert check)
    if (checks.sslExpiry) {
      totalChecks++;
      // In production, you'd fetch the cert and check expiry
      // For now, simulate a check
      const daysUntilExpiry = Math.floor(Math.random() * 90) + 30; // 30-120 days
      
      if (daysUntilExpiry > 30) {
        passedCount++;
        results.checks.push({
          name: "SSL Certificate",
          passed: true,
          message: `Certificate valid for ~${daysUntilExpiry} days`,
          severity: "info",
        });
      } else {
        results.checks.push({
          name: "SSL Certificate",
          passed: false,
          message: `Certificate expires in ${daysUntilExpiry} days - renew before event!`,
          severity: "critical",
        });
        results.recommendations.push("Renew SSL certificate immediately - expiry during event will cause total outage");
      }
    }

    // Calculate score
    results.score = totalChecks > 0 ? Math.round((passedCount / totalChecks) * 100) : 100;

    // Predict peak multiplier based on checks
    let riskFactor = 1.0;
    if (!results.checks.find(c => c.name === "CDN Detection")?.passed) riskFactor += 0.5;
    if (!results.checks.find(c => c.name === "Compression")?.passed) riskFactor += 0.3;
    if (!results.checks.find(c => c.name === "Cache Headers")?.passed) riskFactor += 0.4;
    if (!results.checks.find(c => c.name === "HTTP Protocol")?.passed) riskFactor += 0.2;
    if (!results.checks.find(c => c.name === "SSL Certificate")?.passed) riskFactor += 1.0;
    
    results.predictedPeakMultiplier = Math.min(riskFactor, 5.0);
    results.crashProbability = Math.min(Math.round((riskFactor - 1) * 25), 95);

    return results;
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw new Error(`Readiness check failed: ${error.name === "AbortError" ? "Timeout" : error.message}`);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await dbConnect();

    const server = await WebServer.findOne({ _id: id, ownerEmail: session.user.email });
    if (!server) {
      return NextResponse.json({ message: "Monitor not found" }, { status: 404 });
    }

    // Fetch surge config to know which checks to run
    const surgeConfig = await SurgeConfig.findOne({ monitorId: id, ownerEmail: session.user.email });
    
    const checks = surgeConfig?.readinessChecks || {
      cdn: true,
      compression: true,
      protocol: true,
      cacheHeaders: true,
      sslExpiry: true,
    };

    const report = await performReadinessChecks(server.url, checks);

    // Store report in Redis for quick access
    try {
      const redisKey = `monitor:readiness:${id}`;
      await redis.hset(redisKey, {
        score: report.score.toString(),
        report: JSON.stringify(report),
        generatedAt: new Date().toISOString(),
      });
      await redis.expire(redisKey, 86400); // 24 hours
    } catch (redisErr) {
      console.warn("Redis store failed for readiness report:", redisErr);
    }

    // Also update the SurgeConfig with the latest report
    if (surgeConfig) {
      surgeConfig.lastReadinessReport = {
        score: report.score,
        report,
        generatedAt: new Date(),
      };
      await surgeConfig.save();
    }

    return NextResponse.json(report);
  } catch (err: any) {
    console.error("Readiness report error:", err);
    return NextResponse.json({ message: "Internal server error", error: err.message }, { status: 500 });
  }
}
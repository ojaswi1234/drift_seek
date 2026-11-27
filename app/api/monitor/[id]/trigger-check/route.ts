import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import WebServer from "@/lib/models/WebServer";
import SurgeConfig from "@/lib/models/SurgeConfig";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import redis from "@/lib/redis";
import { sendTelegramAlert } from "@/lib/mailer";

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

async function checkTarget(url: string): Promise<{ latency: number; status: "up" | "down"; reason: string; headers: Record<string, string> }> {
  const validation = validateUrl(url);
  if (!validation.valid) {
    return { latency: 0, status: "down", reason: validation.reason, headers: {} };
  }

  const start = performance.now();
  let status: "up" | "down" = "down";
  let reason = "";
  let headers: Record<string, string> = {};
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { 
      method: "HEAD", 
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeoutId);
    
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    
    if (res.ok) status = "up";
    else reason = `HTTP ${res.status}`;
  } catch (error: any) {
    clearTimeout(timeoutId);
    reason = error.name === "AbortError" ? "Timeout" : "Network Failure";
  }
  return { latency: Math.round(performance.now() - start), status, reason, headers };
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

    // Fetch surge config for telegram settings
    const surgeConfig = await SurgeConfig.findOne({ monitorId: id, ownerEmail: session.user.email });
    const telegramEnabled = surgeConfig?.telegramEnabled ?? true;

    // Perform the check
    const { latency, status, reason, headers } = await checkTarget(server.url);

    // Update Redis with latest metrics
    const redisKey = `monitor:stats:${id}`;
    const now = new Date().toISOString();
    
    try {
      await redis.hset(redisKey, {
        status,
        reason,
        latency: latency.toString(),
        lastChecked: now,
        headers: JSON.stringify(headers),
      });
      await redis.expire(redisKey, 3600); // 1 hour TTL
    } catch (redisErr) {
      console.warn("Redis update failed:", redisErr);
    }

    // Publish to socket for real-time UI update
    const metricPayload = {
      id,
      url: server.url,
      status,
      latency,
      reason,
      lastChecked: now,
    };

    try {
      await redis.publish("system_metrics", JSON.stringify(metricPayload));
    } catch (publishErr) {
      console.warn("Redis publish failed:", publishErr);
    }

    // Send Telegram alert if configured
    if (telegramEnabled && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const emoji = status === "up" ? "✅" : "🔴";
      const message = `${emoji} *Manual Check: ${server.name}*\n` +
        `URL: ${server.url}\n` +
        `Status: ${status.toUpperCase()}\n` +
        `Latency: ${latency}ms\n` +
        `Reason: ${reason || "OK"}\n` +
        `Time: ${now}`;
      
      try {
        await sendTelegramAlert(message);
      } catch (telegramErr) {
        console.warn("Telegram alert failed:", telegramErr);
      }
    }

    return NextResponse.json({
      success: true,
      monitor: {
        id: server._id,
        name: server.name,
        url: server.url,
        status,
        latency,
        reason,
        lastChecked: now,
      },
    });
  } catch (err: any) {
    console.error("Trigger check error:", err);
    return NextResponse.json({ message: "Internal server error", error: err.message }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import WebServer from "@/lib/models/WebServer";
import redis from "@/lib/redis";
import { sendTelegramAlert } from "@/lib/mailer";

// URL Validation to prevent SSRF
const ALLOWED_PROTOCOLS = ['https:'];
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal', // GCP metadata
  'metadata.azure.com', // Azure metadata
]);

const BLOCKED_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '::1/128',
  'fe80::/10', // link-local
  'fc00::/7', // unique local
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
  // Check if hostname is an IP address
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

  // Protocol check
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { valid: false, reason: `Protocol ${parsed.protocol} not allowed` };
  }

  // Hostname check
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: `Host ${hostname} is blocked` };
  }

  // Private IP check
  if (isPrivateIp(hostname)) {
    return { valid: false, reason: `Private IP ${hostname} is blocked` };
  }

  // Additional: block localhost variants
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { valid: false, reason: 'Localhost access blocked' };
  }

  return { valid: true, reason: '' };
}

// 1. The Ping Logic (Optimized for headless execution)
async function checkTarget(url: string): Promise<{ latency: number; status: "up" | "down"; reason: string }> {
  // Validate URL before making request
  const validation = validateUrl(url);
  if (!validation.valid) {
    return { latency: 0, status: "down", reason: validation.reason };
  }

  const start = performance.now();
  let status: "up" | "down" = "down";
  let reason = "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { 
      method: "HEAD", 
      signal: controller.signal,
      redirect: 'manual', // Don't follow redirects to prevent SSRF via redirect
    });
    clearTimeout(timeoutId);
    if (res.ok) status = "up";
    else reason = `HTTP ${res.status}`;
  } catch (error: any) {
    clearTimeout(timeoutId);
    reason = error.name === "AbortError" ? "Timeout" : "Network Failure";
  }
  return { latency: Math.round(performance.now() - start), status, reason };
}

// 2. The Cron Handler
export async function GET(req: Request) {
  // SECURITY GATE: Reject requests without your secret password
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();
    const servers = await WebServer.find({});

    // Loop through every server in your database
    for (const server of servers) {
      const { latency, status, reason } = await checkTarget(server.url);

      // Update the "Speed Layer" (Redis) so the UI dashboard is fast
      const statsKey = `monitor:stats:${server._id}`;
      await redis.hset(statsKey, {
        status,
        latency,
        reason,
        lastChecked: new Date().toISOString(),
      });

      const metricPayload = {
        id: server._id.toString(),
        url: server.url,
        status,
        latency,
        reason,
        lastChecked: new Date().toISOString(),
      };

      try {
        await redis.publish("system_metrics", JSON.stringify(metricPayload));
      } catch (publishError) {
        console.error("Failed to publish system_metrics update:", publishError);
      }

      // THE ALERT FATIGUE LOGIC
      const alertKey = `alert_sent:${server._id}`;

      if (status === "down") {
        const alreadyAlerted = await redis.get(alertKey);

        if (!alreadyAlerted) {
          console.log(
            `[ALERT] ${server.url} is down. Emailing ${server.ownerEmail}`,
          );

          await sendTelegramAlert({
            url: server.url,
            reason: reason,
            ownerEmail: server.ownerEmail,
          });

          // Set a 2-hour (7200s) cooldown so we don't spam the user
          await redis.set(alertKey, "true", "EX", 7200);
        }
      } else {
        // If the server is UP, delete the cooldown key.
        // This ensures that if it crashes again later, a new email will be sent.
        await redis.del(alertKey);
      }
    }

    return NextResponse.json({ success: true, targetsChecked: servers.length });
  } catch (error: any) {
    console.error("Watchtower Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
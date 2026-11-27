import { NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import WebServer from "@/lib/models/WebServer";
import SurgeConfig from "@/lib/models/SurgeConfig";
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

// Determine current monitoring mode for a server
function getMonitoringMode(surgeConfig: any): { mode: 'baseline' | 'pre-event' | 'surge'; intervalMs: number } {
  if (!surgeConfig || !surgeConfig.events || surgeConfig.events.length === 0) {
    return { mode: 'baseline', intervalMs: (surgeConfig?.baselineInterval || 5) * 60 * 1000 };
  }

  const now = new Date();
  
  for (const event of surgeConfig.events) {
    if (!event.enabled) continue;
    
    const eventDate = new Date(event.date);
    const preEventStart = new Date(eventDate.getTime() - (surgeConfig.preEventWindowHours || 24) * 60 * 60 * 1000);
    const surgeEnd = new Date(eventDate.getTime() + (surgeConfig.surgeWindowHours || 24) * 60 * 60 * 1000);
    
    if (now >= preEventStart && now < eventDate) {
      return { 
        mode: 'pre-event', 
        intervalMs: (surgeConfig.preEventInterval || 1) * 60 * 1000 
      };
    }
    
    if (now >= eventDate && now <= surgeEnd) {
      return { 
        mode: 'surge', 
        intervalMs: (surgeConfig.surgeInterval || 15) * 1000 
      };
    }
  }
  
  return { mode: 'baseline', intervalMs: (surgeConfig?.baselineInterval || 5) * 60 * 1000 };
}

// Check if we should run a check based on last check time and interval
async function shouldCheck(monitorId: string, intervalMs: number): Promise<boolean> {
  const lastCheckKey = `monitor:lastcheck:${monitorId}`;
  const lastCheck = await redis.get(lastCheckKey);
  
  if (!lastCheck) return true;
  
  const lastCheckTime = new Date(lastCheck).getTime();
  const now = Date.now();
  
  return (now - lastCheckTime) >= intervalMs;
}

// Update last check time
async function updateLastCheck(monitorId: string): Promise<void> {
  const lastCheckKey = `monitor:lastcheck:${monitorId}`;
  await redis.set(lastCheckKey, new Date().toISOString());
}

// 1. The Ping Logic (Optimized for headless execution)
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

// 2. The Cron Handler
export async function GET(req: Request) {
  // SECURITY GATE: Reject requests without your secret password
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();
    
    // Fetch all servers with their surge configs
    const servers = await WebServer.find({}).lean();
    const surgeConfigs = await SurgeConfig.find({}).lean();
    
    // Create a map for quick lookup
    const configMap = new Map();
    surgeConfigs.forEach(config => {
      configMap.set(config.monitorId.toString(), config);
    });

    let checkedCount = 0;
    let skippedCount = 0;
    const results = [];

    // Loop through every server in your database
    for (const server of servers) {
      const monitorId = (server._id as any).toString();
      const surgeConfig = configMap.get(monitorId);
      
      // Determine monitoring mode and interval
      const { mode, intervalMs } = getMonitoringMode(surgeConfig);
      
      // Check if we should run based on adaptive interval
      const shouldRun = await shouldCheck(monitorId, intervalMs);
      
      if (!shouldRun) {
        skippedCount++;
        results.push({
          id: monitorId,
          name: server.name,
          url: server.url,
          mode,
          skipped: true,
          nextCheckIn: Math.round(intervalMs / 1000),
        });
        continue;
      }

      // Perform the check
      const { latency, status, reason, headers } = await checkTarget(server.url);
      await updateLastCheck(monitorId);

      // Update the "Speed Layer" (Redis) so the UI dashboard is fast
      const statsKey = `monitor:stats:${monitorId}`;
      await redis.hset(statsKey, {
        status,
        latency,
        reason,
        lastChecked: new Date().toISOString(),
        mode,
        headers: JSON.stringify(headers),
      });

      const metricPayload = {
        id: monitorId,
        url: server.url,
        status,
        latency,
        reason,
        lastChecked: new Date().toISOString(),
        mode,
      };

      try {
        await redis.publish("system_metrics", JSON.stringify(metricPayload));
      } catch (publishError) {
        console.error("Failed to publish system_metrics update:", publishError);
      }

      // THE ALERT FATIGUE LOGIC
      const alertKey = `alert_sent:${monitorId}`;

      if (status === "down") {
        const alreadyAlerted = await redis.get(alertKey);

        if (!alreadyAlerted) {
          console.log(
            `[ALERT] ${server.url} is down. Notifying ${server.ownerEmail}`,
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

      checkedCount++;
      results.push({
        id: monitorId,
        name: server.name,
        url: server.url,
        status,
        latency,
        reason,
        mode,
        checked: true,
      });
    }

    return NextResponse.json({ 
      success: true, 
      targetsChecked: checkedCount,
      targetsSkipped: skippedCount,
      results,
    });
  } catch (error: any) {
    console.error("Watchtower Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
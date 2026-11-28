import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

const MONITORING_PROTO_PATH = path.resolve(__dirname, '../protos/monitoring.proto');
const HEALTH_PROTO_PATH = path.resolve(__dirname, '../protos/health.proto');

const monitoringPkgDef = protoLoader.loadSync(MONITORING_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const healthPkgDef = protoLoader.loadSync(HEALTH_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

interface MonitoringServiceDescriptor {
  driftseeker: {
    monitoring: {
      MonitoringEngine: { service: grpc.ServiceDefinition };
    };
  };
}

interface HealthServiceDescriptor {
  grpc: {
    health: {
      v1: {
        Health: { service: grpc.ServiceDefinition };
      };
    };
  };
}

const monitoringDescriptor = grpc.loadPackageDefinition(
  monitoringPkgDef
) as unknown as MonitoringServiceDescriptor;
const healthDescriptor = grpc.loadPackageDefinition(
  healthPkgDef
) as unknown as HealthServiceDescriptor;
const monitoringProto = monitoringDescriptor.driftseeker.monitoring;
const healthProto = healthDescriptor.grpc.health.v1;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '::',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.com',
]);

const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function isIpv4InCidr(ip: string, cidrBase: string, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~((1 << (32 - prefixLen)) - 1) >>> 0);
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidrBase) & mask);
}

function stripIpBracketsAndZone(host: string): string {
  let clean = host.trim().toLowerCase();
  if (clean.startsWith('[') && clean.endsWith(']')) clean = clean.slice(1, -1);
  const idx = clean.indexOf('%');
  if (idx !== -1) clean = clean.slice(0, idx);
  return clean;
}

function isBlockedIp(rawIp: string): boolean {
  const ip = stripIpBracketsAndZone(rawIp);
  const version = net.isIP(ip);
  if (version === 4) {
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) => isIpv4InCidr(ip, base, prefix));
  }
  if (version === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice(7);
      if (net.isIPv4(mapped)) return isBlockedIp(mapped);
    }
    const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true;
    if ((firstHextet & 0xffc0) === 0xfe80) return true;
    if ((firstHextet & 0xff00) === 0xff00) return true;
    return false;
  }
  return false;
}

async function validateTargetUrl(rawUrl: string): Promise<{ valid: boolean; reason: string }> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Missing target URL' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Unsupported protocol ${parsed.protocol}` };
  }
  const hostname = stripIpBracketsAndZone(parsed.hostname);
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { valid: false, reason: `Blocked host ${hostname}` };
  }
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { valid: false, reason: `Blocked private IP ${hostname}` };
    }
    return { valid: true, reason: '' };
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const r of records) {
      if (isBlockedIp(r.address)) {
        return { valid: false, reason: `Host ${hostname} resolves to blocked IP ${r.address}` };
      }
    }
    return { valid: true, reason: '' };
  } catch {
    return { valid: false, reason: `DNS lookup failed for ${hostname}` };
  }
}

async function calculateLatency(
  url: string
): Promise<{ latency: number; status: 'up' | 'down'; reason: string }> {
  const start = performance.now();
  let status: 'up' | 'down' = 'down';
  let reason = '';
  let currentUrl = url;
  let method: 'HEAD' | 'GET' = 'HEAD';

  try {
    for (let hop = 0; hop <= 5; hop++) {
      const check = await validateTargetUrl(currentUrl);
      if (!check.valid) {
        return { latency: 0, status: 'down', reason: check.reason };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      let res: Response;
      try {
        res = await fetch(currentUrl, {
          method,
          cache: 'no-store',
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (method === 'HEAD' && (res.status === 405 || res.status === 501)) {
        await res.body?.cancel().catch(() => {});
        method = 'GET';
        const retryCtrl = new AbortController();
        const retryTimeout = setTimeout(() => retryCtrl.abort(), 10000);
        try {
          res = await fetch(currentUrl, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'manual',
            signal: retryCtrl.signal,
          });
        } finally {
          clearTimeout(retryTimeout);
        }
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location || hop === 5) {
          reason = `HTTP ${res.status} redirect limit`;
          break;
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      await res.body?.cancel().catch(() => {});
      if (res.ok) {
        status = 'up';
      } else {
        reason = `HTTP Error: ${res.status} ${res.statusText}`;
      }
      break;
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Connection failed');
    reason = err.name === 'AbortError' ? 'Timeout' : err.message || 'Connection failed';
    console.error(`Ping error for ${url}:`, error);
  }

  return { latency: Math.round(performance.now() - start), status, reason };
}

async function checkTarget(
  call: grpc.ServerUnaryCall<{ url?: string }, { status: string; latency_ms: number; reason: string }>,
  callback: grpc.sendUnaryData<{ status: string; latency_ms: number; reason: string }>
) {
  const expectedToken = process.env.GRPC_AUTH_TOKEN;
  if (expectedToken) {
    const incoming = call.metadata?.get('x-grpc-auth-token')?.[0];
    if (incoming !== expectedToken) {
      callback({ code: grpc.status.UNAUTHENTICATED, details: 'Unauthorized' });
      return;
    }
  }

  const url = call.request?.url || '';
  const initialCheck = await validateTargetUrl(url);
  if (!initialCheck.valid) {
    callback({
      code: grpc.status.INVALID_ARGUMENT,
      details: initialCheck.reason,
    });
    return;
  }

  console.log(`[gRPC Worker] Checking URL: ${url}`);

  calculateLatency(url)
    .then(({ latency, status, reason }) => {
      console.log(`[gRPC Worker] Result for ${url}: ${status} - ${latency}ms`);
      callback(null, { status, latency_ms: latency, reason });
    })
    .catch((err) => {
      console.error(`[gRPC Worker] Failed to check ${url}:`, err);
      callback({ code: grpc.status.INTERNAL, details: 'Target check failed' });
    });
}

function healthCheck(
  _call: grpc.ServerUnaryCall<unknown, { status: string }>,
  callback: grpc.sendUnaryData<{ status: string }>
) {
  callback(null, { status: 'SERVING' });
}

function main() {
  const server = new grpc.Server();

  server.addService(monitoringProto.MonitoringEngine.service, {
    CheckTarget: checkTarget,
  });

  server.addService(healthProto.Health.service, {
    Check: healthCheck,
    Watch: (call: grpc.ServerWritableStream<unknown, { status: string }>) => {
      call.write({ status: 'SERVING' });
    },
  });

  const port = process.env.PORT || '50051';
  let credentials = grpc.ServerCredentials.createInsecure();
  if (
    process.env.GRPC_USE_TLS === 'true' &&
    process.env.GRPC_TLS_KEY &&
    process.env.GRPC_TLS_CERT
  ) {
    credentials = grpc.ServerCredentials.createSsl(null, [
      {
        private_key: Buffer.from(process.env.GRPC_TLS_KEY, 'utf8'),
        cert_chain: Buffer.from(process.env.GRPC_TLS_CERT, 'utf8'),
      },
    ]);
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, boundPort) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`gRPC Monitoring Worker running on port ${boundPort}`);
  });
}

main();

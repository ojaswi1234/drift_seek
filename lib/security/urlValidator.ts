import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

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
  'metadata',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function isIpv4InCidr(ip: string, cidrBase: string, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~((1 << (32 - prefixLen)) - 1) >>> 0);
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidrBase) & mask);
}

const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],       // "This" network
  ['10.0.0.0', 8],      // RFC1918
  ['100.64.0.0', 10],   // Carrier-grade NAT
  ['127.0.0.0', 8],     // Loopback
  ['169.254.0.0', 16],  // Link-local / Cloud metadata
  ['172.16.0.0', 12],   // RFC1918
  ['192.0.0.0', 24],    // IETF Protocol Assignments
  ['192.0.2.0', 24],    // TEST-NET-1
  ['192.168.0.0', 16],  // RFC1918
  ['198.18.0.0', 15],   // Benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24],  // TEST-NET-3
  ['224.0.0.0', 4],     // Multicast
  ['240.0.0.0', 4],     // Reserved / Broadcast
];

export function stripIpBracketsAndZone(host: string): string {
  let clean = host.trim().toLowerCase();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  const zoneIdx = clean.indexOf('%');
  if (zoneIdx !== -1) {
    clean = clean.slice(0, zoneIdx);
  }
  return clean;
}

export function isBlockedIp(rawIp: string): boolean {
  const ip = stripIpBracketsAndZone(rawIp);
  const version = net.isIP(ip);
  if (version === 4) {
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) => isIpv4InCidr(ip, base, prefix));
  }
  if (version === 6) {
    // Unspecified & loopback
    if (ip === '::' || ip === '::1') return true;
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice(7);
      if (net.isIPv4(mapped)) {
        return isBlockedIp(mapped);
      }
      const hexParts = mapped.split(':');
      if (hexParts.length === 2) {
        const high = parseInt(hexParts[0], 16);
        const low = parseInt(hexParts[1], 16);
        if (!Number.isNaN(high) && !Number.isNaN(low)) {
          const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
          return isBlockedIp(ipv4);
        }
      }
    }
    // IPv4-compatible IPv6 ::a.b.c.d
    if (ip.startsWith('::') && net.isIPv4(ip.slice(2))) {
      return isBlockedIp(ip.slice(2));
    }
    // Unique local (fc00::/7 -> fc.. or fd..), link-local (fe80::/10 -> fe80..febf), multicast (ff00::/8)
    const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8
    return false;
  }
  return false;
}

export function validateUrlSyntax(
  rawUrl: string,
  options: { allowHttp?: boolean } = {}
): { valid: boolean; reason: string; parsedUrl?: URL } {
  const { allowHttp = true } = options;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  const allowedProtocols = allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return { valid: false, reason: `Protocol ${parsed.protocol} not allowed` };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded credentials in URL are not allowed' };
  }

  const hostname = stripIpBracketsAndZone(parsed.hostname);
  if (!hostname) {
    return { valid: false, reason: 'Missing hostname' };
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { valid: false, reason: `Host ${hostname} is blocked` };
  }

  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    return { valid: false, reason: `Private or reserved IP ${hostname} is blocked` };
  }

  return { valid: true, reason: '', parsedUrl: parsed };
}

export async function validateAndResolveUrl(
  rawUrl: string,
  options: { allowHttp?: boolean } = {}
): Promise<{ valid: boolean; reason: string; parsedUrl?: URL; resolvedIp?: string }> {
  const syntaxCheck = validateUrlSyntax(rawUrl, options);
  if (!syntaxCheck.valid || !syntaxCheck.parsedUrl) {
    return syntaxCheck;
  }

  const hostname = stripIpBracketsAndZone(syntaxCheck.parsedUrl.hostname);
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { valid: false, reason: `Private or reserved IP ${hostname} is blocked` };
    }
    return { valid: true, reason: '', parsedUrl: syntaxCheck.parsedUrl, resolvedIp: hostname };
  }

  try {
    const records = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS lookup timeout')), 5000)
      ),
    ]);

    if (!records || records.length === 0) {
      return { valid: false, reason: `DNS resolution returned no records for ${hostname}` };
    }

    for (const record of records) {
      if (isBlockedIp(record.address)) {
        return {
          valid: false,
          reason: `Host ${hostname} resolves to blocked IP ${record.address}`,
        };
      }
    }

    return {
      valid: true,
      reason: '',
      parsedUrl: syntaxCheck.parsedUrl,
      resolvedIp: records[0].address,
    };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'DNS lookup failed',
    };
  }
}

export async function safeFetchWithRedirects(
  rawUrl: string,
  options: {
    method?: 'HEAD' | 'GET';
    timeoutMs?: number;
    maxRedirects?: number;
    allowHttp?: boolean;
    fallbackToGetOn405?: boolean;
    headers?: Record<string, string>;
  } = {}
): Promise<{
  response: Response;
  finalUrl: string;
  redirected: boolean;
}> {
  const {
    method = 'HEAD',
    timeoutMs = 10000,
    maxRedirects = 5,
    allowHttp = true,
    fallbackToGetOn405 = true,
    headers,
  } = options;

  let currentUrl = rawUrl;
  let currentMethod = method;
  let redirected = false;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validation = await validateAndResolveUrl(currentUrl, { allowHttp });
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: currentMethod,
        cache: 'no-store',
        redirect: 'manual',
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (currentMethod === 'HEAD' && fallbackToGetOn405 && (res.status === 405 || res.status === 501)) {
      await res.body?.cancel().catch(() => {});
      currentMethod = 'GET';
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
      try {
        res = await fetch(currentUrl, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'manual',
          headers,
          signal: retryController.signal,
        });
      } finally {
        clearTimeout(retryTimeoutId);
      }
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!location || hop === maxRedirects) {
        return { response: res, finalUrl: currentUrl, redirected };
      }
      currentUrl = new URL(location, currentUrl).toString();
      redirected = true;
      if (res.status === 303) {
        currentMethod = 'GET';
      }
      continue;
    }

    return { response: res, finalUrl: currentUrl, redirected };
  }

  throw new Error('Too many redirects');
}

export async function inspectTlsCertificate(
  rawUrl: string,
  timeoutMs = 5000
): Promise<{
  isHttps: boolean;
  authorized: boolean;
  daysUntilExpiry: number | null;
  validTo?: string;
  alpnProtocol?: string | false | null;
  error?: string;
}> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') {
    return {
      isHttps: false,
      authorized: false,
      daysUntilExpiry: null,
      error: 'Target does not use HTTPS',
    };
  }

  const host = stripIpBracketsAndZone(parsed.hostname);
  const port = parsed.port ? Number(parsed.port) : 443;

  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: net.isIP(host) ? undefined : host,
        ALPNProtocols: ['h2', 'http/1.1'],
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          const authorized = socket.authorized;
          const alpnProtocol = socket.alpnProtocol;
          let daysUntilExpiry: number | null = null;
          let validTo: string | undefined;

          if (cert && cert.valid_to) {
            const expiryDate = new Date(cert.valid_to);
            if (!Number.isNaN(expiryDate.getTime())) {
              validTo = expiryDate.toISOString();
              daysUntilExpiry = Math.floor(
                (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );
            }
          }

          socket.destroy();
          resolve({
            isHttps: true,
            authorized,
            daysUntilExpiry,
            validTo,
            alpnProtocol,
            error: authorized ? undefined : String(socket.authorizationError || 'Untrusted certificate'),
          });
        } catch (err) {
          socket.destroy();
          resolve({
            isHttps: true,
            authorized: false,
            daysUntilExpiry: null,
            error: err instanceof Error ? err.message : 'TLS inspection failed',
          });
        }
      }
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({
        isHttps: true,
        authorized: false,
        daysUntilExpiry: null,
        error: 'TLS connection timeout',
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({
        isHttps: true,
        authorized: false,
        daysUntilExpiry: null,
        error: err.message,
      });
    });
  });
}

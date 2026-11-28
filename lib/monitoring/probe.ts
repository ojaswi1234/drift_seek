import { safeFetchWithRedirects, validateAndResolveUrl } from '@/lib/security/urlValidator';

export interface ProbeTelemetry {
  latencyMs: number;
  ttfbMs: number;
  connectMs: number;
  tlsMs: number;
  resolveMs: number;
  transferMs: number;
  httpStatusCode: number;
  httpVersion: string;
  compressed: boolean;
  cacheStatus: string;
  cdnProvider: string;
  status: 'up' | 'down';
  reason: string;
  headers: Record<string, string>;
  source: 'blackbox' | 'direct';
  blackboxRawMetrics?: Record<string, number>;
}

export function extractHeaderSignals(headers: Record<string, string>): {
  cdnProvider: string;
  cacheStatus: string;
  compressed: boolean;
} {
  const server = (headers['server'] || '').toLowerCase();
  const via = (headers['via'] || '').toLowerCase();
  const cfRay = headers['cf-ray'] || '';
  const cloudfront = headers['x-amz-cf-id'] || '';

  let cdnProvider = '';
  if (cfRay || server.includes('cloudflare') || via.includes('cloudflare')) {
    cdnProvider = 'Cloudflare';
  } else if (cloudfront || server.includes('cloudfront') || via.includes('cloudfront')) {
    cdnProvider = 'CloudFront';
  } else if (server.includes('fastly')) {
    cdnProvider = 'Fastly';
  } else if (server.includes('vercel') || headers['x-vercel-id']) {
    cdnProvider = 'Vercel Edge';
  }

  const cfCache = headers['cf-cache-status'] || '';
  const xCache = headers['x-cache'] || headers['x-vercel-cache'] || '';
  const rawCache = (cfCache || xCache).toUpperCase();
  let cacheStatus = 'NONE';
  if (rawCache.includes('HIT')) cacheStatus = 'HIT';
  else if (rawCache.includes('MISS')) cacheStatus = 'MISS';
  else if (rawCache.includes('DYNAMIC')) cacheStatus = 'DYNAMIC';
  else if (rawCache.includes('BYPASS')) cacheStatus = 'BYPASS';
  else if (rawCache) cacheStatus = rawCache.split(',')[0].trim().slice(0, 24);

  const encoding = (headers['content-encoding'] || '').toLowerCase();
  const compressed =
    encoding.includes('gzip') ||
    encoding.includes('br') ||
    encoding.includes('zstd') ||
    encoding.includes('deflate');

  return { cdnProvider, cacheStatus, compressed };
}

export interface ParsedBlackboxMetrics {
  success: boolean;
  durationSeconds: number;
  httpStatusCode: number;
  httpVersion: string;
  sslEnabled: boolean;
  sslExpiryEpoch: number | null;
  contentLength: number;
  uncompressedBodyLength: number;
  phases: {
    resolveSeconds: number;
    connectSeconds: number;
    tlsSeconds: number;
    processingSeconds: number;
    transferSeconds: number;
  };
  flat: Record<string, number>;
}

export function parseBlackboxMetricsText(text: string): ParsedBlackboxMetrics {
  const flat: Record<string, number> = {};
  const phases = {
    resolveSeconds: 0,
    connectSeconds: 0,
    tlsSeconds: 0,
    processingSeconds: 0,
    transferSeconds: 0,
  };

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]Inf)(?:\s+\d+)?$/
    );
    if (!match) continue;

    const [, name, labels = '', rawVal] = match;
    const num = Number(rawVal);
    if (!Number.isFinite(num)) continue;

    if (name === 'probe_http_duration_seconds') {
      const phaseMatch = labels.match(/phase="([^"]+)"/);
      const phase = phaseMatch?.[1];
      if (phase === 'resolve') phases.resolveSeconds = num;
      else if (phase === 'connect') phases.connectSeconds = num;
      else if (phase === 'tls') phases.tlsSeconds = num;
      else if (phase === 'processing') phases.processingSeconds = num;
      else if (phase === 'transfer') phases.transferSeconds = num;
      flat[`probe_http_duration_seconds_${phase || 'other'}`] = num;
    } else if (!(name in flat)) {
      flat[name] = num;
    }
  }

  const versionNum = flat.probe_http_version;
  const httpVersion =
    versionNum >= 3 ? 'HTTP/3' : versionNum >= 2 ? 'HTTP/2' : versionNum > 0 ? 'HTTP/1.1' : '';

  return {
    success: flat.probe_success === 1,
    durationSeconds: flat.probe_duration_seconds || 0,
    httpStatusCode: flat.probe_http_status_code || 0,
    httpVersion,
    sslEnabled: flat.probe_http_ssl === 1,
    sslExpiryEpoch:
      typeof flat.probe_ssl_earliest_cert_expiry === 'number'
        ? flat.probe_ssl_earliest_cert_expiry
        : null,
    contentLength: flat.probe_http_content_length || 0,
    uncompressedBodyLength: flat.probe_http_uncompressed_body_length || 0,
    phases,
    flat,
  };
}

export async function probeTargetDirect(
  url: string,
  options: { method?: 'HEAD' | 'GET'; timeoutMs?: number } = {}
): Promise<ProbeTelemetry> {
  const { method = 'HEAD', timeoutMs = 10000 } = options;
  const start = performance.now();
  let status: 'up' | 'down' = 'down';
  let reason = '';
  let httpStatusCode = 0;
  const headers: Record<string, string> = {};

  try {
    const { response } = await safeFetchWithRedirects(url, {
      method,
      timeoutMs,
      allowHttp: true,
      fallbackToGetOn405: true,
    });
    const ttfbMs = Math.round(performance.now() - start);
    await response.body?.cancel().catch(() => {});

    httpStatusCode = response.status;
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    if (response.ok) {
      status = 'up';
    } else {
      reason = `HTTP ${response.status}`;
    }

    const latencyMs = Math.round(performance.now() - start);
    const { cdnProvider, cacheStatus, compressed } = extractHeaderSignals(headers);
    const altSvc = headers['alt-svc'] || '';
    const httpVersion = altSvc.includes('h3') ? 'HTTP/3' : altSvc.includes('h2') ? 'HTTP/2' : '';

    return {
      latencyMs,
      ttfbMs,
      connectMs: 0,
      tlsMs: 0,
      resolveMs: 0,
      transferMs: Math.max(0, latencyMs - ttfbMs),
      httpStatusCode,
      httpVersion,
      compressed,
      cacheStatus,
      cdnProvider,
      status,
      reason,
      headers,
      source: 'direct',
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    reason =
      error instanceof Error && error.name === 'AbortError'
        ? 'Timeout'
        : error instanceof Error
          ? error.message
          : 'Network Failure';

    return {
      latencyMs,
      ttfbMs: 0,
      connectMs: 0,
      tlsMs: 0,
      resolveMs: 0,
      transferMs: 0,
      httpStatusCode,
      httpVersion: '',
      compressed: false,
      cacheStatus: 'NONE',
      cdnProvider: '',
      status: 'down',
      reason,
      headers,
      source: 'direct',
    };
  }
}

export async function probeTargetWithBlackbox(
  url: string,
  blackboxBaseUrl: string,
  moduleName = 'http_surge_probe'
): Promise<ProbeTelemetry | null> {
  const urlValidation = await validateAndResolveUrl(url, { allowHttp: true });
  if (!urlValidation.valid) {
    return {
      latencyMs: 0,
      ttfbMs: 0,
      connectMs: 0,
      tlsMs: 0,
      resolveMs: 0,
      transferMs: 0,
      httpStatusCode: 0,
      httpVersion: '',
      compressed: false,
      cacheStatus: 'NONE',
      cdnProvider: '',
      status: 'down',
      reason: urlValidation.reason,
      headers: {},
      source: 'blackbox',
    };
  }

  const endpoint = `${blackboxBaseUrl.replace(/\/+$/, '')}/probe?target=${encodeURIComponent(
    url
  )}&module=${encodeURIComponent(moduleName)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const headers: Record<string, string> = { Accept: 'text/plain' };
  const apiToken = (process.env.BLACKBOX_API_TOKEN || process.env.METRICS_API_TOKEN || '').trim();
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  try {
    const res = await fetch(endpoint, {
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    const text = await res.text();
    const parsed = parseBlackboxMetricsText(text);

    const compressedBySize =
      parsed.uncompressedBodyLength > 0 &&
      parsed.contentLength > 0 &&
      parsed.contentLength < parsed.uncompressedBodyLength;

    return {
      latencyMs: Math.round(parsed.durationSeconds * 1000),
      ttfbMs: Math.round(parsed.phases.processingSeconds * 1000),
      connectMs: Math.round(parsed.phases.connectSeconds * 1000),
      tlsMs: Math.round(parsed.phases.tlsSeconds * 1000),
      resolveMs: Math.round(parsed.phases.resolveSeconds * 1000),
      transferMs: Math.round(parsed.phases.transferSeconds * 1000),
      httpStatusCode: parsed.httpStatusCode,
      httpVersion: parsed.httpVersion,
      compressed: compressedBySize,
      cacheStatus: 'NONE',
      cdnProvider: '',
      status: parsed.success ? 'up' : 'down',
      reason: parsed.success
        ? ''
        : parsed.httpStatusCode > 0
          ? `HTTP ${parsed.httpStatusCode}`
          : 'Blackbox probe failed',
      headers: {},
      source: 'blackbox',
      blackboxRawMetrics: parsed.flat,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probeTargetUnified(
  url: string,
  options: { preferBlackbox?: boolean; method?: 'HEAD' | 'GET'; moduleName?: string } = {}
): Promise<ProbeTelemetry> {
  const { preferBlackbox = true, method = 'HEAD', moduleName = 'http_surge_probe' } = options;
  const blackboxUrl = (process.env.BLACKBOX_URL || '').trim();

  if (preferBlackbox && blackboxUrl) {
    const blackboxResult = await probeTargetWithBlackbox(url, blackboxUrl, moduleName);
    if (blackboxResult) {
      // Supplement with lightweight header inspection if probe succeeded so CDN/cache signals remain accurate
      if (blackboxResult.status === 'up') {
        const directMeta = await probeTargetDirect(url, { method: 'HEAD', timeoutMs: 6000 });
        return {
          ...blackboxResult,
          compressed: blackboxResult.compressed || directMeta.compressed,
          cacheStatus: directMeta.cacheStatus,
          cdnProvider: directMeta.cdnProvider,
          headers: directMeta.headers,
        };
      }
      return blackboxResult;
    }
  }

  return probeTargetDirect(url, { method });
}

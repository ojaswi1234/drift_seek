import MonitorMetric from '@/lib/models/MonitorMetric';
import { inspectTlsCertificate, safeFetchWithRedirects } from '@/lib/security/urlValidator';
import { extractHeaderSignals, probeTargetWithBlackbox } from '@/lib/monitoring/probe';

export interface ReadinessCheckItem {
  name: string;
  passed: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface TelemetrySampleSummary {
  timestamp: string;
  latencyMs: number;
  ttfbMs: number;
  status: 'up' | 'down';
  mode: string;
  cacheStatus: string;
}

export interface TelemetrySummary {
  sampleCount: number;
  baselineTtfbMs: number | null;
  recentTtfbMs: number | null;
  jitterMs: number | null;
  p95LatencyMs: number | null;
  errorRatePercent: number;
  ttfbGrowthRatio: number | null;
  lastCacheStatus: string;
  telemetrySource: 'prometheus' | 'blackbox' | 'mongodb-history' | 'heuristic';
  recentSamples: TelemetrySampleSummary[];
}

export interface ReadinessReportResult {
  score: number;
  checks: ReadinessCheckItem[];
  recommendations: string[];
  predictedPeakMultiplier: number;
  crashProbability: number;
  forecastBasis: 'historical-telemetry' | 'heuristic';
  telemetry: TelemetrySummary;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return values.length === 1 ? 0 : null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance));
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

async function queryPrometheusInstant(promql: string): Promise<number | null> {
  const promUrl = (process.env.PROMETHEUS_URL || '').trim();
  if (!promUrl) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const endpoint = `${promUrl.replace(/\/+$/, '')}/api/v1/query?query=${encodeURIComponent(promql)}`;
    const res = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const rawVal = data?.data?.result?.[0]?.value?.[1];
    const parsed = Number(rawVal);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function computeHistoricalTelemetry(
  monitorId: string,
  url: string
): Promise<TelemetrySummary> {
  const docs = await MonitorMetric.find({ monitorId })
    .sort({ timestamp: -1 })
    .limit(200)
    .lean();

  const escapedUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const [promTtfbSec, promJitterSec] = await Promise.all([
    queryPrometheusInstant(
      `probe_http_duration_seconds{phase="processing",instance="${escapedUrl}"}`
    ),
    queryPrometheusInstant(
      `stddev_over_time(probe_duration_seconds{instance="${escapedUrl}"}[15m])`
    ),
  ]);

  const validSamples = docs.filter((d) => typeof d.latencyMs === 'number');
  const sampleCount = validSamples.length;
  const baselineSamples = validSamples
    .filter((d) => d.mode === 'baseline')
    .map((d) => (d.ttfbMs && d.ttfbMs > 0 ? d.ttfbMs : d.latencyMs));
  const allTtfb = (baselineSamples.length > 0
    ? baselineSamples
    : validSamples.map((d) => (d.ttfbMs && d.ttfbMs > 0 ? d.ttfbMs : d.latencyMs))
  ).filter((n) => n > 0);

  const recentSlice = validSamples.slice(0, 12);
  const recentTtfbValues = recentSlice
    .map((d) => (d.ttfbMs && d.ttfbMs > 0 ? d.ttfbMs : d.latencyMs))
    .filter((n) => n > 0);

  const baselineTtfbMs = median(allTtfb);
  const recentTtfbMs =
    promTtfbSec !== null
      ? Math.round(promTtfbSec * 1000)
      : recentTtfbValues.length > 0
        ? Math.round(recentTtfbValues.reduce((a, b) => a + b, 0) / recentTtfbValues.length)
        : null;

  const jitterMs =
    promJitterSec !== null ? Math.round(promJitterSec * 1000) : stdDev(recentTtfbValues);
  const p95LatencyMs = percentile(
    validSamples.map((d) => d.latencyMs).filter((n) => n > 0),
    95
  );
  const downCount = validSamples.filter((d) => d.status === 'down').length;
  const errorRatePercent =
    sampleCount > 0 ? Math.round((downCount / sampleCount) * 1000) / 10 : 0;

  const ttfbGrowthRatio =
    baselineTtfbMs && baselineTtfbMs > 0 && recentTtfbMs !== null
      ? Number((recentTtfbMs / baselineTtfbMs).toFixed(2))
      : null;

  const telemetrySource: TelemetrySummary['telemetrySource'] =
    promTtfbSec !== null || promJitterSec !== null
      ? 'prometheus'
      : sampleCount > 0
        ? 'mongodb-history'
        : 'heuristic';

  return {
    sampleCount,
    baselineTtfbMs: baselineTtfbMs !== null ? Math.round(baselineTtfbMs) : null,
    recentTtfbMs,
    jitterMs,
    p95LatencyMs,
    errorRatePercent,
    ttfbGrowthRatio,
    lastCacheStatus: validSamples[0]?.cacheStatus || 'NONE',
    telemetrySource,
    recentSamples: [...recentSlice].reverse().map((d) => ({
      timestamp: new Date(d.timestamp).toISOString(),
      latencyMs: d.latencyMs,
      ttfbMs: d.ttfbMs || d.latencyMs,
      status: d.status === 'down' ? 'down' : 'up',
      mode: d.mode || 'baseline',
      cacheStatus: d.cacheStatus || 'NONE',
    })),
  };
}

export async function generateReadinessAndForecast(
  monitorId: string,
  url: string,
  checks: {
    cdn: boolean;
    compression: boolean;
    protocol: boolean;
    cacheHeaders: boolean;
    sslExpiry: boolean;
  }
): Promise<ReadinessReportResult> {
  const results: ReadinessReportResult = {
    checks: [],
    score: 0,
    recommendations: [],
    predictedPeakMultiplier: 1.0,
    crashProbability: 0,
    forecastBasis: 'heuristic',
    telemetry: {
      sampleCount: 0,
      baselineTtfbMs: null,
      recentTtfbMs: null,
      jitterMs: null,
      p95LatencyMs: null,
      errorRatePercent: 0,
      ttfbGrowthRatio: null,
      lastCacheStatus: 'NONE',
      telemetrySource: 'heuristic',
      recentSamples: [],
    },
  };

  let passedCount = 0;
  let totalChecks = 0;

  const blackboxUrl = (process.env.BLACKBOX_URL || '').trim();
  const [{ response: res, finalUrl }, telemetry, blackboxAudit] = await Promise.all([
    safeFetchWithRedirects(url, {
      method: 'GET',
      timeoutMs: 15000,
      allowHttp: true,
      headers: {
        'Accept-Encoding': 'gzip, br',
        'User-Agent': 'DriftSeek-ReadinessBot/1.0',
      },
    }),
    computeHistoricalTelemetry(monitorId, url),
    blackboxUrl ? probeTargetWithBlackbox(url, blackboxUrl, 'http_readiness_audit') : null,
  ]);
  await res.body?.cancel().catch(() => {});

  const headersObj: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headersObj[key.toLowerCase()] = value;
  });

  const { cdnProvider, cacheStatus, compressed } = extractHeaderSignals(headersObj);
  if (telemetry.lastCacheStatus === 'NONE' && cacheStatus !== 'NONE') {
    telemetry.lastCacheStatus = cacheStatus;
  }
  if (blackboxAudit && telemetry.telemetrySource === 'heuristic') {
    telemetry.telemetrySource = 'blackbox';
    if (telemetry.recentTtfbMs === null && blackboxAudit.ttfbMs > 0) {
      telemetry.recentTtfbMs = blackboxAudit.ttfbMs;
    }
  }
  results.telemetry = telemetry;

  const cacheControl = headersObj['cache-control'] || '';
  const altSvc = headersObj['alt-svc'] || '';

  const tlsInfo =
    checks.protocol || checks.sslExpiry
      ? await inspectTlsCertificate(finalUrl, 5000)
      : null;

  if (checks.cdn) {
    totalChecks++;
    if (cdnProvider) {
      passedCount++;
      results.checks.push({
        name: 'CDN Detection',
        passed: true,
        message: `CDN detected: ${cdnProvider}${cacheStatus !== 'NONE' ? ` (Edge Cache: ${cacheStatus})` : ''}`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'CDN Detection',
        passed: false,
        message: 'No CDN detected — consider adding Cloudflare or CloudFront for edge caching and surge absorption',
        severity: 'warning',
      });
      results.recommendations.push(
        'Enable a CDN (Cloudflare, CloudFront, etc.) and cache static assets before traffic spikes'
      );
    }
  }

  if (checks.compression) {
    totalChecks++;
    const hasCompression = compressed || Boolean(blackboxAudit?.compressed);
    if (hasCompression) {
      passedCount++;
      results.checks.push({
        name: 'Compression',
        passed: true,
        message: `Compression enabled: ${headersObj['content-encoding'] || 'verified via Blackbox size ratio'}`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'Compression',
        passed: false,
        message: 'No Gzip/Brotli compression detected — responses appear uncompressed',
        severity: 'warning',
      });
      results.recommendations.push(
        'Enable Gzip or Brotli compression to reduce bandwidth load by 60–80% during peak traffic'
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
      alpn === 'h3' ||
      blackboxAudit?.httpVersion === 'HTTP/2' ||
      blackboxAudit?.httpVersion === 'HTTP/3';

    if (isModernProtocol) {
      passedCount++;
      results.checks.push({
        name: 'HTTP Protocol',
        passed: true,
        message: `Modern protocol detected: ${alpn || blackboxAudit?.httpVersion || altSvc}`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'HTTP Protocol',
        passed: false,
        message: tlsInfo?.isHttps
          ? 'Using HTTP/1.1 — upgrade to HTTP/2 or HTTP/3 for multiplexing under concurrent bursts'
          : 'Plain HTTP detected — enable HTTPS with HTTP/2 or HTTP/3',
        severity: 'warning',
      });
      results.recommendations.push(
        'Enable HTTPS with HTTP/2 or HTTP/3 on your server or load balancer to reduce connection overhead'
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
        'Add Cache-Control with stale-while-revalidate so edge servers absorb burst traffic even if origin slows down'
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
            : `Certificate expires in ${tlsInfo.daysUntilExpiry} days — renew before event!`,
        severity: 'critical',
      });
      results.recommendations.push(
        'Renew SSL certificate immediately — expiry during an event causes a total outage'
      );
    }
  }

  // Additional live congestion telemetry check when historical metrics exist
  if (telemetry.sampleCount >= 3 && telemetry.jitterMs !== null && telemetry.baselineTtfbMs) {
    totalChecks++;
    const jitterRatio = telemetry.jitterMs / Math.max(1, telemetry.baselineTtfbMs);
    const highJitter = jitterRatio > 0.6 || (telemetry.ttfbGrowthRatio ?? 1) > 1.8;
    if (!highJitter) {
      passedCount++;
      results.checks.push({
        name: 'TTFB & Latency Stability',
        passed: true,
        message: `Baseline ${telemetry.baselineTtfbMs}ms, Jitter ±${telemetry.jitterMs}ms across ${telemetry.sampleCount} samples`,
        severity: 'info',
      });
    } else {
      results.checks.push({
        name: 'TTFB & Latency Stability',
        passed: false,
        message: `Elevated instability detected: jitter ±${telemetry.jitterMs}ms (${telemetry.ttfbGrowthRatio ?? 1}x baseline TTFB)`,
        severity: 'warning',
      });
      results.recommendations.push(
        'Origin TTFB shows congestion jitter — add Redis API response caching, DB connection pooling, or pre-scale backend instances'
      );
    }
  }

  // Live TTFB latency check — always runs; uses blackbox probe or historical recent value
  const liveTtfb = telemetry.recentTtfbMs ?? (blackboxAudit?.ttfbMs ?? null);
  if (liveTtfb !== null && liveTtfb > 0) {
    totalChecks++;
    if (liveTtfb <= 200) {
      passedCount++;
      results.checks.push({
        name: 'Live Response Time',
        passed: true,
        message: `Current TTFB: ${liveTtfb}ms — excellent response speed`,
        severity: 'info',
      });
    } else if (liveTtfb <= 500) {
      passedCount++;
      results.checks.push({
        name: 'Live Response Time',
        passed: true,
        message: `Current TTFB: ${liveTtfb}ms — acceptable, but watch for degradation under surge`,
        severity: 'info',
      });
    } else if (liveTtfb <= 1000) {
      results.checks.push({
        name: 'Live Response Time',
        passed: false,
        message: `Current TTFB: ${liveTtfb}ms — slow baseline; will worsen significantly under traffic`,
        severity: 'warning',
      });
      results.recommendations.push(
        `Baseline TTFB is ${liveTtfb}ms — optimize server response time (caching, DB query tuning) before the event`
      );
    } else {
      results.checks.push({
        name: 'Live Response Time',
        passed: false,
        message: `Current TTFB: ${liveTtfb}ms — critically slow; likely to 503 under any real traffic surge`,
        severity: 'critical',
      });
      results.recommendations.push(
        `Critical: ${liveTtfb}ms TTFB is too slow for a traffic event — prioritise server-side caching and horizontal scaling immediately`
      );
    }
  }

  results.score = totalChecks > 0 ? Math.round((passedCount / totalChecks) * 100) : 100;

  // Heuristic-mode confidence discount: without historical data we can't be fully certain,
  // so cap the score at 85 to signal "infrastructure looks good but we lack real traffic evidence"
  if (telemetry.sampleCount < 5) {
    results.score = Math.min(results.score, 85);
    results.checks.push({
      name: 'Telemetry Confidence',
      passed: false,
      message: `Only ${telemetry.sampleCount} historical sample${telemetry.sampleCount === 1 ? '' : 's'} — score capped at 85 until more monitoring data is collected`,
      severity: 'info',
    });
  }

  let infraPenalty = 0;
  if (checks.cdn && !results.checks.find((c) => c.name === 'CDN Detection')?.passed) infraPenalty += 0.5;
  if (checks.compression && !results.checks.find((c) => c.name === 'Compression')?.passed) infraPenalty += 0.3;
  if (checks.cacheHeaders && !results.checks.find((c) => c.name === 'Cache Headers')?.passed) infraPenalty += 0.4;
  if (checks.protocol && !results.checks.find((c) => c.name === 'HTTP Protocol')?.passed) infraPenalty += 0.2;
  if (checks.sslExpiry && !results.checks.find((c) => c.name === 'SSL Certificate')?.passed) infraPenalty += 1.0;

  // Combine empirical historical telemetry (TTFB growth, jitter, error rate) with header heuristics
  if (telemetry.sampleCount >= 5 && telemetry.baselineTtfbMs && telemetry.baselineTtfbMs > 0) {
    results.forecastBasis = 'historical-telemetry';
    const growthComponent = Math.max(0, (telemetry.ttfbGrowthRatio ?? 1) - 1) * 1.1;
    const jitterComponent =
      telemetry.jitterMs !== null
        ? Math.min(1.5, telemetry.jitterMs / Math.max(25, telemetry.baselineTtfbMs))
        : 0;
    const errorComponent = telemetry.errorRatePercent * 0.04;

    const multiplier = 1.0 + infraPenalty * 0.75 + growthComponent + jitterComponent + errorComponent;
    results.predictedPeakMultiplier = Number(Math.min(Math.max(multiplier, 1.0), 6.0).toFixed(2));
    results.crashProbability = Math.min(
      95,
      Math.max(
        5,
        Math.round(
          infraPenalty * 14 +
            growthComponent * 22 +
            jitterComponent * 18 +
            telemetry.errorRatePercent * 1.2
        )
      )
    );
  } else {
    results.forecastBasis = 'heuristic';
    const riskFactor = 1.0 + infraPenalty;
    results.predictedPeakMultiplier = Number(Math.min(riskFactor, 5.0).toFixed(2));
    // Minimum 15% crash probability in heuristic mode — without real traffic data we cannot
    // guarantee zero risk, even for a well-configured site.
    results.crashProbability = Math.min(Math.max(Math.round((riskFactor - 1) * 25), 15), 95);
  }

  return results;
}

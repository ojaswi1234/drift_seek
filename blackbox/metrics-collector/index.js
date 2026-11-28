/**
 * Blackbox Metrics Collector & Multi-Phase Prober for DriftSeeker
 */

import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import zlib from 'zlib';
import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';
import promClient from 'prom-client';

function normalizeBaseUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

function normalizeHostPort(raw) {
  // Fix accidental double-colon port typos like "driftseek.duckdns.org::50051"
  return String(raw || '').trim().replace(/::(\d+)$/, ':$1');
}

function sanitizeUrlForLog(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return String(rawUrl || '').replace(/\/\/[^@/]+@/g, '//***:***@');
  }
}

function isSelfBlackboxUrl(blackboxUrl, port) {
  if (!blackboxUrl) return false;
  try {
    const parsed = new URL(blackboxUrl);
    const selfHost = (process.env.RENDER_EXTERNAL_HOSTNAME || '').toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (selfHost && host === selfHost) return true;
    if ((host === 'localhost' || host === '127.0.0.1') && String(parsed.port || '80') === String(port)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
    if (lower.startsWith('::ffff:')) {
      return isPrivateIp(lower.slice(7));
    }
    return false;
  }
  return true;
}

function validateConfig() {
  const required = ['MONGODB_URI'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || '9116', 10);
  const rawBlackboxUrl = normalizeBaseUrl(process.env.BLACKBOX_URL);
  const selfPointing = isSelfBlackboxUrl(rawBlackboxUrl, port);
  const effectiveBlackboxUrl = selfPointing ? '' : rawBlackboxUrl;
  const isProd = process.env.NODE_ENV === 'production';

  if (selfPointing) {
    console.log(
      'ℹ️  BLACKBOX_URL points to this collector service — using built-in multi-phase prober & serving /probe directly'
    );
  } else if (!effectiveBlackboxUrl) {
    console.log('ℹ️  BLACKBOX_URL not set — using built-in multi-phase prober');
  }

  const candidateTargets = [
    { name: 'app', url: (process.env.APP_URL || (!isProd ? 'http://localhost:3000' : '')).trim(), module: 'http_2xx' },
    {
      name: 'terminal-server',
      url: (process.env.TERMINAL_URL || (!isProd ? 'http://localhost:3001/health' : '')).trim(),
      module: 'http_2xx',
    },
    { name: 'grpc-worker', url: normalizeHostPort(process.env.GRPC_URL || (!isProd ? 'localhost:50051' : '')), module: 'grpc' },
    { name: 'mongodb', url: normalizeHostPort(process.env.MONGO_URL || (!isProd ? 'localhost:27017' : '')), module: 'mongodb' },
    { name: 'redis', url: normalizeHostPort(process.env.REDIS_URL || (!isProd ? 'localhost:6379' : '')), module: 'redis' },
  ].filter((t) => Boolean(t.url));

  return {
    BLACKBOX_URL: effectiveBlackboxUrl,
    MONGODB_URI: process.env.MONGODB_URI,
    DB_NAME: process.env.DB_NAME || 'system_seek',
    COLLECTION_NAME: 'blackbox_probes',
    COLLECTION_INTERVAL: parseInt(process.env.COLLECTION_INTERVAL || '60000', 10),
    TARGETS: candidateTargets,
    PORT: port,
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '',
    METRICS_API_TOKEN: process.env.METRICS_API_TOKEN || '',
    MONGO_CONNECT_TIMEOUT: parseInt(process.env.MONGO_CONNECT_TIMEOUT || '10000', 10),
    MONGO_MAX_POOL_SIZE: parseInt(process.env.MONGO_MAX_POOL_SIZE || '10', 10),
    MONGO_RETRY_ATTEMPTS: parseInt(process.env.MONGO_RETRY_ATTEMPTS || '5', 10),
    MONGO_RETRY_DELAY: parseInt(process.env.MONGO_RETRY_DELAY || '5000', 10),
  };
}

const CONFIG = validateConfig();

const register = new promClient.Registry();
const probeSuccessGauge = new promClient.Gauge({
  name: 'blackbox_probe_success',
  help: 'Displays whether or not the probe was a success (1 = up, 0 = down)',
  labelNames: ['target', 'module'],
  registers: [register],
});
const probeDurationGauge = new promClient.Gauge({
  name: 'blackbox_probe_duration_seconds',
  help: 'Returns how long the probe took to complete in seconds',
  labelNames: ['target', 'module'],
  registers: [register],
});
const probeTtfbGauge = new promClient.Gauge({
  name: 'blackbox_probe_ttfb_seconds',
  help: 'HTTP processing duration (Time To First Byte) in seconds',
  labelNames: ['target', 'module'],
  registers: [register],
});
const probeHttpStatusGauge = new promClient.Gauge({
  name: 'blackbox_probe_http_status_code',
  help: 'Response HTTP status code for HTTP probes',
  labelNames: ['target', 'module'],
  registers: [register],
});
const mongoConnectedGauge = new promClient.Gauge({
  name: 'blackbox_collector_mongodb_connected',
  help: 'Whether MongoDB is connected (1 = yes, 0 = no)',
  registers: [register],
});
const blackboxReachableGauge = new promClient.Gauge({
  name: 'blackbox_collector_blackbox_reachable',
  help: 'Whether prober is ready (1 = yes, 0 = no)',
  registers: [register],
});
const lastCollectionGauge = new promClient.Gauge({
  name: 'blackbox_collector_last_collection_timestamp',
  help: 'Unix timestamp (ms) of the last metrics collection',
  registers: [register],
});

let db = null;
let collection = null;
let mongoClient = null;
let isShuttingDown = false;
let isConnecting = false;

const healthStatus = {
  mongo: false,
  blackbox: !CONFIG.BLACKBOX_URL,
  lastCollection: null,
  lastError: null,
};

async function connectMongo(attempt = 1) {
  if (isShuttingDown || isConnecting) return false;
  isConnecting = true;

  try {
    if (mongoClient) {
      await mongoClient.close().catch(() => {});
      mongoClient = null;
    }

    mongoClient = new MongoClient(CONFIG.MONGODB_URI, {
      connectTimeoutMS: CONFIG.MONGO_CONNECT_TIMEOUT,
      maxPoolSize: CONFIG.MONGO_MAX_POOL_SIZE,
      serverSelectionTimeoutMS: CONFIG.MONGO_CONNECT_TIMEOUT,
    });

    await mongoClient.connect();
    db = mongoClient.db(CONFIG.DB_NAME);
    collection = db.collection(CONFIG.COLLECTION_NAME);

    await collection.createIndex({ target: 1, timestamp: -1 });
    await collection.createIndex({ timestamp: -1 });
    await collection.createIndex({ module: 1, timestamp: -1 });

    await db.command({ ping: 1 });

    healthStatus.mongo = true;
    healthStatus.lastError = null;
    mongoConnectedGauge.set(1);
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    healthStatus.mongo = false;
    healthStatus.lastError = error.message;
    mongoConnectedGauge.set(0);
    console.error(
      `❌ MongoDB connection failed (attempt ${attempt}/${CONFIG.MONGO_RETRY_ATTEMPTS}):`,
      error.message
    );

    if (attempt < CONFIG.MONGO_RETRY_ATTEMPTS && !isShuttingDown) {
      isConnecting = false;
      await new Promise((resolve) => setTimeout(resolve, CONFIG.MONGO_RETRY_DELAY));
      return connectMongo(attempt + 1);
    }
    return false;
  } finally {
    isConnecting = false;
  }
}

function parsePrometheusMetrics(text, target) {
  const metrics = {};
  const phases = {
    resolve: 0,
    connect: 0,
    tls: 0,
    processing: 0,
    transfer: 0,
  };
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]Inf)(?:\s+\d+)?$/
    );
    if (match) {
      const [, name, labels = '', rawValue] = match;
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) continue;

      if (name === 'probe_http_duration_seconds') {
        const phaseMatch = labels.match(/phase="([^"]+)"/);
        const phase = phaseMatch?.[1];
        if (phase && phase in phases) {
          phases[phase] = numericValue;
        }
        metrics[`probe_http_duration_seconds_${phase || 'other'}`] = numericValue;
      } else if (!(name in metrics)) {
        metrics[name] = numericValue;
      }
    }
  }

  const success = metrics.probe_success === 1;
  const duration = Number.isFinite(metrics.probe_duration_seconds)
    ? metrics.probe_duration_seconds
    : 0;
  const httpStatus = Number.isFinite(metrics.probe_http_status_code)
    ? metrics.probe_http_status_code
    : 0;

  return {
    target: target.name,
    url: sanitizeUrlForLog(target.url),
    module: target.module,
    timestamp: new Date(),
    success,
    duration_seconds: duration,
    ttfb_seconds: phases.processing,
    phases,
    http_status_code: httpStatus,
    metrics,
    error: success ? null : 'Probe failed',
    source: 'blackbox',
  };
}

function decompressBody(buffer, contentEncoding) {
  return new Promise((resolve) => {
    const enc = String(contentEncoding || '').toLowerCase();
    if (enc.includes('gzip')) {
      zlib.gunzip(buffer, (err, out) => resolve(err ? buffer.length : out.length));
    } else if (enc.includes('br')) {
      zlib.brotliDecompress(buffer, (err, out) => resolve(err ? buffer.length : out.length));
    } else if (enc.includes('deflate')) {
      zlib.inflate(buffer, (err, out) => resolve(err ? buffer.length : out.length));
    } else {
      resolve(buffer.length);
    }
  });
}

function parseTcpHostPort(rawTarget) {
  const cleaned = normalizeHostPort(rawTarget);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned)) {
    const parsed = new URL(cleaned);
    const defaultPort = parsed.protocol.startsWith('redis')
      ? 6379
      : parsed.protocol.startsWith('mongo')
        ? 27017
        : 443;
    return {
      host: parsed.hostname,
      port: Number(parsed.port || defaultPort),
      useTls: parsed.protocol === 'rediss:' || parsed.protocol === 'https:',
    };
  }
  const lastColon = cleaned.lastIndexOf(':');
  if (lastColon === -1) return null;
  const host = cleaned.slice(0, lastColon).replace(/^\[|\]$/g, '');
  const port = parseInt(cleaned.slice(lastColon + 1), 10);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port, useTls: false };
}

async function probeTcpBuiltIn(target, options = {}) {
  const startNs = process.hrtime.bigint();
  const safeTargetUrl = sanitizeUrlForLog(target.url);
  const parsed = parseTcpHostPort(target.url);
  if (!parsed) {
    return {
      target: target.name,
      url: safeTargetUrl,
      module: target.module,
      timestamp: new Date(),
      success: false,
      duration_seconds: 0,
      ttfb_seconds: 0,
      phases: { resolve: 0, connect: 0, tls: 0, processing: 0, transfer: 0 },
      http_status_code: 0,
      metrics: { probe_success: 0 },
      error: `Invalid TCP target: ${safeTargetUrl}`,
      source: 'builtin-tcp',
    };
  }

  let resolvedIp = parsed.host;
  let resolveSec = 0;
  try {
    const t0 = process.hrtime.bigint();
    if (!net.isIP(parsed.host)) {
      const lookup = await dns.lookup(parsed.host);
      resolvedIp = lookup.address;
    }
    resolveSec = Number(process.hrtime.bigint() - t0) / 1e9;
    if (options.blockPrivateIps && isPrivateIp(resolvedIp)) {
      throw new Error('Blocked private or internal IP address');
    }
  } catch (err) {
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
    return {
      target: target.name,
      url: safeTargetUrl,
      module: target.module,
      timestamp: new Date(),
      success: false,
      duration_seconds: durationSec,
      ttfb_seconds: 0,
      phases: { resolve: resolveSec, connect: 0, tls: 0, processing: 0, transfer: 0 },
      http_status_code: 0,
      metrics: { probe_success: 0, probe_duration_seconds: durationSec },
      error: err.message,
      source: 'builtin-tcp',
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const tConnectStart = process.hrtime.bigint();
    const socket = parsed.useTls
      ? tls.connect({ host: resolvedIp, port: parsed.port, servername: parsed.host, timeout: 6000 })
      : net.createConnection({ host: resolvedIp, port: parsed.port, timeout: 6000 });

    const finish = (success, errorMsg = null) => {
      if (settled) return;
      settled = true;
      const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
      socket.destroy();
      resolve({
        target: target.name,
        url: safeTargetUrl,
        module: target.module,
        timestamp: new Date(),
        success,
        duration_seconds: durationSec,
        ttfb_seconds: 0,
        phases: { resolve: resolveSec, connect: durationSec - resolveSec, tls: 0, processing: 0, transfer: 0 },
        http_status_code: 0,
        metrics: { probe_success: success ? 1 : 0, probe_duration_seconds: durationSec },
        error: errorMsg,
        source: 'builtin-tcp',
      });
    };

    socket.once(parsed.useTls ? 'secureConnect' : 'connect', () => {
      const connectSec = Number(process.hrtime.bigint() - tConnectStart) / 1e9;
      if (socket.destroyed) return;
      if (parsed.useTls) {
        const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
        settled = true;
        socket.destroy();
        resolve({
          target: target.name,
          url: safeTargetUrl,
          module: target.module,
          timestamp: new Date(),
          success: true,
          duration_seconds: durationSec,
          ttfb_seconds: 0,
          phases: { resolve: resolveSec, connect: connectSec, tls: 0, processing: 0, transfer: 0 },
          http_status_code: 0,
          metrics: { probe_success: 1, probe_duration_seconds: durationSec },
          error: null,
          source: 'builtin-tcp',
        });
      } else {
        finish(true, null);
      }
    });

    socket.once('timeout', () => finish(false, 'TCP connection timed out'));
    socket.once('error', (err) => finish(false, err.message));
  });
}

async function singleHttpAttempt(targetUrl, options = {}, hopsRemaining = 3) {
  const parsedUrl = new URL(targetUrl);
  const isHttps = parsedUrl.protocol === 'https:';
  const defaultPort = isHttps ? 443 : 80;
  const port = parsedUrl.port ? Number(parsedUrl.port) : defaultPort;

  const tStart = process.hrtime.bigint();
  let tLookupDone = tStart;
  let tConnectDone = tStart;
  let tTlsDone = tStart;
  let tFirstByte = tStart;
  let resolvedIp = parsedUrl.hostname;

  if (!net.isIP(parsedUrl.hostname)) {
    const lookup = await dns.lookup(parsedUrl.hostname);
    resolvedIp = lookup.address;
  }
  tLookupDone = process.hrtime.bigint();

  if (options.blockPrivateIps && isPrivateIp(resolvedIp)) {
    throw new Error('Blocked private or internal IP address');
  }

  return new Promise((resolve, reject) => {
    const transport = isHttps ? https : http;
    let sslExpiryEpoch = null;
    let settled = false;

    const req = transport.request(
      {
        host: resolvedIp,
        port,
        path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
        method: 'GET',
        servername: isHttps ? parsedUrl.hostname : undefined,
        timeout: 12000,
        headers: {
          Host: parsedUrl.host,
          'Accept-Encoding': 'gzip, br, deflate',
          'User-Agent': 'DriftSeeker-Blackbox/1.0',
        },
      },
      (res) => {
        tFirstByte = process.hrtime.bigint();

        if (
          hopsRemaining > 0 &&
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
            return reject(new Error('Unsupported redirect protocol'));
          }
          settled = true;
          return resolve(singleHttpAttempt(nextUrl, options, hopsRemaining - 1));
        }

        const chunks = [];
        let rawBytes = 0;
        res.on('data', (chunk) => {
          rawBytes += chunk.length;
          if (rawBytes <= 2 * 1024 * 1024) {
            chunks.push(chunk);
          }
        });

        res.on('end', async () => {
          if (settled) return;
          settled = true;
          const tEnd = process.hrtime.bigint();
          const buf = Buffer.concat(chunks);
          const encoding = res.headers['content-encoding'] || '';
          const uncompressedLen = await decompressBody(buf, encoding);
          const contentLenHeader = Number(res.headers['content-length']);
          const contentLength = Number.isFinite(contentLenHeader) && contentLenHeader > 0 ? contentLenHeader : rawBytes;

          const resolveSec = Number(tLookupDone - tStart) / 1e9;
          const connectSec = Math.max(0, Number(tConnectDone - tLookupDone) / 1e9);
          const tlsSec = isHttps ? Math.max(0, Number(tTlsDone - tConnectDone) / 1e9) : 0;
          const preTransferDone = isHttps ? tTlsDone : tConnectDone;
          const processingSec = Math.max(0, Number(tFirstByte - preTransferDone) / 1e9);
          const transferSec = Math.max(0, Number(tEnd - tFirstByte) / 1e9);
          const totalSec = Number(tEnd - tStart) / 1e9;

          const statusCode = res.statusCode || 0;
          const success = statusCode >= 200 && statusCode < 400;
          const httpVer = res.httpVersionMajor >= 2 ? Number(res.httpVersionMajor) : 1.1;

          resolve({
            success,
            duration_seconds: totalSec,
            ttfb_seconds: processingSec,
            phases: {
              resolve: resolveSec,
              connect: connectSec,
              tls: tlsSec,
              processing: processingSec,
              transfer: transferSec,
            },
            http_status_code: statusCode,
            http_version: httpVer,
            ssl: isHttps,
            ssl_expiry_epoch: sslExpiryEpoch,
            content_length: contentLength,
            uncompressed_body_length: uncompressedLen,
            error: success ? null : `HTTP ${statusCode}`,
          });
        });
      }
    );

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        tConnectDone = process.hrtime.bigint();
      });
      socket.on('secureConnect', () => {
        tTlsDone = process.hrtime.bigint();
        try {
          const cert = socket.getPeerCertificate();
          if (cert && cert.valid_to) {
            const epoch = Math.floor(new Date(cert.valid_to).getTime() / 1000);
            if (Number.isFinite(epoch)) sslExpiryEpoch = epoch;
          }
        } catch {
          // ignore cert inspection error
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('HTTP probe timed out'));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.end();
  });
}

async function probeTargetBuiltIn(target, options = {}) {
  const url = String(target.url || '').trim();
  const isHttp = url.startsWith('http://') || url.startsWith('https://');
  if (!isHttp) {
    return probeTcpBuiltIn(target, options);
  }

  const safeUrl = sanitizeUrlForLog(url);
  try {
    const r = await singleHttpAttempt(url, options, 3);
    const metrics = {
      probe_success: r.success ? 1 : 0,
      probe_duration_seconds: r.duration_seconds,
      probe_http_status_code: r.http_status_code,
      probe_http_version: r.http_version,
      probe_http_ssl: r.ssl ? 1 : 0,
      probe_http_content_length: r.content_length,
      probe_http_uncompressed_body_length: r.uncompressed_body_length,
      probe_http_duration_seconds_resolve: r.phases.resolve,
      probe_http_duration_seconds_connect: r.phases.connect,
      probe_http_duration_seconds_tls: r.phases.tls,
      probe_http_duration_seconds_processing: r.phases.processing,
      probe_http_duration_seconds_transfer: r.phases.transfer,
    };
    if (r.ssl_expiry_epoch !== null) {
      metrics.probe_ssl_earliest_cert_expiry = r.ssl_expiry_epoch;
    }

    return {
      target: target.name,
      url: safeUrl,
      module: target.module,
      timestamp: new Date(),
      success: r.success,
      duration_seconds: r.duration_seconds,
      ttfb_seconds: r.ttfb_seconds,
      phases: r.phases,
      http_status_code: r.http_status_code,
      http_version: r.http_version,
      ssl: r.ssl,
      ssl_expiry_epoch: r.ssl_expiry_epoch,
      content_length: r.content_length,
      uncompressed_body_length: r.uncompressed_body_length,
      metrics,
      error: r.error,
      source: 'builtin-http',
    };
  } catch (err) {
    console.error(`❌ Probe failed for ${target.name} (${safeUrl}):`, err.message);
    return {
      target: target.name,
      url: safeUrl,
      module: target.module,
      timestamp: new Date(),
      success: false,
      duration_seconds: 0,
      ttfb_seconds: 0,
      phases: { resolve: 0, connect: 0, tls: 0, processing: 0, transfer: 0 },
      http_status_code: 0,
      http_version: 0,
      ssl: url.startsWith('https://'),
      ssl_expiry_epoch: null,
      content_length: 0,
      uncompressed_body_length: 0,
      metrics: { probe_success: 0 },
      error: err.message,
      source: 'builtin-http',
    };
  }
}

function formatBlackboxExposition(result) {
  const p = result.phases || {};
  const lines = [
    '# HELP probe_success Displays whether or not the probe was a success',
    '# TYPE probe_success gauge',
    `probe_success ${result.success ? 1 : 0}`,
    '# HELP probe_duration_seconds Returns how long the probe took to complete in seconds',
    '# TYPE probe_duration_seconds gauge',
    `probe_duration_seconds ${Number(result.duration_seconds || 0).toFixed(6)}`,
    '# HELP probe_http_duration_seconds Duration of http request by phase, summed over all redirects',
    '# TYPE probe_http_duration_seconds gauge',
    `probe_http_duration_seconds{phase="resolve"} ${Number(p.resolve || 0).toFixed(6)}`,
    `probe_http_duration_seconds{phase="connect"} ${Number(p.connect || 0).toFixed(6)}`,
    `probe_http_duration_seconds{phase="tls"} ${Number(p.tls || 0).toFixed(6)}`,
    `probe_http_duration_seconds{phase="processing"} ${Number(p.processing || 0).toFixed(6)}`,
    `probe_http_duration_seconds{phase="transfer"} ${Number(p.transfer || 0).toFixed(6)}`,
    '# HELP probe_http_status_code Response HTTP status code',
    '# TYPE probe_http_status_code gauge',
    `probe_http_status_code ${result.http_status_code || 0}`,
    '# HELP probe_http_version Returns the version of HTTP of the probe response',
    '# TYPE probe_http_version gauge',
    `probe_http_version ${result.http_version || 1.1}`,
    '# HELP probe_http_ssl Indicates if SSL was used for the final redirect',
    '# TYPE probe_http_ssl gauge',
    `probe_http_ssl ${result.ssl ? 1 : 0}`,
    '# HELP probe_http_content_length Length of http content response',
    '# TYPE probe_http_content_length gauge',
    `probe_http_content_length ${result.content_length || 0}`,
    '# HELP probe_http_uncompressed_body_length Length of uncompressed response body',
    '# TYPE probe_http_uncompressed_body_length gauge',
    `probe_http_uncompressed_body_length ${result.uncompressed_body_length || 0}`,
  ];
  if (typeof result.ssl_expiry_epoch === 'number') {
    lines.push(
      '# HELP probe_ssl_earliest_cert_expiry Returns last SSL chain expiry in unixtime',
      '# TYPE probe_ssl_earliest_cert_expiry gauge',
      `probe_ssl_earliest_cert_expiry ${result.ssl_expiry_epoch}`
    );
  }
  return lines.join('\n') + '\n';
}

async function probeTarget(target) {
  if (CONFIG.BLACKBOX_URL) {
    const probeUrl = `${CONFIG.BLACKBOX_URL}/probe?target=${encodeURIComponent(
      target.url
    )}&module=${encodeURIComponent(target.module)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(probeUrl, {
        headers: { Accept: 'text/plain' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const text = await response.text();
        return parsePrometheusMetrics(text, target);
      }

      console.warn(
        `⚠️  External Blackbox returned ${response.status} for ${target.name} — falling back to built-in prober`
      );
    } catch (error) {
      console.warn(
        `⚠️  External Blackbox unreachable for ${target.name} (${error.message}) — falling back to built-in prober`
      );
    }
  }

  return probeTargetBuiltIn(target);
}

async function resolveDynamicTargets() {
  const targets = [...CONFIG.TARGETS];
  const seenUrls = new Set(targets.map((t) => t.url));

  if (db && healthStatus.mongo) {
    try {
      const webservers = await db
        .collection('webservers')
        .find({}, { projection: { _id: 1, name: 1, url: 1 } })
        .limit(200)
        .toArray();

      for (const ws of webservers) {
        if (!ws?.url || seenUrls.has(ws.url)) continue;
        seenUrls.add(ws.url);
        targets.push({
          name: ws.name || `monitor_${ws._id}`,
          url: ws.url,
          module: 'http_surge_probe',
        });
      }
    } catch (err) {
      console.warn('⚠️ Could not load dynamic webservers from MongoDB:', err.message);
    }
  }

  return targets;
}

async function collectMetrics() {
  if (isShuttingDown) return [];

  if (!collection || !healthStatus.mongo) {
    await connectMongo(1);
  }

  const allTargets = await resolveDynamicTargets();
  console.log(`🔍 Starting metrics collection for ${allTargets.length} targets...`);

  const results = await Promise.all(allTargets.map((target) => probeTarget(target)));

  for (const r of results) {
    probeSuccessGauge.set({ target: r.target, module: r.module }, r.success ? 1 : 0);
    probeDurationGauge.set(
      { target: r.target, module: r.module },
      Number.isFinite(r.duration_seconds) ? r.duration_seconds : 0
    );
    probeTtfbGauge.set(
      { target: r.target, module: r.module },
      Number.isFinite(r.ttfb_seconds) ? r.ttfb_seconds : 0
    );
    if (r.http_status_code > 0) {
      probeHttpStatusGauge.set({ target: r.target, module: r.module }, r.http_status_code);
    }
  }

  if (collection && healthStatus.mongo) {
    try {
      if (results.length > 0) {
        await collection.insertMany(results);
      }
      console.log(`💾 Stored ${results.length} probe results in MongoDB`);
    } catch (error) {
      console.error('❌ Failed to store metrics:', error.message);
      healthStatus.mongo = false;
      healthStatus.lastError = error.message;
      mongoConnectedGauge.set(0);
      await connectMongo(1);
    }
  } else {
    console.warn('⚠️ MongoDB not connected, skipping metric storage');
  }

  const now = new Date();
  healthStatus.lastCollection = now;
  lastCollectionGauge.set(now.getTime());

  return results;
}

async function checkBlackboxHealth() {
  if (!CONFIG.BLACKBOX_URL) {
    healthStatus.blackbox = true;
    blackboxReachableGauge.set(1);
    return true;
  }

  for (const suffix of ['/-/healthy', '/health']) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${CONFIG.BLACKBOX_URL}${suffix}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        healthStatus.blackbox = true;
        blackboxReachableGauge.set(1);
        return true;
      }
    } catch {
      // try next path
    }
  }

  // Built-in prober remains available even if external Blackbox is unreachable
  healthStatus.blackbox = false;
  blackboxReachableGauge.set(0);
  return false;
}

async function checkMongoHealth() {
  if (!db || !mongoClient) return false;
  try {
    await db.command({ ping: 1 });
    healthStatus.mongo = true;
    mongoConnectedGauge.set(1);
    return true;
  } catch {
    healthStatus.mongo = false;
    mongoConnectedGauge.set(0);
    return false;
  }
}

function clampInt(raw, defaultVal, min, max) {
  const num = parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(num)) return defaultVal;
  return Math.min(max, Math.max(min, num));
}

async function startApiServer() {
  const url = await import('url');

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '/', true);

    if (CONFIG.ALLOWED_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', CONFIG.ALLOWED_ORIGIN);
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (
      CONFIG.METRICS_API_TOKEN &&
      parsedUrl.pathname !== '/health' &&
      req.headers.authorization !== `Bearer ${CONFIG.METRICS_API_TOKEN}`
    ) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      if (parsedUrl.pathname === '/health') {
        const [mongoOk, externalBlackboxOk] = await Promise.all([
          checkMongoHealth(),
          checkBlackboxHealth(),
        ]);

        const proberMode = CONFIG.BLACKBOX_URL
          ? externalBlackboxOk
            ? 'external-reachable'
            : 'builtin-fallback'
          : 'builtin-prober';

        const status = mongoOk ? 'ok' : 'degraded';
        const statusCode = mongoOk ? 200 : 503;

        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status,
            timestamp: new Date().toISOString(),
            checks: {
              mongodb: mongoOk ? 'connected' : 'disconnected',
              blackbox: proberMode,
              lastCollection: healthStatus.lastCollection,
            },
          })
        );
        return;
      }

      if (parsedUrl.pathname === '/probe') {
        const rawTarget = typeof parsedUrl.query.target === 'string' ? parsedUrl.query.target.trim() : '';
        const moduleName =
          typeof parsedUrl.query.module === 'string' && parsedUrl.query.module.trim()
            ? parsedUrl.query.module.trim()
            : 'http_surge_probe';

        if (!rawTarget || (!rawTarget.startsWith('http://') && !rawTarget.startsWith('https://'))) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('# Missing or invalid http/https target parameter\nprobe_success 0\n');
          return;
        }

        const result = await probeTargetBuiltIn(
          { name: rawTarget, url: rawTarget, module: moduleName },
          { blockPrivateIps: true }
        );
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(formatBlackboxExposition(result));
        return;
      }

      if (parsedUrl.pathname === '/metrics') {
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(await register.metrics());
        return;
      }

      if (!healthStatus.mongo || !collection) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Service unavailable - MongoDB not connected',
            retryAfter: 30,
          })
        );
        return;
      }

      if (parsedUrl.pathname === '/api/metrics/latest') {
        const limit = clampInt(parsedUrl.query.limit, 100, 1, 1000);
        const rawTarget = parsedUrl.query.target;
        const target = typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : null;

        const query = target ? { target } : {};
        const docs = await collection.find(query).sort({ timestamp: -1 }).limit(limit).toArray();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(docs));
        return;
      }

      if (parsedUrl.pathname === '/api/metrics/summary') {
        const hours = clampInt(parsedUrl.query.hours, 24, 1, 720);
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const pipeline = [
          { $match: { timestamp: { $gte: since } } },
          {
            $group: {
              _id: '$target',
              total: { $sum: 1 },
              successful: { $sum: { $cond: ['$success', 1, 0] } },
              failed: { $sum: { $cond: ['$success', 0, 1] } },
              avgDuration: { $avg: '$duration_seconds' },
              lastCheck: { $max: '$timestamp' },
            },
          },
        ];

        const summary = await collection.aggregate(pipeline).toArray();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(summary));
        return;
      }

      if (parsedUrl.pathname === '/api/metrics/history') {
        const rawTarget = parsedUrl.query.target;
        const target = typeof rawTarget === 'string' ? rawTarget.trim() : '';
        const hours = clampInt(parsedUrl.query.hours, 24, 1, 720);
        const limit = clampInt(parsedUrl.query.limit, 1000, 1, 5000);
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        if (!target) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'target parameter required' }));
          return;
        }

        const docs = await collection
          .find({ target, timestamp: { $gte: since } })
          .sort({ timestamp: 1 })
          .limit(limit)
          .toArray();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(docs));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error('API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  server.listen(CONFIG.PORT, () => {
    console.log(`🌐 API server running on port ${CONFIG.PORT}`);
  });

  return server;
}

async function main() {
  const connected = await connectMongo();
  if (!connected) {
    console.error('❌ Cannot continue without MongoDB after retries');
    process.exit(1);
  }

  const server = await startApiServer();
  await collectMetrics();

  const intervalId = setInterval(collectMetrics, CONFIG.COLLECTION_INTERVAL);

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    clearInterval(intervalId);
    await new Promise((resolve) => server.close(resolve));
    if (mongoClient) {
      await mongoClient.close();
    }
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught exception:', error);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled rejection:', reason);
  });
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

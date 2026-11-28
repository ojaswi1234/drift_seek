/**
 * Blackbox Metrics Collector for DriftSeeker
 */

import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';
import promClient from 'prom-client';

function validateConfig() {
  const required = ['MONGODB_URI', 'BLACKBOX_URL'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  return {
    BLACKBOX_URL: process.env.BLACKBOX_URL,
    MONGODB_URI: process.env.MONGODB_URI,
    DB_NAME: process.env.DB_NAME || 'system_seek',
    COLLECTION_NAME: 'blackbox_probes',
    COLLECTION_INTERVAL: parseInt(process.env.COLLECTION_INTERVAL || '60000', 10),
    TARGETS: [
      { name: 'app', url: process.env.APP_URL || 'http://localhost:3000', module: 'http_2xx' },
      {
        name: 'terminal-server',
        url: process.env.TERMINAL_URL || 'http://localhost:3001/health',
        module: 'http_2xx',
      },
      { name: 'grpc-worker', url: process.env.GRPC_URL || 'localhost:50051', module: 'grpc' },
      { name: 'mongodb', url: process.env.MONGO_URL || 'localhost:27017', module: 'mongodb' },
      { name: 'redis', url: process.env.REDIS_URL || 'localhost:6379', module: 'redis' },
    ].filter((t) => t.url),
    PORT: parseInt(process.env.PORT || '9116', 10),
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
  help: 'Whether Blackbox Exporter is reachable (1 = yes, 0 = no)',
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
  blackbox: false,
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

async function probeTarget(target) {
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

    if (!response.ok) {
      throw new Error(`Blackbox returned ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    return parsePrometheusMetrics(text, target);
  } catch (error) {
    console.error(`❌ Probe failed for ${target.name} (${target.url}):`, error.message);
    return {
      target: target.name,
      url: target.url,
      module: target.module,
      timestamp: new Date(),
      success: false,
      duration_seconds: 0,
      http_status_code: 0,
      error: error.message,
      metrics: {},
    };
  }
}

function parsePrometheusMetrics(text, target) {
  const metrics = {};
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]Inf)(?:\s+\d+)?$/
    );
    if (match) {
      const [, name, , rawValue] = match;
      const numericValue = Number(rawValue);
      if (Number.isFinite(numericValue) && !(name in metrics)) {
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
    url: target.url,
    module: target.module,
    timestamp: new Date(),
    success,
    duration_seconds: duration,
    http_status_code: httpStatus,
    metrics,
    error: success ? null : 'Probe failed',
  };
}

async function collectMetrics() {
  if (isShuttingDown) return [];

  console.log(`🔍 Starting metrics collection for ${CONFIG.TARGETS.length} targets...`);

  const results = await Promise.all(CONFIG.TARGETS.map((target) => probeTarget(target)));

  for (const r of results) {
    probeSuccessGauge.set({ target: r.target, module: r.module }, r.success ? 1 : 0);
    probeDurationGauge.set(
      { target: r.target, module: r.module },
      Number.isFinite(r.duration_seconds) ? r.duration_seconds : 0
    );
    if (r.http_status_code > 0) {
      probeHttpStatusGauge.set({ target: r.target, module: r.module }, r.http_status_code);
    }
  }

  if (!collection || !healthStatus.mongo) {
    await connectMongo(1);
  }

  if (collection && healthStatus.mongo) {
    try {
      await collection.insertMany(results);
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
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${CONFIG.BLACKBOX_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    healthStatus.blackbox = response.ok;
    blackboxReachableGauge.set(response.ok ? 1 : 0);
    return response.ok;
  } catch {
    healthStatus.blackbox = false;
    blackboxReachableGauge.set(0);
    return false;
  }
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
  const http = await import('http');
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
        const [mongoOk, blackboxOk] = await Promise.all([
          checkMongoHealth(),
          checkBlackboxHealth(),
        ]);

        const status = mongoOk && blackboxOk ? 'ok' : 'degraded';
        const statusCode = mongoOk && blackboxOk ? 200 : 503;

        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status,
            timestamp: new Date().toISOString(),
            checks: {
              mongodb: mongoOk ? 'connected' : 'disconnected',
              blackbox: blackboxOk ? 'reachable' : 'unreachable',
              lastCollection: healthStatus.lastCollection,
            },
          })
        );
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

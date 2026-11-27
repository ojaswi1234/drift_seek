/**
 * Blackbox Metrics Collector for DriftSeeker
 * 
 * This service:
 * 1. Periodically scrapes metrics from Blackbox Exporter
 * 2. Stores probe results in MongoDB for historical analysis
 * 3. Provides a REST API for querying stored metrics
 * 4. Integrates with Grafana Cloud Prometheus for alerting
 */

import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

// Configuration with validation
function validateConfig() {
  const required = ['MONGODB_URI', 'BLACKBOX_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('   Please set:', missing.map(m => `${m}=<value>`).join(' '));
    process.exit(1);
  }
  
  return {
    // Blackbox Exporter
    BLACKBOX_URL: process.env.BLACKBOX_URL,
    
    // MongoDB
    MONGODB_URI: process.env.MONGODB_URI,
    DB_NAME: process.env.DB_NAME || 'system_seek',
    COLLECTION_NAME: 'blackbox_probes',
    
    // Collection interval (ms)
    COLLECTION_INTERVAL: parseInt(process.env.COLLECTION_INTERVAL || '60000'), // 1 minute
    
    // Targets to probe (can be overridden via env)
    TARGETS: [
      { name: 'app', url: process.env.APP_URL || 'http://localhost:3000', module: 'http_2xx' },
      { name: 'terminal-server', url: process.env.TERMINAL_URL || 'http://localhost:3001', module: 'http_2xx' },
      { name: 'grpc-worker', url: process.env.GRPC_URL || 'localhost:50051', module: 'grpc_health' },
      { name: 'mongodb', url: process.env.MONGO_URL || 'localhost:27017', module: 'mongodb' },
      { name: 'redis', url: process.env.REDIS_URL || 'localhost:6379', module: 'redis' },
    ].filter(t => t.url),
    
    // Server
    PORT: parseInt(process.env.PORT || '9116'),
    
    // MongoDB connection options
    MONGO_CONNECT_TIMEOUT: parseInt(process.env.MONGO_CONNECT_TIMEOUT || '10000'),
    MONGO_MAX_POOL_SIZE: parseInt(process.env.MONGO_MAX_POOL_SIZE || '10'),
    MONGO_RETRY_ATTEMPTS: parseInt(process.env.MONGO_RETRY_ATTEMPTS || '5'),
    MONGO_RETRY_DELAY: parseInt(process.env.MONGO_RETRY_DELAY || '5000'),
  };
}

const CONFIG = validateConfig();

// MongoDB connection state
let db = null;
let collection = null;
let mongoClient = null;
let isShuttingDown = false;

// Health status
let healthStatus = {
  mongo: false,
  blackbox: false,
  lastCollection: null,
  lastError: null
};

// Connect to MongoDB with retry logic
async function connectMongo(attempt = 1) {
  if (isShuttingDown) return false;
  
  try {
    mongoClient = new MongoClient(CONFIG.MONGODB_URI, {
      connectTimeoutMS: CONFIG.MONGO_CONNECT_TIMEOUT,
      maxPoolSize: CONFIG.MONGO_MAX_POOL_SIZE,
      serverSelectionTimeoutMS: CONFIG.MONGO_CONNECT_TIMEOUT,
    });
    
    await mongoClient.connect();
    db = mongoClient.db(CONFIG.DB_NAME);
    collection = db.collection(CONFIG.COLLECTION_NAME);
    
    // Create indexes for efficient querying
    await collection.createIndex({ target: 1, timestamp: -1 });
    await collection.createIndex({ timestamp: -1 });
    await collection.createIndex({ module: 1, timestamp: -1 });
    
    // Verify connection with a ping
    await db.command({ ping: 1 });
    
    healthStatus.mongo = true;
    healthStatus.lastError = null;
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    healthStatus.mongo = false;
    healthStatus.lastError = error.message;
    console.error(`❌ MongoDB connection failed (attempt ${attempt}/${CONFIG.MONGO_RETRY_ATTEMPTS}):`, error.message);
    
    if (attempt < CONFIG.MONGO_RETRY_ATTEMPTS && !isShuttingDown) {
      console.log(`⏳ Retrying in ${CONFIG.MONGO_RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.MONGO_RETRY_DELAY));
      return connectMongo(attempt + 1);
    }
    
    return false;
  }
}

// Probe a single target using Blackbox Exporter
async function probeTarget(target) {
  const probeUrl = `${CONFIG.BLACKBOX_URL}/probe?target=${encodeURIComponent(target.url)}&module=${target.module}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    const response = await fetch(probeUrl, {
      headers: { 'Accept': 'text/plain' },
      signal: controller.signal
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
      error: error.message,
      metrics: {}
    };
  }
}

// Parse Prometheus text format metrics
function parsePrometheusMetrics(text, target) {
  const metrics = {};
  const lines = text.split('\n');
  
  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || !line.trim()) continue;
    
    // Parse metric line: metric_name{labels} value
    const match = line.match(/^(\w+)(?:\{([^}]*)\})?\s+([\d.+-eE]+)$/);
    if (match) {
      const [, name, labels, value] = match;
      metrics[name] = parseFloat(value);
    }
  }
  
  // Extract key metrics
  const success = metrics.probe_success === 1;
  const duration = metrics.probe_duration_seconds || 0;
  const httpStatus = metrics.probe_http_status_code || 0;
  
  return {
    target: target.name,
    url: target.url,
    module: target.module,
    timestamp: new Date(),
    success,
    duration_seconds: duration,
    http_status_code: httpStatus,
    metrics,
    error: success ? null : 'Probe failed'
  };
}

// Collect metrics from all targets
async function collectMetrics() {
  if (isShuttingDown) return [];
  
  console.log(`🔍 Starting metrics collection for ${CONFIG.TARGETS.length} targets...`);
  
  const results = await Promise.all(
    CONFIG.TARGETS.map(target => probeTarget(target))
  );
  
  // Store in MongoDB if connected
  if (collection && healthStatus.mongo) {
    try {
      await collection.insertMany(results);
      console.log(`💾 Stored ${results.length} probe results in MongoDB`);
    } catch (error) {
      console.error('❌ Failed to store metrics:', error.message);
      healthStatus.mongo = false;
      healthStatus.lastError = error.message;
      
      // Try to reconnect
      if (!isShuttingDown) {
        console.log('🔄 Attempting to reconnect to MongoDB...');
        await connectMongo();
      }
    }
  } else {
    console.warn('⚠️ MongoDB not connected, skipping metric storage');
  }
  
  // Log summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`📊 Collection complete: ${successful} success, ${failed} failed`);
  
  healthStatus.lastCollection = new Date();
  
  return results;
}

// Check Blackbox Exporter health
async function checkBlackboxHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${CONFIG.BLACKBOX_URL}/health`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    healthStatus.blackbox = response.ok;
    return response.ok;
  } catch (error) {
    healthStatus.blackbox = false;
    return false;
  }
}

// REST API for querying stored metrics
async function startApiServer() {
  const http = await import('http');
  const url = await import('url');
  
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    try {
      // Health check endpoint - verifies both MongoDB and Blackbox
      if (parsedUrl.pathname === '/health') {
        const mongoOk = healthStatus.mongo && mongoClient && mongoClient.topology?.isConnected();
        const blackboxOk = await checkBlackboxHealth();
        
        const status = mongoOk && blackboxOk ? 'ok' : 'degraded';
        const statusCode = mongoOk && blackboxOk ? 200 : 503;
        
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status,
          timestamp: new Date().toISOString(),
          checks: {
            mongodb: mongoOk ? 'connected' : 'disconnected',
            blackbox: blackboxOk ? 'reachable' : 'unreachable',
            lastCollection: healthStatus.lastCollection,
            lastError: healthStatus.lastError
          }
        }));
        return;
      }
      
      // Only serve metrics endpoints if MongoDB is connected
      if (!healthStatus.mongo && parsedUrl.pathname !== '/metrics') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Service unavailable - MongoDB not connected',
          retryAfter: 30
        }));
        return;
      }
      
      if (parsedUrl.pathname === '/api/metrics/latest') {
        const limit = parseInt(parsedUrl.query.limit) || 100;
        const target = parsedUrl.query.target;
        
        const query = target ? { target } : {};
        const docs = await collection
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(docs));
        return;
      }
      
      if (parsedUrl.pathname === '/api/metrics/summary') {
        const hours = parseInt(parsedUrl.query.hours) || 24;
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
              lastCheck: { $max: '$timestamp' }
            }
          }
        ];
        
        const summary = await collection.aggregate(pipeline).toArray();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(summary));
        return;
      }
      
      if (parsedUrl.pathname === '/api/metrics/history') {
        const target = parsedUrl.query.target;
        const hours = parseInt(parsedUrl.query.hours) || 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        if (!target) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'target parameter required' }));
          return;
        }
        
        const docs = await collection
          .find({ target, timestamp: { $gte: since } })
          .sort({ timestamp: 1 })
          .toArray();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(docs));
        return;
      }
      
      // Prometheus metrics endpoint for Grafana Cloud scraping
      if (parsedUrl.pathname === '/metrics') {
        // This endpoint works even without MongoDB - returns last known state
        let output = '';
        
        if (healthStatus.mongo && collection) {
          const docs = await collection
            .find({})
            .sort({ timestamp: -1 })
            .limit(1000)
            .toArray();
          
          for (const doc of docs) {
            const labels = `target="${doc.target}",module="${doc.module}"`;
            output += `blackbox_probe_success{${labels}} ${doc.success ? 1 : 0}\n`;
            output += `blackbox_probe_duration_seconds{${labels}} ${doc.duration_seconds}\n`;
            if (doc.http_status_code) {
              output += `blackbox_probe_http_status_code{${labels}} ${doc.http_status_code}\n`;
            }
          }
        }
        
        // Add collector health metrics
        output += `blackbox_collector_mongodb_connected ${healthStatus.mongo ? 1 : 0}\n`;
        output += `blackbox_collector_blackbox_reachable ${healthStatus.blackbox ? 1 : 0}\n`;
        output += `blackbox_collector_last_collection_timestamp ${healthStatus.lastCollection ? new Date(healthStatus.lastCollection).getTime() : 0}\n`;
        
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(output);
        return;
      }
      
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error('API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  
  server.listen(CONFIG.PORT, () => {
    console.log(`🌐 API server running on port ${CONFIG.PORT}`);
    console.log(`   Health: http://localhost:${CONFIG.PORT}/health`);
    console.log(`   Latest metrics: http://localhost:${CONFIG.PORT}/api/metrics/latest`);
    console.log(`   Summary: http://localhost:${CONFIG.PORT}/api/metrics/summary`);
    console.log(`   Prometheus metrics: http://localhost:${CONFIG.PORT}/metrics`);
  });
  
  return server;
}

// Main function
async function main() {
  console.log('🚀 Starting Blackbox Metrics Collector');
  console.log('=====================================');
  console.log(`Blackbox URL: ${CONFIG.BLACKBOX_URL}`);
  console.log(`MongoDB: ${CONFIG.MONGODB_URI}/${CONFIG.DB_NAME}`);
  console.log(`Collection interval: ${CONFIG.COLLECTION_INTERVAL}ms`);
  console.log(`Targets: ${CONFIG.TARGETS.map(t => t.name).join(', ')}`);
  console.log('');
  
  // Connect to MongoDB with retries
  const connected = await connectMongo();
  if (!connected) {
    console.error('❌ Cannot continue without MongoDB after retries');
    console.error('   Check MONGODB_URI and network connectivity');
    process.exit(1);
  }
  
  // Start API server
  const server = await startApiServer();
  
  // Initial collection
  await collectMetrics();
  
  // Schedule periodic collection
  const intervalId = setInterval(collectMetrics, CONFIG.COLLECTION_INTERVAL);
  console.log(`⏰ Scheduled collection every ${CONFIG.COLLECTION_INTERVAL}ms`);
  
  // Graceful shutdown
  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    
    clearInterval(intervalId);
    
    // Close HTTP server
    await new Promise(resolve => server.close(resolve));
    console.log('✅ HTTP server closed');
    
    // Close MongoDB connection
    if (mongoClient) {
      await mongoClient.close();
      console.log('✅ MongoDB connection closed');
    }
    
    console.log('✅ Shutdown complete');
    process.exit(0);
  }
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught exception:', error);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });
  
  process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled rejection:', reason);
  });
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
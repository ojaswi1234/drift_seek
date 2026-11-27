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

// Configuration
const CONFIG = {
  // Blackbox Exporter
  BLACKBOX_URL: process.env.BLACKBOX_URL || 'http://localhost:9115',
  
  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017',
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
};

// MongoDB connection
let db = null;
let collection = null;

async function connectMongo() {
  try {
    const client = new MongoClient(CONFIG.MONGODB_URI);
    await client.connect();
    db = client.db(CONFIG.DB_NAME);
    collection = db.collection(CONFIG.COLLECTION_NAME);
    
    // Create indexes for efficient querying
    await collection.createIndex({ target: 1, timestamp: -1 });
    await collection.createIndex({ timestamp: -1 });
    await collection.createIndex({ module: 1, timestamp: -1 });
    
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    return false;
  }
}

// Probe a single target using Blackbox Exporter
async function probeTarget(target) {
  const probeUrl = `${CONFIG.BLACKBOX_URL}/probe?target=${encodeURIComponent(target.url)}&module=${target.module}`;
  
  try {
    const response = await fetch(probeUrl, {
      headers: { 'Accept': 'text/plain' }
    });
    
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
  console.log(`🔍 Starting metrics collection for ${CONFIG.TARGETS.length} targets...`);
  
  const results = await Promise.all(
    CONFIG.TARGETS.map(target => probeTarget(target))
  );
  
  // Store in MongoDB
  if (collection) {
    try {
      await collection.insertMany(results);
      console.log(`💾 Stored ${results.length} probe results in MongoDB`);
    } catch (error) {
      console.error('❌ Failed to store metrics:', error.message);
    }
  }
  
  // Log summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`📊 Collection complete: ${successful} success, ${failed} failed`);
  
  return results;
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
      if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
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
        const docs = await collection
          .find({})
          .sort({ timestamp: -1 })
          .limit(1000)
          .toArray();
        
        let output = '';
        for (const doc of docs) {
          const labels = `target="${doc.target}",module="${doc.module}"`;
          output += `blackbox_probe_success{${labels}} ${doc.success ? 1 : 0}\n`;
          output += `blackbox_probe_duration_seconds{${labels}} ${doc.duration_seconds}\n`;
          if (doc.http_status_code) {
            output += `blackbox_probe_http_status_code{${labels}} ${doc.http_status_code}\n`;
          }
        }
        
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
  
  // Connect to MongoDB
  const connected = await connectMongo();
  if (!connected) {
    console.error('❌ Cannot continue without MongoDB');
    process.exit(1);
  }
  
  // Start API server
  await startApiServer();
  
  // Initial collection
  await collectMetrics();
  
  // Schedule periodic collection
  setInterval(collectMetrics, CONFIG.COLLECTION_INTERVAL);
  console.log(`⏰ Scheduled collection every ${CONFIG.COLLECTION_INTERVAL}ms`);
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down...');
    process.exit(0);
  });
}

main().catch(console.error);
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve(__dirname, '../protos/monitoring.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const monitoringProto = protoDescriptor.driftseeker.monitoring;

async function calculateLatency(url: string): Promise<{ latency: number; status: 'up' | 'down'; reason: string }> {
  const start = performance.now();
  let status: 'up' | 'down' = 'down';
  let reason = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(url, { 
      method: 'HEAD', 
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (res.ok) {
      status = 'up';
    } else {
      reason = `HTTP Error: ${res.status} ${res.statusText}`;
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    reason = error.name === 'AbortError' ? 'Timeout' : (error.message || 'Connection failed');
    console.error(`Ping error for ${url}:`, error);
  }
  const end = performance.now();
  return { latency: Math.round(end - start), status, reason };
}

function checkTarget(call: any, callback: any) {
  const { url } = call.request;
  
  console.log(`[gRPC Worker] Checking URL: ${url}`);
  
  calculateLatency(url)
    .then(({ latency, status, reason }) => {
      console.log(`[gRPC Worker] Result for ${url}: ${status} - ${latency}ms`);
      callback(null, {
        status,
        latency_ms: latency,
        reason
      });
    })
    .catch(err => {
      console.error(`[gRPC Worker] Failed to check ${url}:`, err);
      callback({
        code: grpc.status.INTERNAL,
        details: err.message
      });
    });
}

function main() {
  const server = new grpc.Server();
  
  server.addService(monitoringProto.MonitoringEngine.service, {
    CheckTarget: checkTarget
  });

  const port = process.env.PORT || '50051';
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(`gRPC Monitoring Worker running on port ${boundPort}`);
  });
}

main();

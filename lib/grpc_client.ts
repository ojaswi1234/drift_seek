import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

export interface TargetCheckResponse {
  status: 'up' | 'down';
  latency_ms: number;
  reason: string;
}

interface MonitoringEngineClient extends grpc.Client {
  CheckTarget: (
    request: { url: string },
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (err: grpc.ServiceError | null, response?: TargetCheckResponse) => void
  ) => void;
}

const globalForGrpc = global as unknown as { grpcClient?: MonitoringEngineClient };

function createGrpcClient(): MonitoringEngineClient {
  const PROTO_PATH = path.resolve(process.cwd(), 'protos', 'monitoring.proto');

  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    driftseeker: {
      monitoring: {
        MonitoringEngine: new (
          address: string,
          credentials: grpc.ChannelCredentials
        ) => MonitoringEngineClient;
      };
    };
  };

  const monitoringProto = protoDescriptor.driftseeker.monitoring;
  const grpcHost = process.env.GRPC_WORKER_URL || 'localhost:50051';
  const useTls = process.env.GRPC_USE_TLS === 'true';

  const credentials = useTls
    ? grpc.credentials.createSsl(
        process.env.GRPC_ROOT_CERT ? Buffer.from(process.env.GRPC_ROOT_CERT, 'utf8') : undefined
      )
    : grpc.credentials.createInsecure();

  return new monitoringProto.MonitoringEngine(grpcHost, credentials);
}

export function getGrpcClient(): MonitoringEngineClient {
  if (!globalForGrpc.grpcClient) {
    globalForGrpc.grpcClient = createGrpcClient();
  }
  return globalForGrpc.grpcClient;
}

export function checkTargetViaGrpc(url: string, timeoutMs = 15000): Promise<TargetCheckResponse> {
  const client = getGrpcClient();
  const metadata = new grpc.Metadata();
  if (process.env.GRPC_AUTH_TOKEN) {
    metadata.add('x-grpc-auth-token', process.env.GRPC_AUTH_TOKEN);
  }

  return new Promise((resolve, reject) => {
    client.CheckTarget(
      { url },
      metadata,
      { deadline: Date.now() + timeoutMs },
      (err, response) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(
          response || {
            status: 'down',
            latency_ms: 0,
            reason: 'Empty response from gRPC worker',
          }
        );
      }
    );
  });
}

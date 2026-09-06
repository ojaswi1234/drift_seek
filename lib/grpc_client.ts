import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// Using process.cwd() since this runs in the Next.js server environment
const PROTO_PATH = path.resolve(process.cwd(), 'protos', 'monitoring.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const monitoringProto = protoDescriptor.driftseeker.monitoring;

const grpcHost = process.env.GRPC_WORKER_URL || 'localhost:50051';

// Singleton pattern to prevent multiple connections in dev mode
const globalForGrpc = global as unknown as { grpcClient: any };

export const grpcClient = globalForGrpc.grpcClient || new monitoringProto.MonitoringEngine(
  grpcHost,
  grpc.credentials.createInsecure()
);

if (process.env.NODE_ENV !== 'production') globalForGrpc.grpcClient = grpcClient;

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as pty from 'node-pty';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHash, timingSafeEqual } from 'crypto';
import { execFile, execSync } from 'child_process';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAFE_GITHUB_URL_REGEX =
  /^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/;
const SAFE_USERNAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function safeTimingEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function isValidGithubRepoUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const match = raw.trim().match(SAFE_GITHUB_URL_REGEX);
  if (!match) return false;
  const [, owner, repo] = match;
  return owner !== '.' && owner !== '..' && repo !== '.' && repo !== '..';
}

function resolveProtoPath(): string {
  const candidates = [
    path.resolve(__dirname, '../protos/execution.proto'),
    path.resolve(__dirname, './protos/execution.proto'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

const PROTO_PATH = resolveProtoPath();
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
interface ExecutionDescriptor {
  driftseeker: {
    execution: {
      SandboxManager: { service: grpc.ServiceDefinition };
    };
  };
}

const protoDescriptor = grpc.loadPackageDefinition(
  packageDefinition
) as unknown as ExecutionDescriptor;
const executionProto = protoDescriptor.driftseeker.execution;

function buildStressDockerArgs(githubUrl: string): string[] {
  const innerScript =
    'apk add --no-cache git > /dev/null 2>&1 && ' +
    'npm install -g autocannon > /dev/null 2>&1 && ' +
    'git clone --depth 1 "$1" /temp_app > /dev/null 2>&1 && ' +
    'cd /temp_app && ' +
    'npm install --legacy-peer-deps > /dev/null 2>&1 && ' +
    'npm run build --if-present > /dev/null 2>&1 && ' +
    '(npm start > /dev/null 2>&1 &) && ' +
    'sleep 15 && ' +
    'autocannon -c 50 -a 2000 -j http://localhost:3000';

  return [
    'run',
    '--rm',
    '--memory=256m',
    '--cpus=0.5',
    'node:alpine',
    'sh',
    '-c',
    innerScript,
    '_',
    githubUrl,
  ];
}

function startGrpcServer() {
  const server = new grpc.Server();

  server.addService(executionProto.SandboxManager.service, {
    RunStressTest: (call: grpc.ServerWritableStream<{ github_url?: string }, { message: string }>) => {
      const expectedToken = process.env.GRPC_AUTH_TOKEN;
      if (expectedToken) {
        const incoming = call.metadata?.get('x-grpc-auth-token')?.[0];
        if (typeof incoming !== 'string' || !safeTimingEqual(incoming, expectedToken)) {
          call.emit('error', { code: grpc.status.UNAUTHENTICATED, details: 'Unauthorized' });
          return;
        }
      }

      const { github_url } = call.request || {};
      if (!isValidGithubRepoUrl(github_url)) {
        call.emit('error', {
          code: grpc.status.INVALID_ARGUMENT,
          details: 'Invalid GitHub repository URL',
        });
        return;
      }

      console.log(`[gRPC] RunStressTest requested for ${github_url}`);
      call.write({ message: `Starting pipeline for ${github_url}...` });

      const child = execFile('docker', buildStressDockerArgs(github_url.trim()), {
        maxBuffer: 1024 * 1024 * 10,
      });

      call.on('cancelled', () => {
        child.kill('SIGKILL');
      });

      child.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line: string) => call.write({ message: line }));
      });

      child.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line: string) => call.write({ message: `[ERROR] ${line}` }));
      });

      child.on('close', (code) => {
        call.write({ message: `Process exited with code ${code}` });
        call.end();
      });
    },
  });

  const grpcPort = process.env.GRPC_PORT || '50052';
  let credentials = grpc.ServerCredentials.createInsecure();
  if (
    process.env.GRPC_USE_TLS === 'true' &&
    process.env.GRPC_TLS_KEY &&
    process.env.GRPC_TLS_CERT
  ) {
    credentials = grpc.ServerCredentials.createSsl(null, [
      {
        private_key: Buffer.from(process.env.GRPC_TLS_KEY, 'utf8'),
        cert_chain: Buffer.from(process.env.GRPC_TLS_CERT, 'utf8'),
      },
    ]);
  }

  server.bindAsync(`0.0.0.0:${grpcPort}`, credentials, (err, port) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(`gRPC Execution Server running on port ${port}`);
  });
}

const allowedOrigins = (process.env.CLIENT_ORIGINS || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  })
);
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

if (process.env.TERMINAL_AUTH_TOKEN) {
  const requiredToken = process.env.TERMINAL_AUTH_TOKEN;
  io.use((socket, next) => {
    const incoming = socket.handshake.auth?.token;
    if (typeof incoming !== 'string' || !safeTimingEqual(incoming, requiredToken)) {
      return next(new Error('Unauthorized'));
    }
    return next();
  });
}

function startServer() {
  startGrpcServer();

  const targetContainer = 'alpine:latest';
  console.log(`Pre-pulling ${targetContainer} to ensure clean terminal starts...`);
  try {
    execSync(`docker pull ${targetContainer}`, { stdio: 'ignore' });
    console.log('Docker image is cached and ready!');
  } catch (err) {
    console.error('Warning: Failed to pre-pull image. It will pull on first connection.', err);
  }

  io.on('connection', (socket) => {
    console.log('Secure Shell Session Started:', socket.id);
    let ptyProcess: pty.IPty | null = null;
    const safeSocketId = socket.id.replace(/[^a-zA-Z0-9_-]/g, '');
    const containerName = `drift_shell_${safeSocketId}`;

    try {
      const rawUser = String(socket.handshake.auth?.username || 'drift_user');
      const customUser = SAFE_USERNAME_REGEX.test(rawUser) ? rawUser : 'drift_user';
      const baseWorkspaceDir = process.env.DRIFT_WORKSPACES_DIR || '/tmp/drift_workspaces';
      const userWorkspacePath = path.join(baseWorkspaceDir, customUser);
      fs.mkdirSync(userWorkspacePath, { recursive: true });

      const args = [
        'run',
        '--rm',
        '-it',
        '--name',
        containerName,
        '--memory',
        '256m',
        '--cpus',
        '0.5',
        '-v',
        `${userWorkspacePath}:/projects`,
        '-w',
        '/projects',
        '-e',
        'TERM=xterm-256color',
        '-e',
        'PROMPT_COMMAND=printf "DRIFT_SERVER_PROMPT|%s> " "$PWD"',
        targetContainer,
        'sh',
        '-c',
        'apk update >/dev/null 2>&1 && apk add --no-cache bash git curl >/dev/null 2>&1 && echo "DRIFT_CLEAR_SCREEN" && echo "PS1=\\"\\"" > ~/.bashrc && exec bash',
      ];

      ptyProcess = pty.spawn('docker', args, {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: {
          ...process.env,
          DRIFT_ENGINE_ACTIVE: 'true',
        },
      });
    } catch (err) {
      console.error('Failed to spawn shell:', err);
      socket.emit('output', '\r\n[server] Failed to start shell.\r\n');
      socket.disconnect();
      return;
    }

    ptyProcess.onData((data) => {
      socket.emit('output', data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      socket.emit('output', `\r\n[server] Shell exited (code=${exitCode}, signal=${signal}).\r\n`);
      socket.disconnect(true);
    });

    socket.on('input', (data) => {
      if (typeof data !== 'string' || data.length > 4096) return;
      try {
        ptyProcess?.write(data);
      } catch (err) {
        console.error('Failed to write to shell:', err);
      }
    });

    socket.on('resize', (dims: { cols?: unknown; rows?: unknown }) => {
      const cols = Number(dims?.cols);
      const rows = Number(dims?.rows);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 500 && rows <= 200) {
        ptyProcess?.resize(cols, rows);
      }
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
    });

    socket.on('disconnect', () => {
      console.log('Session Ended:', socket.id);
      try {
        ptyProcess?.kill();
        execFile('docker', ['rm', '-f', containerName], (error) => {
          if (error) {
            console.log(`Container ${containerName} cleanup note: ${error.message}`);
          }
        });
      } catch (err) {
        console.error('Failed to kill shell process:', err);
      }
    });
  });

  const argv = process.argv.slice(2);
  const portArg = argv.indexOf('--port');
  const hostArg = argv.indexOf('--hostname');

  const port =
    portArg !== -1 && argv[portArg + 1]
      ? parseInt(argv[portArg + 1], 10)
      : process.env.PORT
        ? parseInt(process.env.PORT, 10)
        : 3001;
  const hostname = hostArg !== -1 && argv[hostArg + 1] ? argv[hostArg + 1] : '0.0.0.0';

  httpServer.listen(port, hostname, () => {
    console.log(`Handyman Terminal running on ${hostname}:${port}`);
  });
}

try {
  startServer();
} catch (err) {
  console.error('Error starting terminal server:', err);
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

app.get('/', (_req, res) => {
  res.send('Handyman Terminal Server is running.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/run-github-stress-test', (req, res) => {
  const expectedToken = (process.env.SEEK_API_TOKEN || '').trim();
  if (!expectedToken) {
    return res.status(500).json({ success: false, error: 'SEEK_API_TOKEN not configured' });
  }

  const incomingToken = String(req.headers['x-seek-api-token'] || '').trim();
  if (!incomingToken || !safeTimingEqual(incomingToken, expectedToken)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ success: false, error: 'Missing JSON body.' });
  }

  const { githubUrl, branch = 'main' } = req.body as { githubUrl?: unknown; branch?: unknown };
  if (!isValidGithubRepoUrl(githubUrl)) {
    return res.status(400).json({ success: false, error: 'Invalid GitHub URL' });
  }

  const safeBranch = typeof branch === 'string' && branch.trim() ? branch.trim() : 'main';
  res.json({ success: true, message: 'Pipeline started in background' });

  execFile('docker', buildStressDockerArgs(githubUrl.trim()), { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
    if (error) {
      console.error('[STRESS ENGINE FATAL]', stderr);
      return;
    }

    try {
      const startIdx = stdout ? stdout.indexOf('{') : -1;
      if (startIdx === -1) {
        throw new Error('autocannon did not emit JSON output');
      }

      const cleanStdout = stdout.substring(startIdx);
      const stats = JSON.parse(cleanStdout) as {
        requests?: { sent?: number; total?: number; average?: number };
        latency?: { average?: number; p99?: number };
        '2xx'?: number;
      };

      const totalReqs = Number(stats.requests?.sent || stats.requests?.total || 0);
      const successReqs = Number(stats['2xx'] || 0);
      const successRate = totalReqs > 0 ? Number(((successReqs / totalReqs) * 100).toFixed(2)) : 0;

      const runMetrics = {
        requestsPerSecond: Number(stats.requests?.average || 0),
        latencyAverage: Number(stats.latency?.average || 0),
        latency99th: Number(stats.latency?.p99 || 0),
        successRate,
      };

      const targetVercelUrl = (
        process.env.NEXT_PUBLIC_API_BASE_URL || 'https://drift-seek.vercel.app'
      ).replace(/\/+$/, '');

      const callbackRes = await fetch(`${targetVercelUrl}/api/abtest/results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-seek-api-token': expectedToken,
        },
        body: JSON.stringify({
          githubUrl: githubUrl.trim(),
          testData: {
            baselineBranch: safeBranch,
            candidateBranch: safeBranch,
            baselineMetrics: runMetrics,
            candidateMetrics: runMetrics,
            passed: successRate >= 99.9,
          },
        }),
      });

      if (!callbackRes.ok) {
        console.error('[STRESS ENGINE] Callback rejected:', callbackRes.status);
      }
    } catch (parseError) {
      console.error('[STRESS ENGINE JSON PARSE ERROR]', parseError);
    }
  });
});

import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HTTPServer } from 'http';
import type { Socket as NetSocket } from 'net';
import type Redis from 'ioredis';
import { Server as IOServer } from 'socket.io';
import { getToken } from 'next-auth/jwt';
import redis from '@/lib/redis';

type MonitorMetricPayload = {
  id: string;
  url: string;
  status: 'up' | 'down' | 'online' | 'offline' | 'pending' | 'error';
  latency: number;
  reason: string;
  lastChecked: string;
};

type SocketServer = HTTPServer & {
  io?: IOServer;
  ioInitPromise?: Promise<void>;
  redisSubscriber?: Redis;
  redisSubscriberReady?: boolean;
};

type ApiResponseServerIO = NextApiResponse & {
  socket: NetSocket & {
    server: SocketServer;
  };
};

const CHANNEL = 'system_metrics';

function safeParseMetric(message: string): MonitorMetricPayload | null {
  try {
    const parsed = JSON.parse(message) as Partial<MonitorMetricPayload>;
    const latency = Number(parsed.latency);
    if (!parsed.id || !parsed.url || !parsed.status || parsed.latency === null || !Number.isFinite(latency)) {
      return null;
    }

    return {
      id: String(parsed.id),
      url: String(parsed.url),
      status: parsed.status,
      latency,
      reason: String(parsed.reason ?? ''),
      lastChecked: String(parsed.lastChecked ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

async function initSocketServer(server: SocketServer) {
  const io = new IOServer(server, {
    path: '/api/socketio',
    cors: {
      origin: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  if (process.env.NEXTAUTH_SECRET) {
    io.use(async (socket, next) => {
      try {
        const token = await getToken({
          req: socket.request as unknown as Parameters<typeof getToken>[0]['req'],
          secret: process.env.NEXTAUTH_SECRET,
        });
        if (!token?.email) {
          return next(new Error('Unauthorized'));
        }
        return next();
      } catch {
        return next(new Error('Unauthorized'));
      }
    });
  }

  const subscriber = redis.duplicate({ maxRetriesPerRequest: null });
  subscriber.on('error', (error) => {
    console.error('Redis subscriber error:', error);
  });

  await subscriber.subscribe(CHANNEL);

  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;
    const payload = safeParseMetric(message);
    if (!payload) return;
    io.emit('monitor:metric', payload);
  });

  io.on('connection', (socket) => {
    socket.emit('monitor:ready', { connected: true });
  });

  server.io = io;
  server.redisSubscriber = subscriber;
  server.redisSubscriberReady = true;
}

export default async function handler(_req: NextApiRequest, res: ApiResponseServerIO) {
  const server = res.socket.server;
  if (!server.io) {
    if (!server.ioInitPromise) {
      server.ioInitPromise = initSocketServer(server).catch((err) => {
        server.ioInitPromise = undefined;
        throw err;
      });
    }
    await server.ioInitPromise;
  }

  res.status(200).json({ ok: true, subscriberReady: !!server.redisSubscriberReady });
}

export const config = {
  api: {
    bodyParser: false,
  },
};

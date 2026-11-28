import { Redis } from 'ioredis';

const createRedisClient = () => {
  const url = process.env.REDIS_URL;

  const client = url
    ? new Redis(url, {
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        lazyConnect: true,
      })
    : new Redis('redis://127.0.0.1:6379', {
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        lazyConnect: true,
      });

  if (!url && process.env.NODE_ENV !== 'production') {
    console.warn('REDIS_URL is missing. Falling back to local redis (development only).');
  } else if (!url && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: REDIS_URL is not configured in production.');
  }

  client.on('error', (err) => {
    console.error('Redis client error:', err.message);
  });

  return client;
};

declare global {
  var redis: Redis | undefined;
}

const redis = globalThis.redis ?? createRedisClient();

export default redis;

if (process.env.NODE_ENV !== 'production') {
  globalThis.redis = redis;
}

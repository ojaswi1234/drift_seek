import { Redis } from 'ioredis';

// 1. Define a helper to create the client
const redisClientSingleton = () => {
  const url = process.env.REDIS_URL;
  
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL environment variable is required in production');
    }
    console.warn("REDIS_URL is missing. Falling back to local redis (development only).");
    return new Redis("redis://127.0.0.1:6379");
  }

  return new Redis(url, {
    // Optional: add retry strategy for better stability
    maxRetriesPerRequest: 3,
    // Connection timeout
    connectTimeout: 10000,
    // Enable lazy connect
    lazyConnect: true,
  });
};

// 2. Attach the client to the global object in development
declare global {
  var redis: Redis | undefined;
}

// 3. Re-use the existing connection if it exists
const redis = globalThis.redis ?? redisClientSingleton();

export default redis;

// 4. In development, save the connection to the global object
if (process.env.NODE_ENV !== 'production') {
  globalThis.redis = redis;
}
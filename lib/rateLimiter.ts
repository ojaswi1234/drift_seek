import { Redis } from 'ioredis';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

// Redis connection for rate limiting
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
});

interface RateLimitOptions {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  keyPrefix?: string;    // Prefix for Redis keys
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Hash IP address for privacy (GDPR compliance)
 */
function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').substring(0, 32);
}

/**
 * Extract client IP from request headers
 */
function getClientIp(request: NextRequest): string {
  // Check various proxy headers (in order of preference)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  
  // Fallback - in development this might be ::1 or 127.0.0.1
  return 'unknown';
}

/**
 * Fixed-window rate limiter with Redis
 */
export async function rateLimit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const {
    windowMs,
    maxRequests,
    keyPrefix = 'ratelimit',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  const ip = getClientIp(request);
  const hashedIp = hashIp(ip);
  const key = `${keyPrefix}:${hashedIp}`;
  
  const now = Date.now();
  const windowStart = now - windowMs;
  const windowSec = Math.ceil(windowMs / 1000);

  try {
    // Use Redis pipeline for atomic operations
    const pipeline = redis.pipeline();
    
    // Remove expired entries
    pipeline.zremrangebyscore(key, 0, windowStart);
    
    // Count current requests in window
    pipeline.zcard(key);
    
    // Add current request
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    
    // Set expiry on the key
    pipeline.expire(key, windowSec + 1);
    
    const results = await pipeline.exec();
    
    if (!results) {
      throw new Error('Redis pipeline returned null');
    }
    
    const currentCount = results[1]?.[1] as number || 0;
    const remaining = Math.max(0, maxRequests - currentCount);
    const resetTime = now + windowMs;
    
    const success = currentCount < maxRequests;
    
    return {
      success,
      limit: maxRequests,
      remaining,
      resetTime,
      retryAfter: success ? undefined : windowSec,
    };
  } catch (error) {
    console.error('Rate limiter error:', error);
    // Fail open - allow request through if Redis is unavailable
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests,
      resetTime: now + windowMs,
    };
  }
}

/**
 * Middleware helper to apply rate limiting to API routes
 */
export function withRateLimit(
  handler: (request: NextRequest) => Promise<NextResponse>,
  options: RateLimitOptions
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const result = await rateLimit(request, options);
    
    const response = await handler(request);
    
    // Add rate limit headers
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());
    
    if (!result.success && result.retryAfter) {
      response.headers.set('Retry-After', result.retryAfter.toString());
      return NextResponse.json(
        { error: 'Too Many Requests', message: 'Rate limit exceeded' },
        { status: 429, headers: response.headers }
      );
    }
    
    return response;
  };
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const rateLimiters = {
  // Strict: 10 requests per minute
  strict: { windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:strict' },
  // Standard: 20 requests per minute
  standard: { windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:standard' },
  // Lenient: 100 requests per minute
  lenient: { windowMs: 60_000, maxRequests: 100, keyPrefix: 'rl:lenient' },
  // Auth endpoints: 5 requests per minute
  auth: { windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:auth' },
  // API endpoints: 60 requests per minute
  api: { windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:api' },
};
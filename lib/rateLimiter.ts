import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import redis from '@/lib/redis';

interface RateLimitOptions {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  keyPrefix?: string;    // Prefix for Redis keys
  identifier?: string;   // Optional authenticated user identifier
}

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').substring(0, 32);
}

function getClientIp(request: NextRequest): string {
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for');
  if (vercelForwarded) {
    return vercelForwarded.split(',')[0].trim();
  }

  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return 'unknown';
}

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowStart = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local windowSec = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
local currentCount = redis.call('ZCARD', key)

if currentCount >= maxRequests then
  return {0, currentCount}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, windowSec + 1)
return {1, currentCount + 1}
`;

/**
 * Sliding-window rate limiter with Redis (atomic via Lua)
 */
export async function rateLimit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const {
    windowMs,
    maxRequests,
    keyPrefix = 'ratelimit',
    identifier,
  } = options;

  const rawId = identifier || getClientIp(request);
  const hashedId = hashIdentifier(rawId);
  const key = `${keyPrefix}:${hashedId}`;

  const now = Date.now();
  const windowStart = now - windowMs;
  const windowSec = Math.ceil(windowMs / 1000);
  const member = `${now}-${randomUUID()}`;

  try {
    const evalResult = (await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      now.toString(),
      windowStart.toString(),
      maxRequests.toString(),
      windowSec.toString(),
      member
    )) as [number, number];

    const allowed = Number(evalResult?.[0]) === 1;
    const countAfter = Number(evalResult?.[1] ?? 0);
    const remaining = Math.max(0, maxRequests - countAfter);
    const resetTime = now + windowMs;

    return {
      success: allowed,
      limit: maxRequests,
      remaining,
      resetTime,
      retryAfter: allowed ? undefined : windowSec,
    };
  } catch (error) {
    console.error('Rate limiter error:', error);
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests,
      resetTime: now + windowMs,
    };
  }
}

/**
 * Middleware helper to apply rate limiting BEFORE invoking handler
 */
export function withRateLimit<TContext = unknown>(
  handler: (request: NextRequest, context: TContext) => Promise<Response>,
  options: RateLimitOptions
) {
  return async (request: NextRequest, context: TContext): Promise<Response> => {
    const result = await rateLimit(request, options);

    if (!result.success) {
      const headers = new Headers();
      headers.set('X-RateLimit-Limit', result.limit.toString());
      headers.set('X-RateLimit-Remaining', result.remaining.toString());
      headers.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());
      headers.set('Retry-After', (result.retryAfter || 60).toString());

      return NextResponse.json(
        { error: 'Too Many Requests', message: 'Rate limit exceeded' },
        { status: 429, headers }
      );
    }

    const response = await handler(request, context);
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());
    return response;
  };
}

export const rateLimiters = {
  strict: { windowMs: 60_000, maxRequests: 10, keyPrefix: 'rl:strict' },
  standard: { windowMs: 60_000, maxRequests: 20, keyPrefix: 'rl:standard' },
  lenient: { windowMs: 60_000, maxRequests: 100, keyPrefix: 'rl:lenient' },
  auth: { windowMs: 60_000, maxRequests: 5, keyPrefix: 'rl:auth' },
  api: { windowMs: 60_000, maxRequests: 60, keyPrefix: 'rl:api' },
};

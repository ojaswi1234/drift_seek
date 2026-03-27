import { NextRequest } from "next/server";
import redis from "./redis";

/**
 * Validates request rate limit using Redis fixed window algorithm.
 * @param req The incoming NextRequest
 * @param limit Max requests per 60 seconds (defaults to 20)
 * @throws {Error} Throws "RATE_LIMIT_EXCEEDED" if limit is surpassed.
 */
export async function checkRateLimit(req: NextRequest, limit: number = 20): Promise<void> {
  try {
    // Attempt to extract IP, fallback to "unknown-ip"
    const forwardedFor = req.headers.get("x-forwarded-for");
    const realIp = req.headers.get("x-real-ip");
    
    let ip = "unknown-ip";
    if (forwardedFor) {
      ip = forwardedFor.split(",")[0].trim();
    } else if (realIp) {
      ip = realIp;
    }

    const key = `rate:${ip}`;

    // Increment request count
    const count = await redis.incr(key);

    // Set TTL on first request within the window
    if (count === 1) {
      await redis.expire(key, 60);
    }

    // Exceed limit check
    if (count > limit) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }
  } catch (error) {
    // If the error is our enforced limit, bubble it up to the route handler
    if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
      throw error;
    }
    
    // Fail Open: Ignore Redis connection issues instead of returning an error.
    console.error("[RateLimiter] Error connecting to Redis:", error);
  }
}

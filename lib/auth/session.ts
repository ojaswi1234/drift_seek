import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getAuthSecret } from '@/lib/auth/secret';

export async function getGitHubAccessToken(req: NextRequest | Request): Promise<string | null> {
  const secret = getAuthSecret();

  for (const secureCookie of [false, true]) {
    try {
      const token = await getToken({
        req: req as NextRequest,
        secret,
        secureCookie,
      });
      if (typeof token?.accessToken === 'string' && token.accessToken) {
        return token.accessToken;
      }
    } catch {
      // Try next cookie variant
    }
  }

  return null;
}

export function safeTimingEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export async function parseJsonBody<T = unknown>(
  req: Request
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const data = (await req.json()) as T;
    if (!data || typeof data !== 'object') {
      return { ok: false };
    }
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

import { createHash } from 'node:crypto';

/**
 * Returns a consistent NextAuth secret shared between NextAuth route handlers
 * and `getToken()` callers, even in local dev where NEXTAUTH_SECRET may be unset.
 */
export function getAuthSecret(): string | undefined {
  const configured = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (configured) return configured;

  if (process.env.NODE_ENV !== 'production') {
    const seed = process.env.GITHUB_SECRET || process.env.GITHUB_ID || 'driftseeker-local-dev';
    return createHash('sha256').update(seed).digest('hex');
  }

  return undefined;
}

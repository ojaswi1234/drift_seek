import { z } from 'zod';
import { validateUrlSyntax } from '@/lib/security/urlValidator';

function normalizeHttpUrl(val: string): string {
  const trimmed = val.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

const SAFE_COMMAND_REGEX = /^[a-zA-Z0-9\s._:/=@-]+$/;

export const createMonitorSchema = z.object({
  name: z
    .string({ message: 'Name is required and must be a string' })
    .trim()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name must be at most 100 characters'),
  url: z
    .string({ message: 'URL is required and must be a string' })
    .trim()
    .min(1, 'URL cannot be empty')
    .transform(normalizeHttpUrl)
    .refine((val) => validateUrlSyntax(val, { allowHttp: true }).valid, {
      message: 'URL must be a valid public http:// or https:// address',
    }),
});

export const deleteMonitorSchema = z.object({
  id: z
    .string({ message: 'ID is required' })
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format (must be a 24-character hexadecimal string)'),
});

export const objectIdSchema = z
  .string({ message: 'ID is required' })
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

export function parseGitHubRepoUrl(rawUrl: string): { owner: string; repo: string; canonicalUrl: string } | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) {
      return null;
    }
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, '');
    const segmentRegex = /^[a-zA-Z0-9_.-]+$/;
    if (
      !owner ||
      !repo ||
      owner === '.' ||
      owner === '..' ||
      repo === '.' ||
      repo === '..' ||
      !segmentRegex.test(owner) ||
      !segmentRegex.test(repo)
    ) {
      return null;
    }
    return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
  } catch {
    return null;
  }
}

const branchRegex = /^(?!-)(?!.*\.\.)[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/;

export const triggerABTestSchema = z.object({
  githubUrl: z
    .string({ message: 'GitHub URL is required' })
    .trim()
    .refine((url) => parseGitHubRepoUrl(url) !== null, {
      message: "GitHub URL must be a valid repository URL like 'https://github.com/owner/repo'",
    }),
  branches: z
    .array(
      z
        .string({ message: 'Branch name must be a string' })
        .trim()
        .min(1, 'Branch name cannot be empty')
        .max(200, 'Branch name is too long')
        .refine((b) => branchRegex.test(b), {
          message: 'Invalid branch name format',
        }),
      { message: 'Branches are required' }
    )
    .length(2, 'Exactly 2 branches must be specified for A/B testing')
    .refine((arr) => arr[0] !== arr[1], {
      message: 'Baseline and candidate branches must be different',
    }),
  buildCommand: z
    .string()
    .trim()
    .max(200)
    .refine((cmd) => SAFE_COMMAND_REGEX.test(cmd), {
      message: 'buildCommand contains disallowed shell characters',
    })
    .optional(),
  startCommand: z
    .string()
    .trim()
    .max(200)
    .refine((cmd) => SAFE_COMMAND_REGEX.test(cmd), {
      message: 'startCommand contains disallowed shell characters',
    })
    .optional(),
});

export const pingMonitorSchema = z
  .object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format').optional(),
    url: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val ? normalizeHttpUrl(val) : val))
      .refine((val) => !val || validateUrlSyntax(val, { allowHttp: true }).valid, {
        message: 'Invalid or blocked URL',
      }),
  })
  .refine((data) => Boolean(data.id || data.url), {
    message: 'Must provide either id or url',
  });

const metricSetSchema = z.object({
  requestsPerSecond: z.number().finite().min(0),
  latencyAverage: z.number().finite().min(0),
  latency99th: z.number().finite().min(0),
  successRate: z.number().finite().min(0).max(100),
});

export const abTestResultPayloadSchema = z.object({
  githubUrl: z
    .string()
    .trim()
    .refine((url) => parseGitHubRepoUrl(url) !== null, 'Invalid GitHub repository URL'),
  testData: z.object({
    testedAt: z.union([z.string().datetime(), z.coerce.date()]).optional(),
    baselineBranch: z.string().trim().min(1).max(200),
    candidateBranch: z.string().trim().min(1).max(200),
    baselineMetrics: metricSetSchema,
    candidateMetrics: metricSetSchema,
    passed: z.boolean(),
  }),
});

export const teamUserSchema = z.object({
  userId: z
    .string({ message: 'GitHub username is required' })
    .trim()
    .min(1, 'Username cannot be empty')
    .max(100, 'Username too long')
    .regex(/^[a-zA-Z0-9-]+$/, 'Invalid GitHub username'),
  role: z.enum(['Editor', 'Viewer']),
  roomId: z.string().trim().min(1).max(64).optional(),
});

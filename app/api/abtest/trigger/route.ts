import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextRequest, NextResponse } from 'next/server';
import { parseGitHubRepoUrl, triggerABTestSchema } from '@/lib/validation/schemas';
import { rateLimit, rateLimiters } from '@/lib/rateLimiter';
import { getGitHubAccessToken, parseJsonBody } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = await getGitHubAccessToken(req);

    if (!session || !session.user?.email || !accessToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rateLimitResult = await rateLimit(req, {
      ...rateLimiters.auth,
      identifier: session.user.email,
    });

    const rlHeaders = {
      'X-RateLimit-Limit': rateLimitResult.limit.toString(),
      'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString(),
    };

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Too Many Requests', message: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            ...rlHeaders,
            'Retry-After': (rateLimitResult.retryAfter || 60).toString(),
          },
        }
      );
    }

    const githubToken = process.env.GITHUB_ACTION_TRIGGER_TOKEN;
    if (!githubToken) {
      console.error('GITHUB_ACTION_TRIGGER_TOKEN not configured');
      return NextResponse.json(
        { success: false, error: 'Server configuration error: Missing GitHub trigger token' },
        { status: 500, headers: rlHeaders }
      );
    }

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body' },
        { status: 400, headers: rlHeaders }
      );
    }

    const validationResult = triggerABTestSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', errors: validationResult.error.issues },
        { status: 400, headers: rlHeaders }
      );
    }

    const { githubUrl, branches, buildCommand, startCommand } = validationResult.data;
    const parsedRepo = parseGitHubRepoUrl(githubUrl);
    if (!parsedRepo) {
      return NextResponse.json(
        { success: false, error: 'Invalid repository owner or name format' },
        { status: 400, headers: rlHeaders }
      );
    }

    const { owner, repo } = parsedRepo;

    // Verify authenticated user has push/admin permission on target repository
    const repoAuthRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!repoAuthRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Repository not found or access denied' },
        { status: repoAuthRes.status === 404 ? 404 : 403, headers: rlHeaders }
      );
    }

    const repoInfo = (await repoAuthRes.json()) as {
      permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
    };
    if (!repoInfo.permissions?.push && !repoInfo.permissions?.admin && !repoInfo.permissions?.maintain) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Write access to the target repository is required' },
        { status: 403, headers: rlHeaders }
      );
    }

    // Trusted server-configured callback base URL (never trust spoofable Origin header)
    const trustedBaseUrl = (
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      process.env.NEXTAUTH_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');

    const [baselineBranch, candidateBranch] = branches;

    const dispatchResponse = await fetch(
      `https://api.github.com/repos/ojaswi1234/drift_seek/actions/workflows/ab-test.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            target_repo: `${owner}/${repo}`,
            baseline_branch: baselineBranch,
            candidate_branch: candidateBranch,
            seek_api_url: trustedBaseUrl,
            ...(buildCommand ? { build_command: buildCommand } : {}),
            ...(startCommand ? { start_command: startCommand } : {}),
          },
        }),
      }
    );

    if (!dispatchResponse.ok) {
      const errorData = await dispatchResponse.text();
      console.error('Failed to trigger GitHub Action:', errorData);
      return NextResponse.json(
        {
          success: false,
          error:
            'Failed to trigger the central A/B workflow. Verify GITHUB_ACTION_TRIGGER_TOKEN and workflow configuration.',
        },
        { status: dispatchResponse.status, headers: rlHeaders }
      );
    }

    return NextResponse.json(
      { success: true, message: 'A/B Performance Test pipeline started' },
      { status: 200, headers: rlHeaders }
    );
  } catch (error) {
    console.error('[AB TEST TRIGGER ERROR]:', error);
    return NextResponse.json(
      { success: false, error: 'A/B Test Trigger Failure' },
      { status: 500 }
    );
  }
}

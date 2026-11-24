import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route"; 
import { NextRequest, NextResponse } from "next/server";
import { triggerABTestSchema } from "@/lib/validation/schemas";
import { rateLimit, rateLimiters } from "@/lib/rateLimiter";

export async function POST(req: NextRequest) {
  // Apply rate limiting
  const rateLimitResult = await rateLimit(req, rateLimiters.auth);
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Too Many Requests", message: "Rate limit exceeded" },
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': rateLimitResult.limit.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString(),
          'Retry-After': (rateLimitResult.retryAfter || 60).toString(),
        }
      }
    );
  }

  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // SECURITY: Use dedicated token only - no fallback chain
    const githubToken = process.env.GITHUB_ACTION_TRIGGER_TOKEN;

    if (!githubToken) {
      console.error("GITHUB_ACTION_TRIGGER_TOKEN not configured");
      return NextResponse.json(
        { success: false, error: "Server configuration error: Missing GitHub trigger token" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const validationResult = triggerABTestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { githubUrl, branches, buildCommand, startCommand } = validationResult.data;

    // Parse the github URL to get owner and repo
    // Example: https://github.com/ojaswi1234/drift_seek
    const urlParts = githubUrl.split('/');
    const owner = urlParts[urlParts.length - 2];
    const repo = urlParts[urlParts.length - 1];

    // Validate owner/repo format (alphanumeric, hyphens, underscores only)
    const repoNameRegex = /^[a-zA-Z0-9_.-]+$/;
    if (!repoNameRegex.test(owner) || !repoNameRegex.test(repo)) {
      return NextResponse.json(
        { success: false, error: "Invalid repository owner or name format" },
        { status: 400 }
      );
    }

    const seek_api_url = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const baselineBranch = branches[0];
    const candidateBranch = branches[1];

    // Validate branch names (prevent injection)
    const branchNameRegex = /^[a-zA-Z0-9_.\/-]+$/;
    if (!branchNameRegex.test(baselineBranch) || !branchNameRegex.test(candidateBranch)) {
      return NextResponse.json(
        { success: false, error: "Invalid branch name format" },
        { status: 400 }
      );
    }

    // Trigger GitHub Action centrally in THIS repository (ojaswi1234/drift_seek)
    const dispatchResponse = await fetch(
      `https://api.github.com/repos/ojaswi1234/drift_seek/actions/workflows/ab-test.yml/dispatches`, 
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: 'main', // Run from the main branch of drift_seek
          inputs: {
            target_repo: `${owner}/${repo}`,
            baseline_branch: baselineBranch,
            candidate_branch: candidateBranch,
            seek_api_url: seek_api_url,
            ...(buildCommand ? { build_command: buildCommand } : {}),
            ...(startCommand ? { start_command: startCommand } : {})
          }
        })
      }
    );

    if (!dispatchResponse.ok) {
      const errorData = await dispatchResponse.text();
      console.error("Failed to trigger GitHub Action:", errorData);
      return NextResponse.json(
        {
          success: false,
          error:
            "Failed to trigger the central A/B workflow. Verify GITHUB_ACTION_TRIGGER_TOKEN is configured with workflow permissions and that ab-test.yml exists on the default branch of ojaswi1234/drift_seek.",
        },
        { status: dispatchResponse.status }
      );
    }

    return NextResponse.json({ success: true, message: "A/B Performance Test pipeline started" }, { status: 200 });

  } catch (error: any) {
    console.error("[AB TEST TRIGGER ERROR]:", error);
    // Don't leak internal error details
    return NextResponse.json({ success: false, error: "A/B Test Trigger Failure" }, { status: 500 });
  }
}
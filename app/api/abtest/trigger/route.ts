import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route"; 
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !(session as any).accessToken) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { githubUrl, branches } = await req.json();
    
    if (!githubUrl || !branches || branches.length !== 2) {
      return NextResponse.json({ success: false, error: "Missing GitHub URL or specific branches (must be exactly 2)" }, { status: 400 });
    }

    // Parse the github URL to get owner and repo
    // Example: https://github.com/ojaswi1234/drift_seek
    const urlParts = githubUrl.split('/');
    const owner = urlParts[urlParts.length - 2];
    const repo = urlParts[urlParts.length - 1];

    const baselineBranch = branches[0];
    const candidateBranch = branches[1];

    // Trigger GitHub Action centrally in THIS repository (ojaswi1234/drift_seek)
    const dispatchResponse = await fetch(
      `https://api.github.com/repos/ojaswi1234/drift_seek/actions/workflows/ab-test.yml/dispatches`, 
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${(session as any).accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: 'main', // Run from the main branch of drift_seek
          inputs: {
            target_repo: `${owner}/${repo}`,
            baseline_branch: baselineBranch,
            candidate_branch: candidateBranch
          }
        })
      }
    );

    if (!dispatchResponse.ok) {
      const errorData = await dispatchResponse.text();
      console.error("Failed to trigger GitHub Action:", errorData);
      return NextResponse.json({ success: false, error: "Failed to trigger GitHub Action. Ensure ab-test.yml exists in the default branch of the target repository." }, { status: dispatchResponse.status });
    }

    return NextResponse.json({ success: true, message: "A/B Performance Test pipeline started" }, { status: 200 });

  } catch (error: any) {
    console.error("[AB TEST TRIGGER ERROR]:", error);
    return NextResponse.json({ success: false, error: `A/B Test Trigger Failure: ${error.message || "Unknown Failure"}` }, { status: 500 });
  }
}

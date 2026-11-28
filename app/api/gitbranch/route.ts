import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextRequest, NextResponse } from 'next/server';
import { getGitHubAccessToken } from '@/lib/auth/session';

const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9_.-]+$/;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const accessToken = await getGitHubAccessToken(request);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: please sign in.' }, { status: 401 });
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: 'GitHub access token missing. Please sign out and sign in again with GitHub.' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const owner = searchParams.get('owner')?.trim();
  const repo = searchParams.get('repo')?.trim();

  if (
    !owner ||
    !repo ||
    owner === '.' ||
    owner === '..' ||
    repo === '.' ||
    repo === '..' ||
    !SAFE_SEGMENT_REGEX.test(owner) ||
    !SAFE_SEGMENT_REGEX.test(repo)
  ) {
    return NextResponse.json({ error: 'Invalid or missing owner or repo' }, { status: 400 });
  }

  try {
    const branches: unknown[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!res.ok) {
        return NextResponse.json(
          { error: `GitHub returned ${res.status} while fetching branches` },
          { status: res.status }
        );
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      branches.push(...data);
      if (data.length < 100) break;
    }

    return NextResponse.json(branches);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

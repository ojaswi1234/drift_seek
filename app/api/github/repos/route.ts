import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextRequest, NextResponse } from 'next/server';
import { getGitHubAccessToken } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const accessToken = await getGitHubAccessToken(req);

  if (!session || !accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allRepos: unknown[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!res.ok) {
        return NextResponse.json(
          { error: 'Failed to fetch repositories from GitHub' },
          { status: res.status }
        );
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      allRepos.push(...data);
      if (data.length < 100) break;
    }

    return NextResponse.json(allRepos);
  } catch (error) {
    console.error('GET /api/github/repos error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

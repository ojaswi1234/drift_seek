import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import ABTestLogs from '@/lib/models/ABTestLogs';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getGitHubAccessToken, parseJsonBody, safeTimingEqual } from '@/lib/auth/session';
import { abTestResultPayloadSchema, parseGitHubRepoUrl } from '@/lib/validation/schemas';

async function fetchAllUserRepoUrls(accessToken: string): Promise<string[]> {
  const urls: string[] = [];
  for (let page = 1; page <= 5; page++) {
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
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const reposData = await res.json();
    if (!Array.isArray(reposData) || reposData.length === 0) {
      break;
    }

    for (const repo of reposData) {
      if (typeof repo?.html_url === 'string') {
        urls.push(repo.html_url);
      }
    }

    if (reposData.length < 100) break;
  }
  return urls;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = await getGitHubAccessToken(req);

    if (!session || !accessToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const filterUrlParam = searchParams.get('url');
    let canonicalFilterUrl: string | null = null;
    if (filterUrlParam) {
      const parsed = parseGitHubRepoUrl(filterUrlParam);
      if (!parsed) {
        return NextResponse.json({ success: false, error: 'Invalid repository URL filter' }, { status: 400 });
      }
      canonicalFilterUrl = parsed.canonicalUrl;
    }

    const userGithubUrls = await fetchAllUserRepoUrls(accessToken);
    if (canonicalFilterUrl && !userGithubUrls.includes(canonicalFilterUrl)) {
      return NextResponse.json({ success: true, data: [] });
    }

    const queryUrls = canonicalFilterUrl ? [canonicalFilterUrl] : userGithubUrls;
    if (queryUrls.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    await dbConnect();
    const logs = await ABTestLogs.find(
      { githubUrl: { $in: queryUrls } },
      { abTests: { $slice: -20 } }
    ).lean();

    const sortedLogs = logs
      .map((doc) => ({
        ...doc,
        abTests: Array.isArray(doc.abTests)
          ? [...doc.abTests].sort(
              (a, b) =>
                new Date(b.testedAt || 0).getTime() - new Date(a.testedAt || 0).getTime()
            )
          : [],
      }))
      .sort((a, b) => {
        const latestA = a.abTests[0]?.testedAt ? new Date(a.abTests[0].testedAt).getTime() : 0;
        const latestB = b.abTests[0]?.testedAt ? new Date(b.abTests[0].testedAt).getTime() : 0;
        return latestB - latestA;
      });

    return NextResponse.json({ success: true, data: sortedLogs });
  } catch (error) {
    console.error('GET /api/abtest/results error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch A/B test results' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const expectedToken = (process.env.SEEK_API_TOKEN || '').trim();
    if (!expectedToken) {
      console.error('SEEK_API_TOKEN is not configured');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const incomingToken = (req.headers.get('x-seek-api-token') || '').trim();
    if (!incomingToken || !safeTimingEqual(incomingToken, expectedToken)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    const validation = abTestResultPayloadSchema.safeParse(parsedBody.data);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const parsedRepo = parseGitHubRepoUrl(validation.data.githubUrl);
    if (!parsedRepo) {
      return NextResponse.json({ success: false, error: 'Invalid GitHub URL' }, { status: 400 });
    }

    const testEntry = {
      ...validation.data.testData,
      testedAt: validation.data.testData.testedAt
        ? new Date(validation.data.testData.testedAt)
        : new Date(),
    };

    await dbConnect();
    const logEntity = await ABTestLogs.findOneAndUpdate(
      { githubUrl: parsedRepo.canonicalUrl },
      {
        $setOnInsert: { githubUrl: parsedRepo.canonicalUrl },
        $push: {
          abTests: {
            $each: [testEntry],
            $slice: -100,
          },
        },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({ success: true, data: logEntity }, { status: 201 });
  } catch (error) {
    console.error('POST /api/abtest/results error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save A/B test results' }, { status: 500 });
  }
}

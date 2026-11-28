import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getGitHubAccessToken, parseJsonBody } from '@/lib/auth/session';
import {
  compareDrift,
  inspectLiveContainer,
  parseComposeConfig,
  parseDockerfileConfig,
} from '@/lib/drift/engine';
import { sendTelegramAlert } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/;
const SAFE_BRANCH = /^(?!-)(?!.*\.\.)[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/;
const SAFE_FILE_PATH = /^(?!\/)(?!.*\.\.)[a-zA-Z0-9_./-]+$/;
const SAFE_CONTAINER_ID = /^[a-zA-Z0-9_.-]+$/;

const driftCheckSchema = z.object({
  owner: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((v) => v !== '.' && v !== '..' && SAFE_SEGMENT.test(v), 'Invalid owner'),
  repo: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((v) => v !== '.' && v !== '..' && SAFE_SEGMENT.test(v), 'Invalid repo'),
  branch: z.string().trim().min(1).max(200).regex(SAFE_BRANCH, 'Invalid branch name'),
  filePath: z
    .string()
    .trim()
    .min(1)
    .max(250)
    .regex(SAFE_FILE_PATH, 'Invalid file path')
    .default('Dockerfile'),
  containerId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(SAFE_CONTAINER_ID, 'Invalid container ID'),
  serviceName: z.string().trim().max(100).optional(),
  alertOnDrift: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = await getGitHubAccessToken(req);

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!accessToken) {
      return NextResponse.json(
        { error: 'GitHub access token missing. Please sign out and sign in again with GitHub.' },
        { status: 401 }
      );
    }

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const validation = driftCheckSchema.safeParse(parsedBody.data);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { owner, repo, branch, filePath, containerId, serviceName, alertOnDrift } =
      validation.data;

    // 1. Fetch official config file from GitHub
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const ghUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

    const ghRes = await fetch(ghUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!ghRes.ok) {
      const msg =
        ghRes.status === 404
          ? `File "${filePath}" not found on branch "${branch}" in ${owner}/${repo}.`
          : `Failed to fetch "${filePath}" from GitHub (${ghRes.status}).`;
      return NextResponse.json({ error: msg }, { status: ghRes.status });
    }

    const ghData = (await ghRes.json()) as { content?: string; encoding?: string; type?: string };
    if (ghData.type !== 'file' || typeof ghData.content !== 'string') {
      return NextResponse.json(
        { error: `"${filePath}" is not a readable file in GitHub.` },
        { status: 400 }
      );
    }

    const fileContent = Buffer.from(ghData.content, 'base64').toString('utf8');
    const isCompose = /\.ya?ml$/i.test(filePath);
    const gitSpec = isCompose
      ? parseComposeConfig(fileContent, serviceName || undefined)
      : parseDockerfileConfig(fileContent);

    // 2. Inspect live Docker container via dockerode
    let live;
    try {
      live = await inspectLiveContainer(containerId);
    } catch (dockerErr) {
      return NextResponse.json(
        {
          error:
            dockerErr instanceof Error
              ? `Failed to inspect live container: ${dockerErr.message}`
              : 'Failed to inspect live Docker container.',
        },
        { status: 503 }
      );
    }

    // 3. Compare GitHub official config vs Live Docker container
    const report = compareDrift(live, gitSpec);

    if (alertOnDrift && report.status === 'DRIFT_DETECTED') {
      const summaryLines = report.drifts
        .slice(0, 5)
        .map((d) => `${d.key}: ${d.expected} -> ${d.actual}`)
        .join('; ');
      await sendTelegramAlert({
        url: `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`,
        reason: `${report.driftCount} drift(s) on container ${live.name}: ${summaryLines}`,
        ownerEmail: session.user.email,
        status: 'down',
        title: `🚨 <b>CONFIGURATION DRIFT DETECTED (${live.name})</b>`,
      }).catch((err) => console.warn('Drift Telegram alert failed:', err));
    }

    return NextResponse.json({
      success: true,
      repo: `${owner}/${repo}`,
      branch,
      filePath,
      checkedAt: new Date().toISOString(),
      report,
      gitSpec,
      live: {
        id: live.id,
        name: live.name,
        image: live.image,
        running: live.running,
        ports: live.ports,
        workdir: live.workdir,
        memoryLimitMb: live.memoryLimitMb,
        cpus: live.cpus,
        envCount: Object.keys(live.env).length,
      },
    });
  } catch (err) {
    console.error('POST /api/drift/check error:', err);
    return NextResponse.json({ error: 'Drift detection check failed' }, { status: 500 });
  }
}

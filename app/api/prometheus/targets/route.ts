/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import WebServer from '@/lib/models/WebServer';
import SurgeConfig from '@/lib/models/SurgeConfig';
import { getMonitoringMode } from '@/lib/monitoring/schedule';
import { validateUrlSyntax } from '@/lib/security/urlValidator';
import { safeTimingEqual } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Prometheus http_sd_configs endpoint.
 * Splits user monitors into ?tier=baseline (5m scrape) or ?tier=surge (15s scrape)
 * based on active SurgeConfig event windows.
 */
export async function GET(req: NextRequest) {
  const sdToken = (process.env.PROMETHEUS_SD_TOKEN || process.env.METRICS_API_TOKEN || '').trim();
  if (sdToken) {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token || !safeTimingEqual(token, sdToken)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const tierParam = (req.nextUrl.searchParams.get('tier') || 'all').toLowerCase();
  if (!['all', 'baseline', 'surge'].includes(tierParam)) {
    return NextResponse.json(
      { error: 'Invalid tier parameter. Expected baseline, surge, or all.' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const [servers, surgeConfigs] = await Promise.all([
      WebServer.find({}, { _id: 1, name: 1, url: 1 }).lean(),
      SurgeConfig.find(
        {},
        {
          monitorId: 1,
          events: 1,
          baselineInterval: 1,
          preEventInterval: 1,
          surgeInterval: 1,
          preEventWindowHours: 1,
          surgeWindowHours: 1,
          actionOnlyOnScheduledDays: 1,
        }
      ).lean(),
    ]);

    const configMap = new Map<string, any>();
    for (const cfg of surgeConfigs) {
      configMap.set(String(cfg.monitorId), cfg);
    }

    const targets: Array<{ targets: string[]; labels: Record<string, string> }> = [];
    const now = new Date();

    for (const server of servers) {
      const urlCheck = validateUrlSyntax(String(server.url || ''), { allowHttp: true });
      if (!urlCheck.valid) continue;

      const monitorId = String(server._id);
      const surgeConfig = configMap.get(monitorId);
      const modeResult = getMonitoringMode(surgeConfig, now);
      const targetTier =
        modeResult.mode === 'surge' || modeResult.mode === 'pre-event' ? 'surge' : 'baseline';

      if (tierParam !== 'all' && tierParam !== targetTier) {
        continue;
      }

      const labels: Record<string, string> = {
        monitor_id: monitorId,
        monitor_name: String(server.name || 'unnamed').slice(0, 64),
        tier: targetTier,
        mode: modeResult.mode,
      };

      if (modeResult.activeEvent) {
        labels.event_type = modeResult.activeEvent.type;
        labels.event_name = modeResult.activeEvent.name.replace(/\s+/g, '_').slice(0, 64);
      }

      targets.push({
        targets: [String(server.url)],
        labels,
      });
    }

    return NextResponse.json(targets, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('Prometheus targets SD error:', err);
    return NextResponse.json({ error: 'Failed to load Prometheus targets' }, { status: 500 });
  }
}

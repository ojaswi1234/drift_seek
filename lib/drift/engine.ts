import Dockerode from 'dockerode';

export interface LiveContainerSummary {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface ParsedDockerSpec {
  sourceType: 'dockerfile' | 'compose';
  image: string | null;
  env: Record<string, string>;
  ports: string[];
  workdir: string | null;
  memoryLimitMb: number | null;
  cpus: number | null;
}

export interface LiveContainerConfig {
  id: string;
  name: string;
  image: string;
  running: boolean;
  env: Record<string, string>;
  ports: string[];
  workdir: string | null;
  memoryLimitMb: number | null;
  cpus: number | null;
}

export interface DriftItem {
  category: 'ENV' | 'RESOURCE' | 'PORT' | 'IMAGE' | 'WORKDIR';
  key: string;
  driftType: 'ADDED_IN_LIVE' | 'MISSING_IN_LIVE' | 'MODIFIED';
  severity: 'critical' | 'warning' | 'info';
  expected: string;
  actual: string;
  message: string;
}

export interface DriftComparisonReport {
  status: 'IN_SYNC' | 'DRIFT_DETECTED';
  driftCount: number;
  drifts: DriftItem[];
}

const SENSITIVE_KEY_REGEX = /(SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|AUTH|CREDENTIAL|URI)/i;

// Runtime environment variables injected automatically by OS/Node/Docker rather than Dockerfile
const IGNORED_RUNTIME_ENV_KEYS = new Set([
  'PATH',
  'HOSTNAME',
  'HOME',
  'TERM',
  'NODE_VERSION',
  'YARN_VERSION',
  'SHLVL',
  'PWD',
  '_',
]);

function createDockerClient(): Dockerode {
  const dockerHost = process.env.DOCKER_HOST?.trim();
  if (dockerHost) {
    try {
      const parsed = new URL(dockerHost);
      if (parsed.protocol === 'tcp:' || parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return new Dockerode({
          host: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : 2375,
          protocol: parsed.protocol === 'https:' ? 'https' : 'http',
        });
      }
      if (parsed.protocol === 'unix:') {
        return new Dockerode({ socketPath: parsed.pathname });
      }
    } catch {
      return new Dockerode({ socketPath: dockerHost });
    }
  }

  if (process.platform === 'win32') {
    return new Dockerode({ socketPath: '//./pipe/docker_engine' });
  }
  return new Dockerode({ socketPath: '/var/run/docker.sock' });
}

export async function listLiveContainers(): Promise<{
  dockerAvailable: boolean;
  containers: LiveContainerSummary[];
  error?: string;
}> {
  const docker = createDockerClient();
  try {
    await docker.ping();
    const list = await docker.listContainers({ all: true });
    const containers: LiveContainerSummary[] = list.map((c) => ({
      id: c.Id,
      shortId: c.Id.slice(0, 12),
      name: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
    }));
    return { dockerAvailable: true, containers };
  } catch (err) {
    return {
      dockerAvailable: false,
      containers: [],
      error:
        err instanceof Error
          ? `Docker daemon unreachable: ${err.message}`
          : 'Docker daemon is not running or socket access is unavailable.',
    };
  }
}

export async function inspectLiveContainer(containerId: string): Promise<LiveContainerConfig> {
  const docker = createDockerClient();
  const info = await docker.getContainer(containerId).inspect();

  const env: Record<string, string> = {};
  for (const entry of info.Config?.Env || []) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx > 0) {
      const key = entry.slice(0, eqIdx).trim();
      const value = entry.slice(eqIdx + 1);
      if (key && !IGNORED_RUNTIME_ENV_KEYS.has(key)) {
        env[key] = value;
      }
    }
  }

  const portSet = new Set<string>();
  for (const key of Object.keys(info.Config?.ExposedPorts || {})) {
    const portNum = key.split('/')[0];
    if (portNum) portSet.add(portNum);
  }
  for (const key of Object.keys(info.HostConfig?.PortBindings || {})) {
    const portNum = key.split('/')[0];
    if (portNum) portSet.add(portNum);
  }

  const memBytes = info.HostConfig?.Memory || 0;
  const nanoCpus = info.HostConfig?.NanoCpus || 0;

  return {
    id: info.Id,
    name: (info.Name || info.Id.slice(0, 12)).replace(/^\//, ''),
    image: info.Config?.Image || '',
    running: Boolean(info.State?.Running),
    env,
    ports: Array.from(portSet).sort(),
    workdir: info.Config?.WorkingDir || null,
    memoryLimitMb: memBytes > 0 ? Math.round(memBytes / (1024 * 1024)) : null,
    cpus: nanoCpus > 0 ? Number((nanoCpus / 1e9).toFixed(2)) : null,
  };
}

function unquote(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseDockerfileConfig(content: string): ParsedDockerSpec {
  const env: Record<string, string> = {};
  const portSet = new Set<string>();
  let image: string | null = null;
  let workdir: string | null = null;

  // Join line continuations (`\`)
  const normalized = content.replace(/\\\r?\n\s*/g, ' ');
  const lines = normalized.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const fromMatch = line.match(/^FROM\s+(?:--platform=\S+\s+)?([^\s]+)(?:\s+AS\s+\S+)?/i);
    if (fromMatch) {
      image = fromMatch[1];
      continue;
    }

    const workdirMatch = line.match(/^WORKDIR\s+(.+)$/i);
    if (workdirMatch) {
      workdir = unquote(workdirMatch[1]);
      continue;
    }

    const exposeMatch = line.match(/^EXPOSE\s+(.+)$/i);
    if (exposeMatch) {
      const tokens = exposeMatch[1].split(/\s+/);
      for (const t of tokens) {
        const port = t.split('/')[0].trim();
        if (/^\d+$/.test(port)) portSet.add(port);
      }
      continue;
    }

    const envMatch = line.match(/^ENV\s+(.+)$/i);
    if (envMatch) {
      const rest = envMatch[1].trim();
      if (rest.includes('=')) {
        const pairRegex = /([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s]+)/g;
        let match;
        while ((match = pairRegex.exec(rest)) !== null) {
          env[match[1]] = unquote(match[2]);
        }
      } else {
        const spaceIdx = rest.search(/\s/);
        if (spaceIdx > 0) {
          const key = rest.slice(0, spaceIdx).trim();
          const val = unquote(rest.slice(spaceIdx + 1));
          if (key) env[key] = val;
        }
      }
    }
  }

  return {
    sourceType: 'dockerfile',
    image,
    env,
    ports: Array.from(portSet).sort(),
    workdir,
    memoryLimitMb: null,
    cpus: null,
  };
}

function parseMemoryMb(raw: string): number | null {
  const match = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/);
  if (!match) return null;
  const num = Number(match[1]);
  const unit = match[2] || 'b';
  if (unit === 'g' || unit === 'gb') return Math.round(num * 1024);
  if (unit === 'm' || unit === 'mb') return Math.round(num);
  if (unit === 'k' || unit === 'kb') return Math.round(num / 1024);
  return Math.round(num / (1024 * 1024));
}

export function parseComposeConfig(content: string, serviceName?: string): ParsedDockerSpec {
  const env: Record<string, string> = {};
  const portSet = new Set<string>();
  let image: string | null = null;
  let memoryLimitMb: number | null = null;
  let cpus: number | null = null;

  const lines = content.split(/\r?\n/);
  let inServices = false;
  let currentService: string | null = null;
  let targetService: string | null = serviceName || null;
  let activeSection: 'env' | 'ports' | 'limits' | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.search(/\S/);
    const trimmed = rawLine.trim();

    if (indent === 0) {
      inServices = trimmed === 'services:';
      currentService = null;
      activeSection = null;
      continue;
    }

    if (!inServices) continue;

    if (indent === 2 && trimmed.endsWith(':')) {
      currentService = trimmed.slice(0, -1).trim();
      if (!targetService) targetService = currentService;
      activeSection = null;
      continue;
    }

    if (!currentService || currentService !== targetService) continue;

    if (indent <= 4) {
      if (trimmed.startsWith('image:')) {
        image = unquote(trimmed.slice(6));
        activeSection = null;
      } else if (trimmed === 'environment:') {
        activeSection = 'env';
      } else if (trimmed === 'ports:') {
        activeSection = 'ports';
      } else if (trimmed.startsWith('mem_limit:')) {
        memoryLimitMb = parseMemoryMb(unquote(trimmed.slice(10)));
        activeSection = null;
      } else if (trimmed.startsWith('cpus:')) {
        const c = Number(unquote(trimmed.slice(5)));
        if (Number.isFinite(c)) cpus = c;
        activeSection = null;
      } else if (trimmed === 'deploy:') {
        activeSection = 'limits';
      } else {
        activeSection = null;
      }
      continue;
    }

    if (activeSection === 'env') {
      if (trimmed.startsWith('- ')) {
        const item = unquote(trimmed.slice(2));
        const eq = item.indexOf('=');
        if (eq > 0) env[item.slice(0, eq).trim()] = item.slice(eq + 1);
      } else if (trimmed.includes(':')) {
        const colon = trimmed.indexOf(':');
        const key = trimmed.slice(0, colon).trim();
        const val = unquote(trimmed.slice(colon + 1));
        if (key) env[key] = val;
      }
    } else if (activeSection === 'ports' && trimmed.startsWith('- ')) {
      const mapping = unquote(trimmed.slice(2)).split('/')[0];
      const parts = mapping.split(':');
      const containerPort = parts[parts.length - 1]?.trim();
      if (/^\d+$/.test(containerPort)) portSet.add(containerPort);
    } else if (activeSection === 'limits') {
      if (trimmed.startsWith('memory:')) {
        memoryLimitMb = parseMemoryMb(unquote(trimmed.slice(7)));
      } else if (trimmed.startsWith('cpus:')) {
        const c = Number(unquote(trimmed.slice(5)));
        if (Number.isFinite(c)) cpus = c;
      }
    }
  }

  return {
    sourceType: 'compose',
    image,
    env,
    ports: Array.from(portSet).sort(),
    workdir: null,
    memoryLimitMb,
    cpus,
  };
}

function formatDisplayValue(key: string, val: string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '(unset)';
  if (SENSITIVE_KEY_REGEX.test(key)) {
    if (val.length <= 4) return '****';
    return `${val.slice(0, 2)}••••${val.slice(-2)}`;
  }
  return val;
}

export function compareDrift(
  live: LiveContainerConfig,
  gitSpec: ParsedDockerSpec
): DriftComparisonReport {
  const drifts: DriftItem[] = [];

  // 1. Compare Environment Variables
  const allEnvKeys = new Set([...Object.keys(gitSpec.env), ...Object.keys(live.env)]);
  for (const key of Array.from(allEnvKeys).sort()) {
    const inGit = key in gitSpec.env;
    const inLive = key in live.env;
    const gitVal = gitSpec.env[key];
    const liveVal = live.env[key];

    if (inLive && !inGit) {
      drifts.push({
        category: 'ENV',
        key,
        driftType: 'ADDED_IN_LIVE',
        severity: 'warning',
        expected: '(not in GitHub)',
        actual: formatDisplayValue(key, liveVal),
        message: `Live container has env "${key}" not declared in GitHub config (possible manual hotfix).`,
      });
    } else if (inGit && !inLive) {
      drifts.push({
        category: 'ENV',
        key,
        driftType: 'MISSING_IN_LIVE',
        severity: 'critical',
        expected: formatDisplayValue(key, gitVal),
        actual: '(missing)',
        message: `GitHub declares "${key}", but it is missing from the live container.`,
      });
    } else if (inGit && inLive && gitVal !== liveVal && !gitVal.startsWith('${')) {
      drifts.push({
        category: 'ENV',
        key,
        driftType: 'MODIFIED',
        severity: 'critical',
        expected: formatDisplayValue(key, gitVal),
        actual: formatDisplayValue(key, liveVal),
        message: `Env "${key}" value in live container differs from GitHub.`,
      });
    }
  }

  // 2. Compare Memory Limit (detects 2:00 AM manual `--memory` hotfixes)
  if (gitSpec.memoryLimitMb !== null && live.memoryLimitMb !== gitSpec.memoryLimitMb) {
    drifts.push({
      category: 'RESOURCE',
      key: 'memory_limit',
      driftType: live.memoryLimitMb === null ? 'MISSING_IN_LIVE' : 'MODIFIED',
      severity: 'critical',
      expected: `${gitSpec.memoryLimitMb} MB`,
      actual: live.memoryLimitMb !== null ? `${live.memoryLimitMb} MB` : 'unlimited',
      message: `Container memory limit (${live.memoryLimitMb ?? 'unlimited'} MB) differs from GitHub spec (${gitSpec.memoryLimitMb} MB).`,
    });
  } else if (gitSpec.memoryLimitMb === null && live.memoryLimitMb !== null) {
    drifts.push({
      category: 'RESOURCE',
      key: 'memory_limit',
      driftType: 'ADDED_IN_LIVE',
      severity: 'warning',
      expected: 'unspecified in GitHub',
      actual: `${live.memoryLimitMb} MB`,
      message: `Live container has a manual memory limit (${live.memoryLimitMb} MB) not tracked in GitHub.`,
    });
  }

  // 3. Compare CPU Limit
  if (gitSpec.cpus !== null && live.cpus !== gitSpec.cpus) {
    drifts.push({
      category: 'RESOURCE',
      key: 'cpus',
      driftType: live.cpus === null ? 'MISSING_IN_LIVE' : 'MODIFIED',
      severity: 'warning',
      expected: `${gitSpec.cpus} vCPU`,
      actual: live.cpus !== null ? `${live.cpus} vCPU` : 'unlimited',
      message: `Container CPU limit (${live.cpus ?? 'unlimited'}) differs from GitHub spec (${gitSpec.cpus}).`,
    });
  } else if (gitSpec.cpus === null && live.cpus !== null) {
    drifts.push({
      category: 'RESOURCE',
      key: 'cpus',
      driftType: 'ADDED_IN_LIVE',
      severity: 'warning',
      expected: 'unspecified in GitHub',
      actual: `${live.cpus} vCPU`,
      message: `Live container has a manual CPU limit (${live.cpus} vCPU) not tracked in GitHub.`,
    });
  }

  // 4. Compare Ports
  const gitPorts = new Set(gitSpec.ports);
  const livePorts = new Set(live.ports);
  for (const p of gitPorts) {
    if (!livePorts.has(p)) {
      drifts.push({
        category: 'PORT',
        key: `port:${p}`,
        driftType: 'MISSING_IN_LIVE',
        severity: 'warning',
        expected: p,
        actual: '(not exposed)',
        message: `Port ${p} declared in GitHub is not exposed on the live container.`,
      });
    }
  }
  for (const p of livePorts) {
    if (!gitPorts.has(p) && gitPorts.size > 0) {
      drifts.push({
        category: 'PORT',
        key: `port:${p}`,
        driftType: 'ADDED_IN_LIVE',
        severity: 'warning',
        expected: '(not in GitHub)',
        actual: p,
        message: `Live container exposes port ${p} not declared in GitHub.`,
      });
    }
  }

  // 5. Compare Workdir (for Dockerfile)
  if (gitSpec.workdir && live.workdir && gitSpec.workdir !== live.workdir) {
    drifts.push({
      category: 'WORKDIR',
      key: 'working_dir',
      driftType: 'MODIFIED',
      severity: 'info',
      expected: gitSpec.workdir,
      actual: live.workdir,
      message: `Working directory "${live.workdir}" differs from Dockerfile WORKDIR "${gitSpec.workdir}".`,
    });
  }

  // 6. Compare Image (for Compose)
  if (gitSpec.sourceType === 'compose' && gitSpec.image && live.image && gitSpec.image !== live.image) {
    drifts.push({
      category: 'IMAGE',
      key: 'image',
      driftType: 'MODIFIED',
      severity: 'critical',
      expected: gitSpec.image,
      actual: live.image,
      message: `Live container image "${live.image}" differs from GitHub compose image "${gitSpec.image}".`,
    });
  }

  return {
    status: drifts.length > 0 ? 'DRIFT_DETECTED' : 'IN_SYNC',
    driftCount: drifts.length,
    drifts,
  };
}

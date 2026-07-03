// Per-provider deployment adapters. Each exposes create() (kick off a deploy)
// and status() (map the platform's state to our lifecycle). Base URLs are
// env-overridable so integration tests can target a mock platform.

const VERCEL_API = Deno.env.get('VERCEL_API_URL') ?? 'https://api.vercel.com';
const RENDER_API = Deno.env.get('RENDER_API_URL') ?? 'https://api.render.com/v1';
const NETLIFY_API = Deno.env.get('NETLIFY_API_URL') ?? 'https://api.netlify.com/api/v1';

export type DeployInput = {
  token: string;
  repoUrl: string;
  branch: string;
  rootDir?: string | null;
  startCommand?: string | null;
  env: Record<string, string>;
};

export type DeployResult = {
  externalId: string;
  externalUrl: string;
};

export type OurStatus = 'deploying' | 'success' | 'failed' | 'canceled';

export function parseGithub(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const jsonHeaders = (t: string) => ({ ...bearer(t), 'Content-Type': 'application/json' });

/* -------------------------------- Vercel --------------------------------- */
async function vercelCreate(i: DeployInput): Promise<DeployResult> {
  const gh = parseGithub(i.repoUrl);
  if (!gh) throw new Error('invalid_github_url');
  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: jsonHeaders(i.token),
    body: JSON.stringify({
      name: gh.repo,
      gitSource: { type: 'github', org: gh.owner, repo: gh.repo, ref: i.branch },
      projectSettings: { framework: null, rootDirectory: i.rootDir || null },
    }),
  });
  if (!res.ok) throw new Error(`vercel_create_${res.status}:${await res.text()}`);
  const d = await res.json();

  // Best-effort: persist env vars on the project (Vercel sets env per-project).
  const keys = Object.keys(i.env);
  if (keys.length) {
    await Promise.allSettled(
      keys.map((k) =>
        fetch(`${VERCEL_API}/v10/projects/${gh.repo}/env`, {
          method: 'POST',
          headers: jsonHeaders(i.token),
          body: JSON.stringify({ key: k, value: i.env[k], type: 'encrypted', target: ['production', 'preview'] }),
        })
      )
    );
  }

  return {
    externalId: d.id,
    externalUrl: d.inspectorUrl || (d.url ? `https://${d.url}` : `https://vercel.com/${gh.owner}`),
  };
}

async function vercelStatus(token: string, id: string): Promise<OurStatus> {
  const res = await fetch(`${VERCEL_API}/v13/deployments/${id}`, { headers: bearer(token) });
  if (!res.ok) return 'deploying';
  const body = await res.json();
  const s = body.readyState || body.status;
  if (s === 'READY') return 'success';
  if (s === 'ERROR') return 'failed';
  if (s === 'CANCELED') return 'canceled';
  return 'deploying';
}

/* -------------------------------- Render --------------------------------- */
async function renderCreate(i: DeployInput): Promise<DeployResult> {
  const ownersRes = await fetch(`${RENDER_API}/owners?limit=1`, { headers: bearer(i.token) });
  if (!ownersRes.ok) throw new Error(`render_owner_${ownersRes.status}`);
  const owners = await ownersRes.json();
  const ownerId = (Array.isArray(owners) ? owners[0]?.owner?.id : owners?.owner?.id);
  if (!ownerId) throw new Error('render_no_owner');

  const gh = parseGithub(i.repoUrl);
  const res = await fetch(`${RENDER_API}/services`, {
    method: 'POST',
    headers: jsonHeaders(i.token),
    body: JSON.stringify({
      type: 'web_service',
      name: gh?.repo ?? 'repohosting-service',
      ownerId,
      repo: i.repoUrl,
      branch: i.branch,
      rootDir: i.rootDir || undefined,
      autoDeploy: 'yes',
      serviceDetails: {
        envSpecificDetails: i.startCommand ? { startCommand: i.startCommand } : undefined,
      },
      envVars: Object.entries(i.env).map(([key, value]) => ({ key, value })),
    }),
  });
  if (!res.ok) throw new Error(`render_create_${res.status}:${await res.text()}`);
  const d = await res.json();
  const service = d.service ?? d;
  return { externalId: service.id, externalUrl: service.dashboardUrl || service.dashboard_url || '' };
}

async function renderStatus(token: string, id: string): Promise<OurStatus> {
  const res = await fetch(`${RENDER_API}/services/${id}/deploys?limit=1`, { headers: bearer(token) });
  if (!res.ok) return 'deploying';
  const list = await res.json();
  const st = (Array.isArray(list) ? list[0]?.deploy?.status : null) ?? '';
  if (st === 'live') return 'success';
  if (['build_failed', 'update_failed', 'pre_deploy_failed', 'deactivated'].includes(st)) return 'failed';
  if (st === 'canceled') return 'canceled';
  return 'deploying';
}

/* -------------------------------- Netlify -------------------------------- */
async function netlifyCreate(i: DeployInput): Promise<DeployResult> {
  const gh = parseGithub(i.repoUrl);
  if (!gh) throw new Error('invalid_github_url');
  const res = await fetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    headers: jsonHeaders(i.token),
    body: JSON.stringify({
      repo: {
        provider: 'github',
        repo: `${gh.owner}/${gh.repo}`,
        branch: i.branch,
        dir: i.rootDir || undefined,
        cmd: i.startCommand || undefined,
      },
    }),
  });
  if (!res.ok) throw new Error(`netlify_create_${res.status}:${await res.text()}`);
  const d = await res.json();
  return { externalId: d.id, externalUrl: d.admin_url || d.url || '' };
}

async function netlifyStatus(token: string, id: string): Promise<OurStatus> {
  const res = await fetch(`${NETLIFY_API}/sites/${id}/deploys?per_page=1`, { headers: bearer(token) });
  if (!res.ok) return 'deploying';
  const list = await res.json();
  const st = (Array.isArray(list) ? list[0]?.state : null) ?? '';
  if (st === 'ready') return 'success';
  if (st === 'error') return 'failed';
  return 'deploying';
}

/* ------------------------------- dispatch -------------------------------- */
export function createDeployment(provider: string, i: DeployInput): Promise<DeployResult> {
  if (provider === 'vercel') return vercelCreate(i);
  if (provider === 'render') return renderCreate(i);
  if (provider === 'netlify') return netlifyCreate(i);
  throw new Error('unknown_provider');
}

export function checkStatus(provider: string, token: string, id: string): Promise<OurStatus> {
  if (provider === 'vercel') return vercelStatus(token, id);
  if (provider === 'render') return renderStatus(token, id);
  if (provider === 'netlify') return netlifyStatus(token, id);
  return Promise.resolve('deploying');
}

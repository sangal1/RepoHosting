// list-repos: lists repositories/projects the user can deploy on a provider,
// powering the "Select repository" picker. Uses the stored OAuth token.
// GET ?provider=vercel|netlify -> { repos: [{ id, name, url, branch }] }
import { handleOptions, json } from '../_shared/cors.ts';
import { getUser, getConnectorToken } from '../_shared/supabase.ts';

const VERCEL_API = Deno.env.get('VERCEL_API_URL') ?? 'https://api.vercel.com';
const NETLIFY_API = Deno.env.get('NETLIFY_API_URL') ?? 'https://api.netlify.com/api/v1';

type Repo = { id: string; name: string; url: string; branch: string };

async function vercelRepos(token: string): Promise<Repo[]> {
  const res = await fetch(`${VERCEL_API}/v9/projects?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`vercel ${res.status}`);
  const data = await res.json();
  return (data.projects ?? [])
    .map((p: any): Repo | null => {
      const link = p.link ?? {};
      const org = link.org ?? link.owner;
      const repo = link.repo;
      if (!org || !repo) return null; // only git-linked projects are deployable here
      return {
        id: p.id,
        name: p.name,
        url: `https://github.com/${org}/${repo}`,
        branch: link.productionBranch || 'main',
      };
    })
    .filter(Boolean) as Repo[];
}

async function netlifyRepos(token: string): Promise<Repo[]> {
  const res = await fetch(`${NETLIFY_API}/sites?per_page=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`netlify ${res.status}`);
  const sites = await res.json();
  return (sites ?? [])
    .map((s: any): Repo | null => {
      const bs = s.build_settings ?? {};
      if (!bs.repo_url) return null;
      return {
        id: s.id,
        name: s.name ?? bs.repo_path ?? 'site',
        url: bs.repo_url,
        branch: bs.repo_branch || 'main',
      };
    })
    .filter(Boolean) as Repo[];
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const user = await getUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const provider = new URL(req.url).searchParams.get('provider') ?? '';
  if (provider !== 'vercel' && provider !== 'netlify') {
    return json({ error: 'provider must be vercel or netlify' }, 400);
  }

  const token = await getConnectorToken(user.id, provider);
  if (!token) return json({ error: `${provider} is not connected` }, 400);

  try {
    const repos = provider === 'vercel'
      ? await vercelRepos(token)
      : await netlifyRepos(token);
    return json({ repos });
  } catch (e) {
    console.error('list-repos failed', e);
    return json({ error: `Could not list ${provider} repositories.` }, 502);
  }
});

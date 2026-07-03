// deploy: trigger a deployment on the chosen provider and record it.
// POST { provider, repoUrl, branch?, rootDir?, startCommand?, env? }
//   -> { deployment: { id, status, external_url, ... } }
import { handleOptions, json } from '../_shared/cors.ts';
import { getUser, getConnectorToken, serviceClient } from '../_shared/supabase.ts';
import { createDeployment, parseGithub } from '../_shared/deployers.ts';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const user = await getUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const provider = String(payload.provider ?? '');
  const repoUrl = String(payload.repoUrl ?? '').trim();
  const branch = String(payload.branch ?? 'main').trim() || 'main';
  const rootDir = payload.rootDir ? String(payload.rootDir).trim() : null;
  const startCommand = payload.startCommand ? String(payload.startCommand).trim() : null;
  const env: Record<string, string> =
    payload.env && typeof payload.env === 'object' ? payload.env : {};

  if (!['vercel', 'render', 'netlify'].includes(provider)) {
    return json({ error: 'unknown provider' }, 400);
  }
  if (!repoUrl) return json({ error: 'repoUrl is required' }, 400);
  const gh = parseGithub(repoUrl);
  if (!gh) return json({ error: 'repoUrl must be a GitHub repository URL' }, 400);

  const token = await getConnectorToken(user.id, provider);
  if (!token) return json({ error: `${provider} is not connected` }, 400);

  const admin = serviceClient();

  // Record the attempt up front so the UI can show it immediately.
  const { data: row, error: insErr } = await admin
    .from('deployments')
    .insert({
      user_id: user.id,
      provider,
      repo_url: repoUrl,
      repo_name: gh.repo,
      branch,
      root_dir: rootDir,
      start_command: startCommand,
      env,
      status: 'deploying',
    })
    .select(
      'id, provider, repo_url, repo_name, branch, status, external_id, external_url, created_at'
    )
    .single();
  if (insErr) return json({ error: insErr.message }, 500);

  try {
    const result = await createDeployment(provider, {
      token,
      repoUrl,
      branch,
      rootDir,
      startCommand,
      env,
    });
    const { data: updated } = await admin
      .from('deployments')
      .update({ external_id: result.externalId, external_url: result.externalUrl })
      .eq('id', row.id)
      .select(
        'id, provider, repo_url, repo_name, branch, status, external_id, external_url, created_at'
      )
      .single();
    return json({ deployment: updated ?? row });
  } catch (e) {
    console.error('deploy failed', e);
    await admin
      .from('deployments')
      .update({ status: 'failed', error: String(e).slice(0, 500) })
      .eq('id', row.id);
    return json({ error: 'deployment could not be started', detail: String(e).slice(0, 300) }, 502);
  }
});

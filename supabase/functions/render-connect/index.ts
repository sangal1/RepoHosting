// render-connect: Render has no OAuth, so the user supplies a personal API key.
// We validate it against the Render API, then store it as the render credential.
// POST { apiKey }  ->  { ok: true, account } | { error }
import { handleOptions, json } from '../_shared/cors.ts';
import { getUser, serviceClient } from '../_shared/supabase.ts';

// Overridable so integration tests can point at a mock Render API.
const RENDER_API_URL = Deno.env.get('RENDER_API_URL') ?? 'https://api.render.com/v1';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const user = await getUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let apiKey = '';
  try {
    const body = await req.json();
    apiKey = (body.apiKey ?? '').toString().trim();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  if (!apiKey) return json({ error: 'API key is required' }, 400);

  // Validate the key by calling the Render API. `owners` is a cheap authed call.
  let accountName = '';
  let accountId = '';
  try {
    const res = await fetch(`${RENDER_API_URL}/owners?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      return json({ error: 'That API key was rejected by Render.' }, 400);
    }
    if (!res.ok) {
      return json({ error: `Render API error (${res.status}).` }, 502);
    }
    const data = await res.json();
    const owner = Array.isArray(data) ? data[0]?.owner : data?.owner;
    accountName = owner?.name || owner?.email || 'Render account';
    accountId = owner?.id || '';
  } catch (e) {
    console.error('render validation failed', e);
    return json({ error: 'Could not reach Render to validate the key.' }, 502);
  }

  // Store (upsert) the validated key.
  const admin = serviceClient();
  const { error } = await admin.from('connector_credentials').upsert(
    {
      user_id: user.id,
      provider: 'render',
      access_token: apiKey,
      token_type: 'api_key',
      external_account_id: accountId,
      external_account_name: accountName,
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, account: accountName });
});

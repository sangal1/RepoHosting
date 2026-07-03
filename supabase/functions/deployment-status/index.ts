// deployment-status: poll a single deployment. Queries the platform for the
// live state, updates the row if it changed, and returns the current status.
// GET ?id=<deployment id> -> { id, status, external_url }
import { handleOptions, json } from '../_shared/cors.ts';
import { getUser, getConnectorToken, serviceClient } from '../_shared/supabase.ts';
import { checkStatus } from '../_shared/deployers.ts';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const user = await getUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return json({ error: 'id is required' }, 400);

  const admin = serviceClient();
  const { data: row } = await admin
    .from('deployments')
    .select('id, user_id, provider, external_id, status, external_url')
    .eq('id', id)
    .maybeSingle();

  if (!row || row.user_id !== user.id) return json({ error: 'not found' }, 404);

  // Terminal states don't change; return as-is.
  if (['success', 'failed', 'canceled'].includes(row.status) || !row.external_id) {
    return json({ id: row.id, status: row.status, external_url: row.external_url });
  }

  const token = await getConnectorToken(user.id, row.provider);
  if (!token) return json({ id: row.id, status: row.status, external_url: row.external_url });

  const status = await checkStatus(row.provider, token, row.external_id);
  if (status !== row.status) {
    await admin.from('deployments').update({ status }).eq('id', row.id);
  }
  return json({ id: row.id, status, external_url: row.external_url });
});

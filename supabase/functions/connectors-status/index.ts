// connectors-status: returns which platforms the current user has connected.
// GET -> { vercel: boolean, render: boolean, netlify: boolean }
import { handleOptions, json } from '../_shared/cors.ts';
import { getUser, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const user = await getUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const supabase = userClient(req);
  const { data, error } = await supabase
    .from('connector_credentials')
    .select('provider')
    .eq('user_id', user.id);

  if (error) return json({ error: error.message }, 500);

  const connected = new Set((data ?? []).map((r) => r.provider));
  return json({
    vercel: connected.has('vercel'),
    render: connected.has('render'),
    netlify: connected.has('netlify'),
  });
});

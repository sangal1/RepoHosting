// oauth-callback: provider redirects here with ?code&state after the user
// approves. We exchange the code for a token, fetch the account identity, store
// the credential, and bounce the browser back to the app. No user JWT is
// present, so the user is resolved from the single-use `state` row.
import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { getProvider, SITE_URL } from '../_shared/providers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: to } });
}

function appRedirect(base: string, params: Record<string, string>): Response {
  const u = new URL(base || SITE_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return redirect(u.toString());
}

function callbackUrl(providerKey: string): string {
  const override = Deno.env.get(`${providerKey.toUpperCase()}_REDIRECT_URI`);
  return override || `${SUPABASE_URL}/functions/v1/oauth-callback`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const admin = serviceClient();

  if (providerError) return appRedirect(SITE_URL, { connect_error: providerError });
  if (!code || !state) return appRedirect(SITE_URL, { connect_error: 'missing_code_or_state' });

  // Resolve + consume the state (single use).
  const { data: stateRow } = await admin
    .from('oauth_states')
    .select('*')
    .eq('state', state)
    .maybeSingle();
  if (!stateRow) return appRedirect(SITE_URL, { connect_error: 'invalid_state' });
  await admin.from('oauth_states').delete().eq('state', state);

  const provider = getProvider(stateRow.provider);
  const dest = stateRow.redirect_to || SITE_URL;
  if (!provider) return appRedirect(dest, { connect_error: 'unknown_provider' });

  try {
    // Exchange the authorization code for an access token.
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: callbackUrl(provider.key),
    });
    const tokenRes = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('token exchange failed', tokenRes.status, t);
      return appRedirect(dest, { connect_error: 'token_exchange_failed' });
    }
    const tokenJson = await tokenRes.json();
    const accessToken: string = tokenJson.access_token;
    if (!accessToken) return appRedirect(dest, { connect_error: 'no_access_token' });

    // Fetch account identity (best-effort — failure here is non-fatal).
    let accountName = '';
    let accountId = '';
    try {
      const userRes = await fetch(provider.userUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (userRes.ok) {
        const u = await userRes.json();
        accountName = provider.accountName(u);
        accountId = provider.accountId(u);
      }
    } catch (_) {
      /* ignore identity fetch errors */
    }

    // Upsert the credential (one row per user+provider).
    const { error: upsertErr } = await admin.from('connector_credentials').upsert(
      {
        user_id: stateRow.user_id,
        provider: provider.key,
        access_token: accessToken,
        refresh_token: tokenJson.refresh_token ?? null,
        token_type: tokenJson.token_type ?? 'bearer',
        scope: tokenJson.scope ?? provider.scope,
        external_account_id: accountId,
        external_account_name: accountName,
        metadata: { team_id: tokenJson.team_id ?? null },
      },
      { onConflict: 'user_id,provider' }
    );
    if (upsertErr) {
      console.error('upsert failed', upsertErr);
      return appRedirect(dest, { connect_error: 'store_failed' });
    }

    return appRedirect(dest, { connected: provider.key });
  } catch (e) {
    console.error('oauth-callback error', e);
    return appRedirect(dest, { connect_error: 'unexpected' });
  }
});

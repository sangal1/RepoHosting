// oauth-start: begins an OAuth connector flow for the authenticated user.
// GET ?provider=vercel|netlify  ->  { url }  (the provider authorize URL)
import { handleOptions, json } from '../_shared/cors.ts';
import { getUser, serviceClient } from '../_shared/supabase.ts';
import { getProvider, makeCodeVerifier, codeChallengeS256 } from '../_shared/providers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

function callbackUrl(providerKey: string): string {
  // Must match what's registered with the provider; overridable per provider.
  const override = Deno.env.get(`${providerKey.toUpperCase()}_REDIRECT_URI`);
  return override || `${SUPABASE_URL}/functions/v1/oauth-callback`;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const user = await getUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const providerKey = url.searchParams.get('provider') ?? '';
  const provider = getProvider(providerKey);
  if (!provider) return json({ error: 'unknown provider' }, 400);
  if (!provider.clientId) {
    return json({ error: `${providerKey} OAuth is not configured` }, 501);
  }

  const state = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
  const redirectTo = url.searchParams.get('redirect_to') || undefined;

  // PKCE (required by "Sign in with Vercel"): stash the verifier with the state,
  // send only the derived challenge to the provider.
  let codeVerifier: string | null = null;
  let codeChallenge: string | null = null;
  if (provider.usesPkce) {
    codeVerifier = makeCodeVerifier();
    codeChallenge = await codeChallengeS256(codeVerifier);
  }

  const admin = serviceClient();
  const { error } = await admin.from('oauth_states').insert({
    state,
    user_id: user.id,
    provider: provider.key,
    redirect_to: redirectTo,
    code_verifier: codeVerifier,
  });
  if (error) return json({ error: error.message }, 500);

  const authorize = new URL(provider.authorizeUrl);
  authorize.searchParams.set('client_id', provider.clientId);
  authorize.searchParams.set('redirect_uri', callbackUrl(provider.key));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('state', state);
  if (provider.scope) authorize.searchParams.set('scope', provider.scope);
  if (codeChallenge) {
    authorize.searchParams.set('code_challenge', codeChallenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
  }

  return json({ url: authorize.toString() });
});

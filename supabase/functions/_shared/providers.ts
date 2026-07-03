// OAuth provider registry for connectors that support OAuth (Vercel, Netlify).
// Endpoint URLs are overridable via env so integration tests can point the flow
// at a local mock provider instead of the real one.

const env = (k: string, fallback = '') => Deno.env.get(k) ?? fallback;

export type OAuthProvider = {
  key: 'vercel' | 'netlify';
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  userInfoMethod: 'GET' | 'POST';
  usesPkce: boolean;
  scope: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  // pull a human-friendly account name out of the provider's user payload
  accountName: (user: any) => string;
  accountId: (user: any) => string;
};

export function getProvider(key: string): OAuthProvider | null {
  if (key === 'vercel') {
    // "Sign in with Vercel" OAuth2/OIDC app (client_id `cl_…`).
    // Distinct from Marketplace Integrations: different token/userinfo
    // endpoints, PKCE required, userinfo is a POST.
    return {
      key: 'vercel',
      authorizeUrl: env('VERCEL_AUTHORIZE_URL', 'https://vercel.com/oauth/authorize'),
      tokenUrl: env('VERCEL_TOKEN_URL', 'https://api.vercel.com/login/oauth/token'),
      userUrl: env('VERCEL_USER_URL', 'https://api.vercel.com/login/oauth/userinfo'),
      userInfoMethod: 'POST',
      usesPkce: true,
      // Omit scope by default: Vercel then grants exactly the scopes configured
      // on the app (avoids invalid_scope when the app doesn't enable a scope we
      // ask for). Override with VERCEL_SCOPE only if you request a subset.
      scope: env('VERCEL_SCOPE', ''),
      clientId: env('VERCEL_CLIENT_ID'),
      clientSecret: env('VERCEL_CLIENT_SECRET'),
      redirectUri: env('VERCEL_REDIRECT_URI'),
      accountName: (u) =>
        u?.preferred_username || u?.name || u?.email || 'Vercel account',
      accountId: (u) => u?.sub || '',
    };
  }
  if (key === 'netlify') {
    return {
      key: 'netlify',
      authorizeUrl: env('NETLIFY_AUTHORIZE_URL', 'https://app.netlify.com/authorize'),
      tokenUrl: env('NETLIFY_TOKEN_URL', 'https://api.netlify.com/oauth/token'),
      userUrl: env('NETLIFY_USER_URL', 'https://api.netlify.com/api/v1/user'),
      userInfoMethod: 'GET',
      usesPkce: false,
      scope: env('NETLIFY_SCOPE', ''),
      clientId: env('NETLIFY_CLIENT_ID'),
      clientSecret: env('NETLIFY_CLIENT_SECRET'),
      redirectUri: env('NETLIFY_REDIRECT_URI'),
      accountName: (u) => u?.full_name || u?.email || 'Netlify account',
      accountId: (u) => u?.id || '',
    };
  }
  return null;
}

export const SITE_URL = env('SITE_URL', 'http://127.0.0.1:4173');

// ---- PKCE helpers -----------------------------------------------------------
function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function makeCodeVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return base64url(new Uint8Array(digest));
}

// OAuth provider registry for connectors that support OAuth (Vercel, Netlify).
// Endpoint URLs are overridable via env so integration tests can point the flow
// at a local mock provider instead of the real one.

const env = (k: string, fallback = '') => Deno.env.get(k) ?? fallback;

export type OAuthProvider = {
  key: 'vercel' | 'netlify';
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
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
    return {
      key: 'vercel',
      authorizeUrl: env('VERCEL_AUTHORIZE_URL', 'https://vercel.com/oauth/authorize'),
      tokenUrl: env('VERCEL_TOKEN_URL', 'https://api.vercel.com/v2/oauth/access_token'),
      userUrl: env('VERCEL_USER_URL', 'https://api.vercel.com/v2/user'),
      scope: env('VERCEL_SCOPE', ''),
      clientId: env('VERCEL_CLIENT_ID'),
      clientSecret: env('VERCEL_CLIENT_SECRET'),
      redirectUri: env('VERCEL_REDIRECT_URI'),
      accountName: (u) => u?.user?.username || u?.user?.name || u?.user?.email || 'Vercel account',
      accountId: (u) => u?.user?.id || u?.user?.uid || '',
    };
  }
  if (key === 'netlify') {
    return {
      key: 'netlify',
      authorizeUrl: env('NETLIFY_AUTHORIZE_URL', 'https://app.netlify.com/authorize'),
      tokenUrl: env('NETLIFY_TOKEN_URL', 'https://api.netlify.com/oauth/token'),
      userUrl: env('NETLIFY_USER_URL', 'https://api.netlify.com/api/v1/user'),
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

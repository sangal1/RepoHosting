// Shared Playwright helpers: mock the Supabase Auth + edge-function boundary so
// the full flows can be exercised end-to-end without live third-party creds.

export const FAKE_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'ada@example.com',
  user_metadata: {
    full_name: 'Ada Lovelace',
    avatar_url: 'https://example.com/ada.png',
  },
};

/**
 * Install auth mocks.
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {object} [opts.user] user returned by /auth/v1/user (null => 401)
 * @param {object} [opts.connectors] { vercel, render, netlify } booleans
 */
export async function mockSupabase(page, { user = FAKE_USER, connectors = {} } = {}) {
  const status = { vercel: false, render: false, netlify: false, ...connectors };

  // OAuth "authorize" endpoint -> simulate provider round-trip by redirecting
  // back to the app with tokens in the URL fragment (as real Supabase does).
  await page.route('**/auth/v1/authorize**', async (route) => {
    const url = new URL(route.request().url());
    const redirectTo = url.searchParams.get('redirect_to') || 'http://127.0.0.1:4173/';
    const dest =
      redirectTo +
      '#access_token=FAKE_ACCESS_TOKEN&refresh_token=FAKE_REFRESH&expires_in=3600&token_type=bearer';
    await route.fulfill({ status: 302, headers: { location: dest }, body: '' });
  });

  // Current user
  await page.route('**/auth/v1/user', async (route) => {
    if (!user) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });
  });

  // Logout
  await page.route('**/auth/v1/logout', (route) =>
    route.fulfill({ status: 204, body: '' })
  );

  // Connector status edge function
  await page.route('**/connectors-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(status),
    })
  );
}

/** Seed a logged-in session directly in localStorage (skips the OAuth dance). */
export async function seedSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'repohosting.session',
      JSON.stringify({
        access_token: 'FAKE_ACCESS_TOKEN',
        refresh_token: 'FAKE_REFRESH',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })
    );
  });
}

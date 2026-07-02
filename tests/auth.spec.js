import { test, expect } from '@playwright/test';
import { mockSupabase, seedSession, FAKE_USER } from './helpers.js';

test.describe('Google login flow', () => {
  test('clicking sign-in redirects to Supabase Google authorize endpoint', async ({ page }) => {
    const authorizeCalls = [];
    await page.route('**/auth/v1/authorize**', async (route) => {
      authorizeCalls.push(route.request().url());
      await route.abort(); // stop the navigation; we only assert the request
    });
    await page.goto('/');
    await page.getByTestId('google-login').click();
    await expect.poll(() => authorizeCalls.length).toBeGreaterThan(0);
    const url = new URL(authorizeCalls[0]);
    expect(url.pathname).toContain('/auth/v1/authorize');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBeTruthy();
  });

  test('completing OAuth logs the user in and enables connectors', async ({ page }) => {
    await mockSupabase(page, { user: FAKE_USER });
    await page.goto('/');

    // full round-trip: click -> authorize 302 -> back with token -> /user
    await page.getByTestId('google-login').click();

    await expect(page.getByTestId('user-chip')).toBeVisible();
    await expect(page.getByTestId('user-name')).toHaveText('Ada Lovelace');
    await expect(page.getByTestId('google-login')).toBeHidden();
    for (const p of ['vercel', 'render', 'netlify']) {
      await expect(page.getByTestId(`connect-${p}`)).toBeEnabled();
    }
    // tokens must be scrubbed from the address bar
    expect(page.url()).not.toContain('access_token');
  });

  test('an existing session renders logged-in on load', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER });
    await page.goto('/');
    await expect(page.getByTestId('user-name')).toHaveText('Ada Lovelace');
  });

  test('logout returns to the signed-out state', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER });
    await page.goto('/');
    await expect(page.getByTestId('user-chip')).toBeVisible();

    await page.getByTestId('logout').click();
    await expect(page.getByTestId('google-login')).toBeVisible();
    await expect(page.getByTestId('user-chip')).toBeHidden();
    await expect(page.getByTestId('connect-vercel')).toBeDisabled();
  });

  test('connected platforms show as connected for a logged-in user', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true } });
    await page.goto('/');
    await expect(page.getByTestId('status-vercel')).toHaveText(/connected/i);
    await expect(page.getByTestId('connect-vercel')).toHaveText(/connected/i);
    await expect(page.getByTestId('status-render')).toHaveText(/not connected/i);
  });
});

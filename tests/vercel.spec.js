import { test, expect } from '@playwright/test';
import { mockSupabase, seedSession, FAKE_USER } from './helpers.js';

// Frontend Vercel connect journey. The oauth-start edge function is mocked to
// short-circuit the provider round-trip by redirecting straight back to the app
// with ?connected=vercel (the backend flow itself is covered by the integration
// driver against a mock provider).
test.describe('Vercel connector (frontend)', () => {
  test('connecting Vercel updates status and shows a success toast', async ({ page }) => {
    let vercelConnected = false;

    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER });

    // dynamic connector status: false until oauth-start is hit
    await page.route('**/connectors-status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ vercel: vercelConnected, render: false, netlify: false }),
      })
    );

    // oauth-start: flip state and hand back a URL that mimics the completed
    // provider + callback round-trip.
    await page.route('**/oauth-start?provider=vercel*', (route) => {
      vercelConnected = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'http://127.0.0.1:4173/?connected=vercel' }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('user-name')).toHaveText('Ada Lovelace');
    await expect(page.getByTestId('connect-vercel')).toHaveText('Connect');
    await expect(page.getByTestId('status-vercel')).toHaveText(/not connected/i);

    await page.getByTestId('connect-vercel').click();

    // lands back on the app with the success toast + connected state
    await expect(page.getByTestId('toast')).toContainText(/vercel connected/i);
    await expect(page.getByTestId('status-vercel')).toHaveText(/^connected$/i);
    await expect(page.getByTestId('connect-vercel')).toHaveText(/connected/i);
  });

  test('a failed connect surfaces an error toast', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER });
    await page.route('**/oauth-start?provider=vercel*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'http://127.0.0.1:4173/?connect_error=access_denied' }),
      });
    });

    await page.goto('/');
    await page.getByTestId('connect-vercel').click();
    await expect(page.getByTestId('toast')).toContainText(/access_denied/i);
  });
});

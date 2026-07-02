import { test, expect } from '@playwright/test';
import { mockSupabase, seedSession, FAKE_USER } from './helpers.js';

// Frontend Netlify connect journey. Uses the same generic oauth-start flow as
// Vercel; the backend is covered by tests/integration/netlify-flow.sh.
test.describe('Netlify connector (frontend)', () => {
  test('connecting Netlify updates status and shows a success toast', async ({ page }) => {
    let connected = false;
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER });

    await page.route('**/connectors-status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ vercel: false, render: false, netlify: connected }),
      })
    );
    await page.route('**/oauth-start?provider=netlify*', (route) => {
      connected = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'http://127.0.0.1:4173/?connected=netlify' }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('connect-netlify')).toHaveText('Connect');
    await page.getByTestId('connect-netlify').click();

    await expect(page.getByTestId('toast')).toContainText(/netlify connected/i);
    await expect(page.getByTestId('status-netlify')).toHaveText(/^connected$/i);
    await expect(page.getByTestId('connect-netlify')).toHaveText(/connected/i);
  });

  test('a failed Netlify connect surfaces an error toast', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER });
    await page.route('**/oauth-start?provider=netlify*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'http://127.0.0.1:4173/?connect_error=access_denied' }),
      })
    );
    await page.goto('/');
    await page.getByTestId('connect-netlify').click();
    await expect(page.getByTestId('toast')).toContainText(/access_denied/i);
  });
});

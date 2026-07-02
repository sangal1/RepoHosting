import { test } from '@playwright/test';
import { mockSupabase, seedSession, FAKE_USER } from './helpers.js';

// Utility "tests" that capture PR screenshots into docs-images/.
// Run with: npx playwright test screenshot
test('capture home (logged out)', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs-images/home-logged-out.png', fullPage: false });
});

test('capture home (logged in)', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true } });
  await page.goto('/');
  await page.getByTestId('user-name').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs-images/home-logged-in.png', fullPage: false });
});

test('capture render api-key modal', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { user: FAKE_USER });
  await page.goto('/');
  await page.getByTestId('user-name').waitFor();
  await page.getByTestId('connect-render').click();
  await page.getByTestId('render-api-key').fill('rnd_xxxxxxxxxxxxxxxxxxxx');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs-images/render-modal.png', fullPage: false });
});

test('capture render connected + toast', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { user: FAKE_USER });
  await page.route('**/render-connect', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, account: 'Ada Render Team' }),
    })
  );
  await page.goto('/');
  await page.getByTestId('user-name').waitFor();
  await page.getByTestId('connect-render').click();
  await page.getByTestId('render-api-key').fill('rnd_valid_key');
  await page.getByTestId('render-save').click();
  await page.getByTestId('toast').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs-images/render-connected.png', fullPage: false });
});

test('capture netlify connected + toast', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { user: FAKE_USER });
  let connected = false;
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
  await page.getByTestId('user-name').waitFor();
  await page.getByTestId('connect-netlify').click();
  await page.getByTestId('toast').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs-images/netlify-connected.png', fullPage: false });
});

test('capture vercel connected + toast', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { user: FAKE_USER });
  let connected = false;
  await page.route('**/connectors-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vercel: connected, render: false, netlify: false }),
    })
  );
  await page.route('**/oauth-start?provider=vercel*', (route) => {
    connected = true;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'http://127.0.0.1:4173/?connected=vercel' }),
    });
  });
  await page.goto('/');
  await page.getByTestId('user-name').waitFor();
  await page.getByTestId('connect-vercel').click();
  await page.getByTestId('toast').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs-images/vercel-connected.png', fullPage: false });
});

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
  await page.route('**/rest/v1/deployments*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.goto('/');
  await page.getByTestId('user-name').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs-images/home-logged-in.png', fullPage: false });
});

test('capture deploy view with populated table', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true, render: true } });
  await page.route('**/rest/v1/deployments*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'd1', provider: 'vercel', repo_name: 'RepoHosting', repo_url: 'https://github.com/sangal1/RepoHosting', status: 'success', external_url: 'https://vercel.com/x', created_at: new Date(0).toISOString() },
        { id: 'd2', provider: 'render', repo_name: 'my-api', repo_url: 'https://github.com/sangal1/my-api', status: 'deploying', external_url: 'https://dashboard.render.com/web/srv_1', created_at: new Date(0).toISOString() },
        { id: 'd3', provider: 'netlify', repo_name: 'landing', repo_url: 'https://github.com/sangal1/landing', status: 'failed', external_url: '', created_at: new Date(0).toISOString() },
      ]),
    })
  );
  // stop status polling from flipping the deploying row during the shot
  await page.route('**/deployment-status*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'd2', status: 'deploying' }) })
  );
  await page.goto('/');
  await page.getByTestId('user-name').waitFor();
  await page.getByTestId('repo-url').fill('https://github.com/sangal1/RepoHosting');
  await page.getByTestId('env-vars').fill('API_KEY=secret\nNODE_ENV=production');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs-images/deploy-view.png', fullPage: false });
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

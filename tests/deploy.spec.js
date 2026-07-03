import { test, expect } from '@playwright/test';
import { mockSupabase, seedSession, FAKE_USER } from './helpers.js';

// Frontend deploy feature: form gating, connector dropdown, repo picker,
// deploy + status polling with spinner. Backend covered by
// tests/integration/deploy-flow.sh.

function mockDeployBackend(page, { repos = [], statuses = ['deploying', 'success'] } = {}) {
  // list-repos
  page.route('**/list-repos*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ repos }) })
  );
  // deploy -> returns a deploying row
  page.route('**/deploy', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        deployment: {
          id: 'dep-1',
          provider: 'vercel',
          repo_name: 'RepoHosting',
          repo_url: 'https://github.com/sangal1/RepoHosting',
          status: 'deploying',
          external_url: 'https://vercel.com/sangal1/repohosting/dpl_1',
          created_at: new Date(0).toISOString(),
        },
      }),
    })
  );
  // deployment-status -> progress through the given statuses
  let i = 0;
  page.route('**/deployment-status*', (route) => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i++;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'dep-1', status, external_url: 'https://vercel.com/sangal1/repohosting/dpl_1' }),
    });
  });
  // initial deployments list (REST) empty
  page.route('**/rest/v1/deployments*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
}

test.describe('Deploy feature', () => {
  test('logged out: deploy + select-repo disabled', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('deploy-btn')).toBeDisabled();
    await expect(page.getByTestId('select-repo')).toBeDisabled();
  });

  test('connector dropdown shows all providers; unconnected ones disabled', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true } });
    mockDeployBackend(page);
    await page.goto('/');
    const select = page.getByTestId('provider-select');
    await expect(select.locator('option')).toHaveCount(3);
    await expect(select.locator('option[value="vercel"]')).toBeEnabled();
    await expect(select.locator('option[value="render"]')).toBeDisabled();
    await expect(select.locator('option[value="netlify"]')).toBeDisabled();
    // unconnected labels shown
    await expect(select.locator('option[value="render"]')).toContainText(/not connected/i);
  });

  test('deploy button enables once a connected provider + repo url are set', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true } });
    mockDeployBackend(page);
    await page.goto('/');
    await expect(page.getByTestId('deploy-btn')).toBeDisabled();
    await page.getByTestId('repo-url').fill('https://github.com/sangal1/RepoHosting');
    await expect(page.getByTestId('deploy-btn')).toBeEnabled();
    await expect(page.getByTestId('select-repo')).toBeEnabled();
  });

  test('select repository picker fills the repo URL', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true } });
    mockDeployBackend(page, {
      repos: [{ id: 'p1', name: 'RepoHosting', url: 'https://github.com/sangal1/RepoHosting', branch: 'main' }],
    });
    await page.goto('/');
    await page.getByTestId('select-repo').click();
    await expect(page.getByTestId('repo-modal')).toBeVisible();
    await page.getByTestId('repo-item').first().click();
    await expect(page.getByTestId('repo-modal')).toBeHidden();
    await expect(page.getByTestId('repo-url')).toHaveValue('https://github.com/sangal1/RepoHosting');
  });

  test('deploying shows a spinner + Deploying, then polls to Success with a link', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true } });
    mockDeployBackend(page, { statuses: ['deploying', 'success'] });
    await page.goto('/');

    await page.getByTestId('repo-url').fill('https://github.com/sangal1/RepoHosting');
    await page.getByTestId('deploy-btn').click();

    const row = page.getByTestId('deployment-row');
    await expect(row).toBeVisible();
    // deploying state: spinner + text
    await expect(page.getByTestId('deployment-status')).toContainText(/deploying/i);
    await expect(page.locator('.spinner')).toBeVisible();

    // polls to success
    await expect(page.getByTestId('deployment-status')).toContainText(/success/i, { timeout: 10000 });
    await expect(page.locator('.spinner')).toHaveCount(0);
    await expect(row.getByRole('link', { name: /view/i })).toHaveAttribute('href', /vercel\.com/);
  });

  test('copy .env button copies the textarea contents', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true } });
    mockDeployBackend(page);
    await page.goto('/');
    await page.getByTestId('env-vars').fill('API_KEY=secret\nDEBUG=true');
    await page.getByTestId('copy-env').click();
    await expect(page.getByTestId('toast')).toContainText(/copied/i);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('API_KEY=secret');
  });
});

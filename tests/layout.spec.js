import { test, expect } from '@playwright/test';

// Structural tests for the single-page layout.
// These assert the required sections exist and fit the "single laptop page" brief.

test.describe('RepoHosting layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('has a navbar with brand and a Google login button', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();
    await expect(nav.getByText(/RepoHosting/i)).toBeVisible();
    await expect(page.getByTestId('google-login')).toBeVisible();
    await expect(page.getByTestId('google-login')).toContainText(/google/i);
  });

  test('has a connectors section with Vercel, Render and Netlify buttons', async ({ page }) => {
    const connectors = page.getByTestId('connectors');
    await expect(connectors).toBeVisible();
    await expect(connectors.getByText(/connectors/i)).toBeVisible();
    await expect(page.getByTestId('connect-vercel')).toBeVisible();
    await expect(page.getByTestId('connect-render')).toBeVisible();
    await expect(page.getByTestId('connect-netlify')).toBeVisible();
  });

  test('has a placeholder main section', async ({ page }) => {
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    await expect(page.getByTestId('main-placeholder')).toBeVisible();
  });

  test('has a footer with the quirky message and github link', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/@sangal1/i);
    const gh = footer.getByRole('link', { name: /sangal1/i });
    await expect(gh).toHaveAttribute('href', 'https://github.com/sangal1/');
  });

  test('logged-out: user chip is hidden and connect buttons are disabled', async ({ page }) => {
    await expect(page.getByTestId('google-login')).toBeVisible();
    await expect(page.getByTestId('user-chip')).toBeHidden();
    for (const p of ['vercel', 'render', 'netlify']) {
      await expect(page.getByTestId(`connect-${p}`)).toBeDisabled();
    }
  });

  test('connectors sit to the right of the main section on a laptop viewport', async ({ page }) => {
    const main = page.getByRole('main');
    const connectors = page.getByTestId('connectors');
    const mainBox = await main.boundingBox();
    const connBox = await connectors.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(connBox).not.toBeNull();
    // connectors' left edge should start at/after the main section's horizontal midpoint
    expect(connBox.x).toBeGreaterThan(mainBox.x + mainBox.width / 2);
  });

  test('everything fits within the viewport height (no page scroll)', async ({ page }) => {
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const clientHeight = await page.evaluate(() => document.documentElement.clientHeight);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
  });
});

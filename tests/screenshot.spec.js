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

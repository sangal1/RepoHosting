import { test } from '@playwright/test';

// Utility "test" that captures marketing/PR screenshots into docs-images/.
// Run with: npx playwright test screenshot
test('capture home (logged out)', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs-images/home-logged-out.png', fullPage: false });
});

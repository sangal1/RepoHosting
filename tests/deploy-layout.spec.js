import { test, expect } from '@playwright/test';
import { mockSupabase, seedSession, FAKE_USER } from './helpers.js';

// Regression guard for the "everything visible, nothing clipped" requirement.
// The earlier no-page-scroll check passed even when content was clipped by
// `overflow:hidden`; these tests assert key elements are FULLY within the
// viewport across common laptop sizes.

const VIEWPORTS = [
  { w: 1366, h: 768 },
  { w: 1280, h: 720 }, // the size where the layout was previously clipped
  { w: 1440, h: 900 },
];

/** Assert an element is rendered fully inside the viewport (not clipped). */
async function expectFullyVisible(page, testId) {
  const box = await page.getByTestId(testId).boundingBox();
  const vp = page.viewportSize();
  expect(box, `${testId} should render`).not.toBeNull();
  expect(box.height, `${testId} has height`).toBeGreaterThan(0);
  expect(box.width, `${testId} has width`).toBeGreaterThan(0);
  expect(box.y, `${testId} top not above viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.x, `${testId} left not off-screen`).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height, `${testId} bottom within viewport`).toBeLessThanOrEqual(vp.height + 1);
  expect(box.x + box.width, `${testId} right within viewport`).toBeLessThanOrEqual(vp.width + 1);
}

for (const vp of VIEWPORTS) {
  test.describe(`deploy layout @ ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test.beforeEach(async ({ page }) => {
      await seedSession(page);
      await mockSupabase(page, { user: FAKE_USER, connectors: { vercel: true, render: true } });
      await page.route('**/rest/v1/deployments*', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      );
      await page.goto('/');
      await page.getByTestId('user-name').waitFor();
    });

    test('form controls and table are fully visible (not clipped)', async ({ page }) => {
      for (const id of [
        'repo-url',
        'provider-select',
        'branch',
        'root-dir',
        'start-command',
        'env-vars',
        'copy-env',
        'select-repo',
        'deploy-btn',
        'deployments',
        'deployments-body',
      ]) {
        await expectFullyVisible(page, id);
      }
    });

    test('footer is visible (page bottom not clipped)', async ({ page }) => {
      const footer = page.getByRole('contentinfo');
      const box = await footer.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(vp.h + 1);
      await expect(footer).toBeInViewport({ ratio: 0.9 });
    });

    test('no horizontal page overflow', async ({ page }) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('two-column field rows sit side by side (not wrapped/stacked)', async ({ page }) => {
      const rootDir = await page.getByTestId('root-dir').boundingBox();
      const startCmd = await page.getByTestId('start-command').boundingBox();
      // same row => same vertical position; start command to the right of root dir
      expect(Math.abs(rootDir.y - startCmd.y)).toBeLessThan(4);
      expect(startCmd.x).toBeGreaterThan(rootDir.x + rootDir.width / 2);
    });

    test('inputs do not overflow the form panel width', async ({ page }) => {
      const form = await page.getByTestId('deploy-form').boundingBox();
      const repo = await page.getByTestId('repo-url').boundingBox();
      expect(repo.x).toBeGreaterThanOrEqual(form.x - 1);
      expect(repo.x + repo.width).toBeLessThanOrEqual(form.x + form.width + 1);
    });
  });
}

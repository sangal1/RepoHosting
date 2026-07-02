import { test, expect } from '@playwright/test';
import { mockSupabase, seedSession, FAKE_USER } from './helpers.js';

// Render has no OAuth — the user pastes a personal API key into a modal, which
// is POSTed to the render-connect edge function. Backend covered by
// tests/integration/render-flow.sh.
test.describe('Render connector (frontend)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { user: FAKE_USER });
  });

  test('opening Connect reveals the API-key modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('render-modal')).toBeHidden();
    await page.getByTestId('connect-render').click();
    await expect(page.getByTestId('render-modal')).toBeVisible();
    await expect(page.getByTestId('render-api-key')).toBeVisible();
  });

  test('empty key shows an inline validation error', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connect-render').click();
    await page.getByTestId('render-save').click();
    await expect(page.getByTestId('render-modal-error')).toBeVisible();
    await expect(page.getByTestId('render-modal-error')).toContainText(/paste an api key/i);
  });

  test('a rejected key surfaces the server error', async ({ page }) => {
    await page.route('**/render-connect', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'That API key was rejected by Render.' }),
      })
    );
    await page.goto('/');
    await page.getByTestId('connect-render').click();
    await page.getByTestId('render-api-key').fill('bad_key');
    await page.getByTestId('render-save').click();
    await expect(page.getByTestId('render-modal-error')).toContainText(/rejected by render/i);
    await expect(page.getByTestId('render-modal')).toBeVisible(); // stays open on error
  });

  test('a valid key connects Render, closes the modal, and toasts', async ({ page }) => {
    await page.route('**/render-connect', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, account: 'Ada Render Team' }),
      })
    );
    await page.goto('/');
    await expect(page.getByTestId('status-render')).toHaveText(/not connected/i);
    await page.getByTestId('connect-render').click();
    await page.getByTestId('render-api-key').fill('rnd_valid_key');
    await page.getByTestId('render-save').click();

    await expect(page.getByTestId('render-modal')).toBeHidden();
    await expect(page.getByTestId('toast')).toContainText(/render connected/i);
    await expect(page.getByTestId('status-render')).toHaveText(/^connected$/i);
    await expect(page.getByTestId('connect-render')).toHaveText(/connected/i);
  });

  test('cancel closes the modal without connecting', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connect-render').click();
    await page.getByTestId('render-cancel').click();
    await expect(page.getByTestId('render-modal')).toBeHidden();
    await expect(page.getByTestId('status-render')).toHaveText(/not connected/i);
  });
});

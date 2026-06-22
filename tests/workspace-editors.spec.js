// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Workspace editors', () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/workspace/');
    await expect(page.locator('#ws-status')).toContainText(/Готово|Завантаження/);
    await page.waitForFunction(() => typeof window.Quill !== 'undefined');
    await page.waitForFunction(() => typeof window.jspreadsheet !== 'undefined');
    page._wsErrors = errors;
  });

  test('creates and shows document editor (Quill)', async ({ page }) => {
    await page.locator('#ws-new-doc').click();
    await expect(page.locator('.ql-editor')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ql-editor')).toContainText(/Новий документ|документ/i);
  });

  test('creates and shows spreadsheet editor', async ({ page }) => {
    await page.locator('#ws-new-sheet').click();
    await expect(page.locator('#ws-jexcel')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.jexcel')).toBeVisible({ timeout: 10000 });
  });

  test('creates and shows presentation editor', async ({ page }) => {
    await page.locator('#ws-new-slides').click();
    await expect(page.locator('#ws-slide-title')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#ws-slide-preview')).toBeVisible();
  });
});

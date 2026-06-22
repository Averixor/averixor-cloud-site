// @ts-check
const { test, expect } = require('@playwright/test');

const PAGES = [
  '/',
  '/pages/files.html',
  '/pages/office.html',
  '/pages/collaboration.html',
  '/pages/security.html',
  '/pages/start.html',
  '/pages/help.html',
  '/pages/privacy.html',
  '/pages/terms.html',
];

test.describe('Marketing site smoke', () => {
  test('homepage has login and registration links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="https://cloud.averixor.xyz/"]').first()).toBeVisible();
    await expect(page.locator('a[href="https://cloud.averixor.xyz/index.php/apps/registration/"]').first()).toBeAttached();
  });

  for (const path of PAGES) {
    test(`page loads: ${path}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(path);
      await expect(page.locator('header.site-header')).toBeVisible();
      await expect(page.locator('footer.site-footer')).toBeVisible();
      const critical = errors.filter((m) => !/favicon|manifest/i.test(m));
      expect(critical, `console errors on ${path}`).toEqual([]);
    });
  }

  test('terms page has mobile nav toggle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pages/terms.html');
    await expect(page.locator('[data-nav-toggle]')).toBeVisible();
    await page.locator('[data-nav-toggle]').click();
    await expect(page.locator('#site-navigation')).toHaveClass(/is-open/);
  });

  test('workspace disclaimer is visible', async ({ page }) => {
    await page.goto('/workspace/');
    await expect(page.locator('.ws-disclaimer')).toContainText('не');
    await expect(page.locator('.ws-disclaimer')).toContainText('Nextcloud');
  });
});

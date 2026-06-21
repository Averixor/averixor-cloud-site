// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BACKUP_PASSWORD,
  waitForWorkspaceReady,
  seedTestWorkspace,
  exportEncryptedBackupBytes,
  clearWorkspaceIndexedDB,
  restoreBackupBytes,
  verifyRestoredWorkspace,
} = require('./helpers/workspace');

test.describe('Backup + Restore (MVP)', () => {
  test('encrypted backup → wipe IDB → restore preserves tree and content', async ({ page }) => {
    await waitForWorkspaceReady(page);
    const fixture = await seedTestWorkspace(page);

    const backup = await exportEncryptedBackupBytes(page, BACKUP_PASSWORD);
    expect(backup.recordCount).toBeGreaterThanOrEqual(5);
    expect(backup.checksum).toMatch(/^[a-f0-9]{64}$/);

    await clearWorkspaceIndexedDB(page);
    await page.reload();
    await page.waitForFunction(() => window.WorkspaceFS);

    const hasE2eData = await page.evaluate(async () => {
      const fs = new window.WorkspaceFS();
      await fs.init();
      const all = await fs.listAllRecordsRaw();
      return all.some((r) => r.name.startsWith('e2e-') || r.name === 'E2E-Test');
    });
    expect(hasE2eData).toBe(false);

    const restored = await restoreBackupBytes(page, backup.bytes, BACKUP_PASSWORD);
    expect(restored.recordCount).toBe(backup.recordCount);
    expect(restored.checksum).toBe(backup.checksum);

    const check = await verifyRestoredWorkspace(page, fixture);
    expect(check.ok, check.reason || JSON.stringify(check)).toBe(true);
    expect(check.docHtml).toContain('E2E document content');
    expect(check.sheetCell).toBe('A1');
    expect(check.annotation).toBe('E2E annotation');
    expect(check.treeNames).toContain(fixture.folderName);
    expect(check.treeNames).toContain(fixture.docName);
  });

  test('restore wizard UI: upload encrypted backup after wipe', async ({ page }) => {
    await waitForWorkspaceReady(page);
    const fixture = await seedTestWorkspace(page);
    const backup = await exportEncryptedBackupBytes(page, BACKUP_PASSWORD);

    const tmpFile = path.join(os.tmpdir(), `averixor-e2e-${Date.now()}.averixor-backup`);
    fs.writeFileSync(tmpFile, Buffer.from(backup.bytes));

    await clearWorkspaceIndexedDB(page);
    await page.reload();
    await waitForWorkspaceReady(page);

    page.once('dialog', (d) => d.accept());

    await page.locator('#ws-restore').click();
    await expect(page.locator('#ws-restore-modal')).toBeVisible();
    await page.locator('#ws-restore-pick').click();
    await page.locator('#ws-restore-input').setInputFiles(tmpFile);

    await expect(page.locator('#ws-restore-step-password')).toBeVisible();
    await page.locator('#ws-restore-password').fill(BACKUP_PASSWORD);
    await page.locator('#ws-restore-password-next').click();

    await expect(page.locator('#ws-restore-step-confirm')).toBeVisible();
    await page.locator('#ws-restore-confirm').click();

    await expect(page.locator('#ws-status')).toContainText(/Відновлено \d+ записів/, { timeout: 60_000 });

    const check = await verifyRestoredWorkspace(page, fixture);
    expect(check.ok).toBe(true);
    expect(check.annotation).toBe('E2E annotation');

    fs.unlinkSync(tmpFile);
  });

  test('merge-missing adds backup records without removing local-only files', async ({ page }) => {
    await waitForWorkspaceReady(page);
    const fixture = await seedTestWorkspace(page);
    const backup = await exportEncryptedBackupBytes(page, BACKUP_PASSWORD);

    await page.evaluate(async () => {
      const { WorkspaceFS, WorkspaceUtils, WorkspaceMIME } = window;
      const fs = new WorkspaceFS();
      await fs.init();
      await fs.createFile({
        name: 'local-only.averixor-doc',
        parentId: WorkspaceUtils.ROOT_ID,
        kind: 'document',
        mime: WorkspaceMIME.document,
        content: JSON.stringify({ html: '<p>local only</p>' }),
      });
    });

    await page.evaluate(async () => {
      const fs = new WorkspaceFS();
      await fs.init();
      const all = await fs.listAllRecordsRaw();
      for (const rec of all) {
        if (rec.name.startsWith('e2e-') || rec.name === 'E2E-Test') {
          await fs.delete(rec.id);
        }
      }
    });

    const restored = await restoreBackupBytes(page, backup.bytes, BACKUP_PASSWORD, 'merge-missing');
    expect(restored.result.mode).toBe('merge-missing');
    expect(restored.result.added).toBeGreaterThan(0);

    const check = await page.evaluate(async () => {
      const fs = new WorkspaceFS();
      await fs.init();
      const names = (await fs.listAllRecordsRaw()).map((r) => r.name);
      return {
        hasE2e: names.includes('e2e-doc.averixor-doc'),
        hasLocal: names.includes('local-only.averixor-doc'),
      };
    });
    expect(check.hasE2e).toBe(true);
    expect(check.hasLocal).toBe(true);

    const verify = await verifyRestoredWorkspace(page, fixture);
    expect(verify.ok).toBe(true);
  });
});

test.describe('Backup + Restore (negative)', () => {
  test('wrong password fails before successful manifest parse', async ({ page }) => {
    await waitForWorkspaceReady(page);
    await seedTestWorkspace(page);
    const backup = await exportEncryptedBackupBytes(page, BACKUP_PASSWORD);

    const err = await page.evaluate(async ({ data }) => {
      try {
        const arr = new Uint8Array(data);
        await window.WorkspaceBackup.parseBackupFile(arr.buffer, 'wrongpass1', () => {});
        return null;
      } catch (e) {
        return e.message || String(e);
      }
    }, { data: backup.bytes });

    expect(err).toBeTruthy();
    expect(err).toMatch(/пароль|пошкоджений|invalid/i);
  });

  test('tampered checksum is rejected', async ({ page }) => {
    await waitForWorkspaceReady(page);
    await seedTestWorkspace(page);

    const err = await page.evaluate(async () => {
      try {
        const fs = new window.WorkspaceFS();
        await fs.init();
        const manifest = await window.WorkspaceBackup.buildManifest(fs);
        manifest.checksum = '0'.repeat(64);
        const jsonUtf8 = new TextEncoder().encode(JSON.stringify(manifest));
        const packed = window.WorkspaceCrypto.packPlainBackup(jsonUtf8);
        await fs.importWorkspaceBackup(packed.buffer, null, () => {});
        return null;
      } catch (e) {
        return e.message || String(e);
      }
    });

    expect(err).toMatch(/контрольна сума/i);
  });

  test('oversized backup file is blocked', async ({ page }) => {
    await waitForWorkspaceReady(page);

    const err = await page.evaluate(async () => {
      try {
        const limit = window.WorkspaceSecurity.LIMITS.maxBackupBytes;
        const huge = new Uint8Array(limit + 1024);
        huge.set(new TextEncoder().encode('AVXRBACK1'), 0);
        window.WorkspaceSecurity.assertBackupSize(huge.byteLength);
        return null;
      } catch (e) {
        return e.message || String(e);
      }
    });

    expect(err).toMatch(/ліміт|250/);
  });

  test('encrypted backup requires password before decrypt', async ({ page }) => {
    await waitForWorkspaceReady(page);
    await seedTestWorkspace(page);
    const backup = await exportEncryptedBackupBytes(page, BACKUP_PASSWORD);

    const err = await page.evaluate(async ({ data }) => {
      try {
        const arr = new Uint8Array(data);
        await window.WorkspaceBackup.parseBackupFile(arr.buffer, null, () => {});
        return null;
      } catch (e) {
        return e.code || e.message || String(e);
      }
    }, { data: backup.bytes });

    expect(err).toBe('NEED_PASSWORD');
  });
});

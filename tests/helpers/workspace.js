// @ts-check

/** @typedef {{ folderName: string; docName: string; sheetName: string; pdfName: string; }} TestFixture */

const DB_NAME = 'averixor-workspace-v1';
const BACKUP_PASSWORD = 'testpass12';

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForWorkspaceReady(page) {
  await page.goto('/workspace/');
  await page.waitForFunction(() => {
    return window.WorkspaceFS && window.WorkspaceBackup && window.WorkspaceCrypto;
  });
  await page.locator('#ws-status').filter({ hasText: 'Готово' }).waitFor({ timeout: 45_000 });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<TestFixture>}
 */
async function seedTestWorkspace(page) {
  return page.evaluate(async () => {
    const { WorkspaceFS, WorkspaceUtils, WorkspaceMIME } = window;
    const { ROOT_ID } = WorkspaceUtils;
    const fs = new WorkspaceFS();
    await fs.init();

    const all = await fs.listAllRecordsRaw();
    for (const rec of all) {
      if (rec.id !== ROOT_ID) {
        await fs.delete(rec.id);
      }
    }

    const folder = await fs.mkdir('E2E-Test', ROOT_ID);

    await fs.createFile({
      name: 'e2e-doc.averixor-doc',
      parentId: folder.id,
      kind: 'document',
      mime: WorkspaceMIME.document,
      content: JSON.stringify({ html: '<p>E2E document content</p>' }),
    });

    await fs.createFile({
      name: 'e2e-sheet.averixor-sheet',
      parentId: folder.id,
      kind: 'spreadsheet',
      mime: WorkspaceMIME.spreadsheet,
      content: JSON.stringify({
        data: [[{ v: 'A1' }, { v: 'B1' }], [{ v: '42' }, { v: '' }]],
      }),
    });

    const pdfText = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
      + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
      + '3 0 obj<</Type/Page/MediaBox[0 0 200 200]>>endobj\n'
      + 'xref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF';
    const pdfBin = new TextEncoder().encode(pdfText);
    let bin = '';
    for (let i = 0; i < pdfBin.length; i++) bin += String.fromCharCode(pdfBin[i]);
    const pdfB64 = btoa(bin);

    await fs.createFile({
      name: 'e2e.pdf',
      parentId: folder.id,
      kind: 'pdf',
      mime: WorkspaceMIME.pdf,
      content: JSON.stringify({
        v: 1,
        pdf: pdfB64,
        annotations: [{ page: 1, text: 'E2E annotation', x: 50, y: 50 }],
      }),
    });

    return {
      folderName: folder.name,
      docName: 'e2e-doc.averixor-doc',
      sheetName: 'e2e-sheet.averixor-sheet',
      pdfName: 'e2e.pdf',
    };
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} password
 */
async function exportEncryptedBackupBytes(page, password) {
  return page.evaluate(async (pw) => {
    const fs = new window.WorkspaceFS();
    await fs.init();
    const { blob, manifest } = await fs.exportWorkspaceBackup({
      encrypted: true,
      password: pw,
      onProgress: () => {},
    });
    const buf = await blob.arrayBuffer();
    return {
      bytes: Array.from(new Uint8Array(buf)),
      recordCount: manifest.recordCount,
      checksum: manifest.checksum,
    };
  }, password);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function clearWorkspaceIndexedDB(page) {
  await page.evaluate(async (dbName) => {
    localStorage.clear();
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve(undefined);
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve(undefined);
    });
  }, DB_NAME);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number[]} bytes
 * @param {string|null} password
 */
async function restoreBackupBytes(page, bytes, password, mode = 'replace') {
  return page.evaluate(async ({ data, pw, restoreMode }) => {
    const fs = new window.WorkspaceFS();
    await fs.init();
    const arr = new Uint8Array(data);
    const out = await fs.importWorkspaceBackup(arr.buffer, pw, () => {}, restoreMode);
    return {
      recordCount: out.manifest.recordCount,
      checksum: out.manifest.checksum,
      result: out.result,
    };
  }, { data: bytes, pw: password, restoreMode: mode });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {TestFixture} expected
 */
async function verifyRestoredWorkspace(page, expected) {
  return page.evaluate(async (exp) => {
    const fs = new window.WorkspaceFS();
    await fs.init();
    const all = await fs.listAllRecordsRaw();
    const byName = Object.fromEntries(all.map((r) => [r.name, r]));

    if (!byName[exp.folderName] || byName[exp.folderName].kind !== 'folder') {
      return { ok: false, reason: 'folder missing' };
    }
    if (!byName[exp.docName] || !byName[exp.sheetName] || !byName[exp.pdfName]) {
      return { ok: false, reason: 'file missing', names: all.map((r) => r.name) };
    }

    const folder = byName[exp.folderName];
    const doc = await fs.get(byName[exp.docName].id);
    const sheet = await fs.get(byName[exp.sheetName].id);
    const pdf = await fs.get(byName[exp.pdfName].id);

    if (doc.parentId !== folder.id || sheet.parentId !== folder.id || pdf.parentId !== folder.id) {
      return { ok: false, reason: 'tree mismatch' };
    }

    const docHtml = JSON.parse(doc.content).html;
    const sheetCell = JSON.parse(sheet.content).data[0][0].v;
    const pdfParsed = JSON.parse(pdf.content);

    return {
      ok: true,
      recordCount: all.length,
      docHtml,
      sheetCell,
      annotation: pdfParsed.annotations?.[0]?.text,
      treeNames: all.map((r) => r.name).sort(),
    };
  }, expected);
}

module.exports = {
  DB_NAME,
  BACKUP_PASSWORD,
  waitForWorkspaceReady,
  seedTestWorkspace,
  exportEncryptedBackupBytes,
  clearWorkspaceIndexedDB,
  restoreBackupBytes,
  verifyRestoredWorkspace,
};

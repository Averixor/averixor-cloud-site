/**
 * Averixor Cloud — повний backup / restore workspace
 */
(() => {
  'use strict';

  const BACKUP_FORMAT = 1;

  function getUtils() {
    return window.WorkspaceUtils;
  }

  function serializeContent(content) {
    const { WorkspaceCrypto } = window;
    if (content == null) return null;
    if (typeof content === 'string') return { t: 's', v: content };
    if (content instanceof ArrayBuffer) return { t: 'ab', v: WorkspaceCrypto.b64(new Uint8Array(content)) };
    if (content instanceof Uint8Array) return { t: 'ab', v: WorkspaceCrypto.b64(content) };
    if (WorkspaceCrypto.isEncryptedContent(content)) return { t: 'enc', v: content };
    return { t: 'j', v: content };
  }

  function deserializeContent(sc) {
    const { WorkspaceCrypto } = window;
    if (sc == null) return null;
    if (sc.t === 's') return sc.v;
    if (sc.t === 'ab') return WorkspaceCrypto.fromB64(sc.v).buffer;
    if (sc.t === 'enc') return sc.v;
    if (sc.t === 'j') return sc.v;
    throw new Error('Пошкоджений вміст у бэкапі');
  }

  function serializeRecord(rec) {
    const { SCHEMA_VERSION } = getUtils();
    return {
      id: rec.id,
      name: rec.name,
      parentId: rec.parentId,
      kind: rec.kind,
      mime: rec.mime,
      schemaVersion: rec.schemaVersion || SCHEMA_VERSION,
      updatedAt: rec.updatedAt || Date.now(),
      content: serializeContent(rec.content),
    };
  }

  function deserializeRecord(sr) {
    const { SCHEMA_VERSION } = getUtils();
    return {
      id: sr.id,
      name: sr.name,
      parentId: sr.parentId,
      kind: sr.kind,
      mime: sr.mime,
      schemaVersion: sr.schemaVersion || SCHEMA_VERSION,
      updatedAt: sr.updatedAt || Date.now(),
      content: deserializeContent(sr.content),
    };
  }

  async function buildManifest(fs) {
    const { SCHEMA_VERSION } = getUtils();
    const { WorkspaceCrypto } = window;
    const raw = await fs.listAllRecordsRaw();
    const records = [];
    for (const rec of raw) {
      const dec = await fs.decryptRecord({ ...rec });
      records.push(serializeRecord(dec));
    }
    records.sort((a, b) => a.id.localeCompare(b.id));
    const canonical = JSON.stringify(records);
    const checksum = await WorkspaceCrypto.sha256Hex(canonical);
    const encryption = await fs.getMeta('encryption');
    return {
      v: BACKUP_FORMAT,
      exportedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      checksum,
      recordCount: records.length,
      records,
      meta: encryption ? { encryption } : {},
    };
  }

  function validateManifest(manifest) {
    const { ROOT_ID } = getUtils();
    if (!manifest || manifest.v !== BACKUP_FORMAT) {
      throw new Error('Невірна версія маніфесту бэкапу');
    }
    if (!Array.isArray(manifest.records) || !manifest.records.length) {
      throw new Error('Бэкап порожній');
    }
    const ids = new Set(manifest.records.map((r) => r.id));
    const root = manifest.records.find((r) => r.id === ROOT_ID);
    if (!root || root.kind !== 'folder') {
      throw new Error('Бэкап не містить кореневу папку');
    }
    for (const rec of manifest.records) {
      if (rec.parentId != null && !ids.has(rec.parentId)) {
        throw new Error(`Запис ${rec.name}: відсутній батьківський каталог`);
      }
    }
  }

  async function verifyChecksum(manifest) {
    const { WorkspaceCrypto } = window;
    const sorted = [...manifest.records].sort((a, b) => a.id.localeCompare(b.id));
    const canonical = JSON.stringify(sorted);
    const hash = await WorkspaceCrypto.sha256Hex(canonical);
    if (hash !== manifest.checksum) {
      throw new Error('Контрольна сума бэкапу не збігається — файл пошкоджений');
    }
  }

  async function exportWorkspaceBackup(fs, { encrypted, password, onProgress, kdf }) {
    const { WorkspaceCrypto } = window;
    onProgress?.('Збір файлів…', 10);
    const manifest = await buildManifest(fs);
    validateManifest(manifest);
    const jsonUtf8 = new TextEncoder().encode(JSON.stringify(manifest));
    const { LIMITS } = window.WorkspaceSecurity;
    if (jsonUtf8.byteLength > LIMITS.maxBackupBytes) {
      throw new Error(
        `Бэкап перевищує ліміт ${Math.round(LIMITS.maxBackupBytes / 1024 / 1024)} МБ. Видаліть зайві файли.`,
      );
    }
    const argonKdf = kdf || WorkspaceCrypto.suggestArgon2Profile();
    onProgress?.(encrypted ? 'Шифрування Argon2id (worker) + AES-256-GCM…' : 'Пакування…', 50);
    let blob;
    if (encrypted) {
      if (!password || password.length < 8) {
        throw new Error('Пароль бэкапу — мінімум 8 символів');
      }
      const packed = await WorkspaceCrypto.packEncryptedBackup(jsonUtf8, password, argonKdf);
      blob = new Blob([packed], { type: 'application/octet-stream' });
    } else {
      const packed = WorkspaceCrypto.packPlainBackup(jsonUtf8);
      blob = new Blob([packed], { type: 'application/octet-stream' });
    }
    onProgress?.('Готово', 100);
    return { blob, manifest, kdf: argonKdf };
  }

  async function parseBackupFile(arrayBuffer, password, onProgress) {
    const { WorkspaceCrypto } = window;
    onProgress?.('Читання файлу…', 5);
    const buf = new Uint8Array(arrayBuffer);
    if (buf.byteLength > window.WorkspaceSecurity.LIMITS.maxBackupBytes) {
      throw new Error('Файл бэкапу занадто великий');
    }
    const header = WorkspaceCrypto.parseBackupHeader(buf);
    let jsonBytes;
    if (!header.encrypted) {
      jsonBytes = header.payload;
    } else {
      if (!password) {
        const err = new Error('NEED_PASSWORD');
        err.code = 'NEED_PASSWORD';
        throw err;
      }
      onProgress?.('Розшифрування (Argon2id)…', 25);
      jsonBytes = await WorkspaceCrypto.decryptBackupPayload(header, password);
    }
    onProgress?.('Перевірка цілісності…', 60);
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(jsonBytes));
    } catch {
      throw new Error('Невірний пароль або пошкоджений бэкап');
    }
    validateManifest(manifest);
    await verifyChecksum(manifest);
    onProgress?.('Маніфест валідний', 80);
    return manifest;
  }

  async function importWorkspaceBackup(fs, arrayBuffer, password, onProgress, mode = 'replace') {
    const manifest = await parseBackupFile(arrayBuffer, password, onProgress);
    onProgress?.(mode === 'merge-missing' ? 'Додавання відсутніх…' : 'Атомарне відновлення…', 90);
    const result = await fs.restoreFromManifest(manifest, mode);
    onProgress?.('Готово', 100);
    return { manifest, result };
  }

  window.WorkspaceBackup = {
    buildManifest,
    validateManifest,
    verifyChecksum,
    exportWorkspaceBackup,
    parseBackupFile,
    importWorkspaceBackup,
  };
})();

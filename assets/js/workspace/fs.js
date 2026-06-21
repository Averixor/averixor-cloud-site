/**
 * Averixor Cloud — віртуальна файлова система (IndexedDB)
 */
(() => {
  'use strict';

  const DB_NAME = 'averixor-workspace-v1';
  const DB_VERSION = 2;
  const SCHEMA_VERSION = 2;
  const STORE = 'files';
  const META = 'meta';
  const ROOT_ID = 'root';

  const MIME = {
    folder: 'inode/directory',
    document: 'application/x-averixor-document',
    spreadsheet: 'application/x-averixor-spreadsheet',
    presentation: 'application/x-averixor-presentation',
    pdf: 'application/pdf',
    zip: 'application/zip',
    text: 'text/plain',
    html: 'text/html',
    image: 'image/*',
    binary: 'application/octet-stream',
  };

  const EXT = {
    document: ['doc', 'docx', 'odt', 'rtf', 'averixor-doc'],
    spreadsheet: ['xls', 'xlsx', 'ods', 'csv', 'averixor-sheet'],
    presentation: ['ppt', 'pptx', 'odp', 'averixor-slides'],
    pdf: ['pdf'],
    zip: ['zip'],
    text: ['txt', 'md', 'json', 'xml'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  };

  function uid() {
    return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function extOf(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  function kindFromName(name, mime = '') {
    const ext = extOf(name);
    if (mime === MIME.folder) return 'folder';
    for (const [kind, list] of Object.entries(EXT)) {
      if (list.includes(ext)) return kind;
    }
    if (mime.startsWith('image/')) return 'image';
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('zip')) return 'zip';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return 'spreadsheet';
    if (mime.includes('word') || mime.includes('document')) return 'document';
    if (mime.includes('presentation')) return 'presentation';
    return 'binary';
  }

  function iconFor(kind) {
    const map = {
      folder: '📁',
      document: '📄',
      spreadsheet: '📊',
      presentation: '📽️',
      pdf: '📕',
      zip: '🗜️',
      text: '📝',
      image: '🖼️',
      binary: '📎',
    };
    return map[kind] || '📎';
  }

  class WorkspaceFS {
    constructor() {
      this.db = null;
      this.encryptionKey = null;
      this.encryptionEnabled = false;
    }

    async init() {
      this.db = await this.openDb();
      await this.loadEncryptionState();
      const root = await this.getRaw(ROOT_ID);
      if (!root) {
        await this.seed();
      }
    }

    async loadEncryptionState() {
      const cfg = await this.getMeta('encryption');
      this.encryptionEnabled = !!(cfg && cfg.enabled);
      return cfg;
    }

    setSessionKey(key) {
      this.encryptionKey = key;
    }

    clearSessionKey() {
      this.encryptionKey = null;
    }

    isUnlocked() {
      return !this.encryptionEnabled || this.encryptionKey !== null;
    }

    metaTx(mode = 'readonly') {
      return this.db.transaction(META, mode).objectStore(META);
    }

    async getMeta(key) {
      return new Promise((resolve, reject) => {
        const req = this.metaTx().get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
      });
    }

    async setMeta(key, value) {
      return new Promise((resolve, reject) => {
        const req = this.metaTx('readwrite').put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    async getRaw(id) {
      return new Promise((resolve, reject) => {
        const req = this.tx().get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async putRaw(record) {
      return new Promise((resolve, reject) => {
        const req = this.tx('readwrite').put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
      });
    }

    async listAllRecordsRaw() {
      return new Promise((resolve, reject) => {
        const req = this.tx().getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    async decryptRecord(record) {
      if (!record || record.content == null) return record;
      const { WorkspaceCrypto } = window;
      if (!WorkspaceCrypto.isEncryptedContent(record.content)) return record;
      if (!this.encryptionKey) {
        const err = new Error('Сховище зашифроване. Введіть пароль.');
        err.code = 'LOCKED';
        throw err;
      }
      const copy = { ...record };
      copy.content = await WorkspaceCrypto.unwrapContent(this.encryptionKey, record.content);
      return copy;
    }

    async encryptRecord(record) {
      if (!record || record.content == null) return record;
      const { WorkspaceCrypto } = window;
      if (!this.encryptionEnabled) return record;
      if (!this.encryptionKey) {
        if (!WorkspaceCrypto.isEncryptedContent(record.content)) {
          const err = new Error('Сховище заблоковане. Введіть пароль.');
          err.code = 'LOCKED';
          throw err;
        }
        return record;
      }
      if (WorkspaceCrypto.isEncryptedContent(record.content)) return record;
      const copy = { ...record };
      copy.content = await WorkspaceCrypto.wrapContent(this.encryptionKey, record.content);
      return copy;
    }

    async unlockWithPassword(password) {
      const cfg = await this.getMeta('encryption');
      if (!cfg || !cfg.enabled) {
        this.encryptionKey = null;
        return true;
      }
      const { WorkspaceCrypto } = window;
      const salt = WorkspaceCrypto.fromB64(cfg.salt);
      const kdf = cfg.kdf || { type: 'pbkdf2' };
      const key = await WorkspaceCrypto.deriveKey(password, salt, kdf);
      const ok = await WorkspaceCrypto.checkVerifier(key, cfg.verifier);
      if (!ok) throw new Error('Невірний пароль');
      this.encryptionKey = key;
      return true;
    }

    async enableEncryption(password) {
      const { WorkspaceCrypto } = window;
      const kdf = WorkspaceCrypto.DEFAULT_ARGON2;
      const salt = WorkspaceCrypto.randomSalt();
      const key = await WorkspaceCrypto.deriveKey(password, salt, kdf);
      const verifier = await WorkspaceCrypto.createVerifier(key);
      const records = await this.listAllRecordsRaw();
      const encryptedRecords = [];
      for (const rec of records) {
        if (rec.content == null) continue;
        let plain = rec.content;
        if (WorkspaceCrypto.isEncryptedContent(rec.content)) {
          plain = await WorkspaceCrypto.unwrapContent(key, rec.content);
        }
        encryptedRecords.push({
          ...rec,
          content: await WorkspaceCrypto.wrapContent(key, plain),
        });
      }
      const metaValue = {
        enabled: true,
        salt: WorkspaceCrypto.b64(salt),
        kdf,
        verifier,
        enabledAt: Date.now(),
      };
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction([STORE, META], 'readwrite');
        const fileStore = tx.objectStore(STORE);
        const metaStore = tx.objectStore(META);
        for (const rec of encryptedRecords) {
          fileStore.put(rec);
        }
        metaStore.put({ key: 'encryption', value: metaValue });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Помилка шифрування'));
        tx.onabort = () => reject(tx.error || new Error('Шифрування скасовано'));
      });
      this.encryptionKey = key;
      this.encryptionEnabled = true;
      return true;
    }

    /**
     * @param {'replace'|'merge-missing'} mode
     */
    async restoreFromManifest(manifest, mode = 'replace') {
      const { WorkspaceBackup } = window;
      WorkspaceBackup.validateManifest(manifest);
      await WorkspaceBackup.verifyChecksum(manifest);

      const records = manifest.records.map((sr) => {
        const rec = {
          id: sr.id,
          name: sr.name,
          parentId: sr.parentId,
          kind: sr.kind,
          mime: sr.mime,
          schemaVersion: sr.schemaVersion,
          updatedAt: sr.updatedAt,
          content: null,
        };
        if (sr.content != null) {
          if (sr.content.t === 's') rec.content = sr.content.v;
          else if (sr.content.t === 'ab') rec.content = window.WorkspaceCrypto.fromB64(sr.content.v).buffer;
          else if (sr.content.t === 'enc') rec.content = sr.content.v;
          else if (sr.content.t === 'j') rec.content = sr.content.v;
        }
        return rec;
      });

      let result = { mode, added: 0, skipped: 0, total: records.length };

      if (mode === 'merge-missing') {
        const existing = await this.listAllRecordsRaw();
        const existingIds = new Set(existing.map((r) => r.id));
        const toAdd = records.filter((r) => !existingIds.has(r.id));
        result = { mode, added: toAdd.length, skipped: records.length - toAdd.length, total: records.length };

        await new Promise((resolve, reject) => {
          const tx = this.db.transaction([STORE, META], 'readwrite');
          const fileStore = tx.objectStore(STORE);
          const metaStore = tx.objectStore(META);
          for (const rec of toAdd) {
            fileStore.put(rec);
          }
          if (manifest.meta && manifest.meta.encryption) {
            metaStore.put({ key: 'encryption', value: manifest.meta.encryption });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Помилка merge-відновлення'));
          tx.onabort = () => reject(tx.error || new Error('Merge скасовано'));
        });
      } else {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction([STORE, META], 'readwrite');
          const fileStore = tx.objectStore(STORE);
          const metaStore = tx.objectStore(META);

          fileStore.clear();
          for (const rec of records) {
            fileStore.put(rec);
          }

          if (manifest.meta && manifest.meta.encryption) {
            metaStore.put({ key: 'encryption', value: manifest.meta.encryption });
          } else {
            metaStore.delete('encryption');
          }

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Помилка транзакції відновлення'));
          tx.onabort = () => reject(tx.error || new Error('Відновлення скасовано'));
        });
        this.encryptionKey = null;
        await this.loadEncryptionState();
        result.added = records.length;
      }

      return result;
    }

    async exportWorkspaceBackup(options) {
      return window.WorkspaceBackup.exportWorkspaceBackup(this, options);
    }

    async importWorkspaceBackup(arrayBuffer, password, onProgress, mode = 'replace') {
      return window.WorkspaceBackup.importWorkspaceBackup(this, arrayBuffer, password, onProgress, mode);
    }

    openDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('parentId', 'parentId', { unique: false });
            store.createIndex('name', 'name', { unique: false });
          }
          if (!db.objectStoreNames.contains(META)) {
            db.createObjectStore(META, { keyPath: 'key' });
          }
          const fromVer = event.oldVersion;
          const toVer = event.newVersion;
          if (fromVer > 0 && fromVer < toVer) {
            queueMicrotask(() => {
              window.dispatchEvent(new CustomEvent('ws-schema-upgrade', {
                detail: { from: fromVer, to: toVer },
              }));
            });
          }
        };
      });
    }

    tx(mode = 'readonly') {
      return this.db.transaction(STORE, mode).objectStore(STORE);
    }

    async get(id) {
      const record = await this.getRaw(id);
      if (!record) return null;
      return this.decryptRecord(record);
    }

    async put(record) {
      const stored = await this.encryptRecord(record);
      return this.putRaw(stored);
    }

    async delete(id) {
      if (id === ROOT_ID) return;
      const children = await this.list(id);
      for (const child of children) {
        await this.delete(child.id);
      }
      return new Promise((resolve, reject) => {
        const req = this.tx('readwrite').delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    async list(parentId = ROOT_ID) {
      return new Promise((resolve, reject) => {
        const req = this.tx().index('parentId').getAll(parentId);
        req.onsuccess = () => {
          const items = (req.result || []).sort((a, b) => {
            if (a.kind === 'folder' && b.kind !== 'folder') return -1;
            if (a.kind !== 'folder' && b.kind === 'folder') return 1;
            return a.name.localeCompare(b.name, 'uk');
          });
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    }

    async mkdir(name, parentId = ROOT_ID) {
      const record = {
        id: uid(),
        name,
        parentId,
        kind: 'folder',
        mime: MIME.folder,
        content: null,
        updatedAt: Date.now(),
      };
      await this.put(record);
      return record;
    }

    async createFile({ name, parentId = ROOT_ID, kind, mime, content }) {
      const record = {
        id: uid(),
        name,
        parentId,
        kind: kind || kindFromName(name, mime),
        mime: mime || MIME.binary,
        content,
        schemaVersion: SCHEMA_VERSION,
        updatedAt: Date.now(),
      };
      await this.put(record);
      return record;
    }

    async updateContent(id, content, mime) {
      const file = await this.get(id);
      if (!file) throw new Error('File not found');
      file.content = content;
      file.schemaVersion = SCHEMA_VERSION;
      file.updatedAt = Date.now();
      if (mime) file.mime = mime;
      await this.put(file);
      return file;
    }

    async rename(id, name) {
      const file = await this.get(id);
      if (!file) throw new Error('File not found');
      file.name = name;
      file.kind = file.kind === 'folder' ? 'folder' : kindFromName(name, file.mime);
      file.updatedAt = Date.now();
      await this.put(file);
      return file;
    }

    async readBlob(id) {
      const file = await this.get(id);
      if (!file || file.content == null) return null;

      if (file.kind === 'pdf' && typeof file.content === 'string') {
        try {
          const parsed = JSON.parse(file.content);
          if (parsed && parsed.v === 1 && parsed.pdf) {
            const bin = atob(parsed.pdf);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new Blob([bytes], { type: MIME.pdf });
          }
        } catch {
          /* raw legacy */
        }
      }

      if (file.content instanceof Blob) return file.content;
      if (file.content instanceof ArrayBuffer) return new Blob([file.content], { type: file.mime });
      if (typeof file.content === 'string') {
        return new Blob([file.content], { type: file.mime || 'text/plain' });
      }
      return new Blob([JSON.stringify(file.content)], { type: file.mime });
    }

    /** Усі файли (не папки) з відносними шляхами для ZIP-експорту */
    async listAllFiles() {
      const out = [];
      const walk = async (parentId, prefix) => {
        const items = await this.list(parentId);
        for (const item of items) {
          if (item.kind === 'folder') {
            await walk(item.id, `${prefix}${item.name}/`);
          } else {
            out.push({ file: item, path: `${prefix}${item.name}` });
          }
        }
      };
      await walk(ROOT_ID, '');
      return out;
    }

    async seed() {
      const root = {
        id: ROOT_ID,
        name: 'Локальні файли',
        parentId: null,
        kind: 'folder',
        mime: MIME.folder,
        content: null,
        updatedAt: Date.now(),
      };
      await this.put(root);

      const docs = await this.mkdir('Документи', ROOT_ID);
      const sheets = await this.mkdir('Таблиці', ROOT_ID);
      await this.mkdir('Презентації', ROOT_ID);

      await this.createFile({
        name: 'Ласкаво просимо.averixor-doc',
        parentId: docs.id,
        kind: 'document',
        mime: MIME.document,
        content: JSON.stringify({
          html: '<h1>Ласкаво просимо</h1><p>Це <strong>локальний демо-офіс</strong> у браузері — не Nextcloud.</p><ul><li>Файли зберігаються в IndexedDB цього пристрою</li><li>Можна імпортувати DOCX, XLSX, PDF, ZIP</li><li>Щоб зберегти в хмару — експортуйте файл і завантажте на <a href="https://cloud.averixor.xyz/login">cloud.averixor.xyz</a></li></ul>',
        }),
      });

      await this.createFile({
        name: 'Бюджет.averixor-sheet',
        parentId: sheets.id,
        kind: 'spreadsheet',
        mime: MIME.spreadsheet,
        content: JSON.stringify({
          data: [
            [{ v: 'Стаття' }, { v: 'Сума' }, { v: '%' }],
            [{ v: 'Оренда' }, { v: 12000 }, { v: 40 }],
            [{ v: 'Зв’язок' }, { v: 2500 }, { v: 8 }],
            [{ v: 'Продукти' }, { v: 8000 }, { v: 27 }],
            [{ v: 'Разом' }, { v: 30000 }, { v: 100 }],
          ],
        }),
      });

      await this.createFile({
        name: 'Огляд проєкту.averixor-slides',
        parentId: ROOT_ID,
        kind: 'presentation',
        mime: MIME.presentation,
        content: JSON.stringify({
          slides: [
            { title: 'Averixor Cloud', body: 'Приватна офісна хмара\nФайли · Документи · Таблиці' },
            { title: 'Можливості', body: 'Редагування в браузері\nІмпорт офісних форматів\nЛокальне сховище' },
            { title: 'Далі', body: 'Створюйте нові файли\nЕкспортуйте у XLSX, HTML, PDF' },
          ],
        }),
      });
    }
  }

  window.WorkspaceFS = WorkspaceFS;
  window.WorkspaceMIME = MIME;
  window.WorkspaceUtils = { uid, extOf, kindFromName, iconFor, ROOT_ID, SCHEMA_VERSION };
})();

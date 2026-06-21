/**
 * Averixor Cloud — головний застосунок робочого середовища
 */
(() => {
  'use strict';

  const { WorkspaceFS, WorkspaceUtils, WorkspaceMIME } = window;
  const { DocumentEditor, SpreadsheetEditor, PresentationEditor, PdfEditor, importXlsxToContent, importCsvToContent } = window.WorkspaceEditors;
  const { sanitizeFilename, sanitizeHtml, assertFileSize, validateZip } = window.WorkspaceSecurity;
  const { iconFor, kindFromName, ROOT_ID } = WorkspaceUtils;

  const state = {
    fs: new WorkspaceFS(),
    cwd: ROOT_ID,
    openTabs: [],
    activeTab: null,
    dirty: false,
    restoreBuffer: null,
    restoreEncrypted: false,
  };

  const BACKUP_KEY = 'averixor-ws-last-backup';
  const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

  function markBackupDone() {
    try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* empty */ }
    hideBackupBanner();
  }

  function hideBackupBanner() {
    const el = $('ws-backup-banner');
    if (el) el.hidden = true;
  }

  function checkBackupReminder() {
    const el = $('ws-backup-banner');
    if (!el) return;
    let last = 0;
    try { last = Number(localStorage.getItem(BACKUP_KEY) || 0); } catch { /* empty */ }
    if (!last || Date.now() - last > BACKUP_INTERVAL_MS) {
      el.hidden = false;
    }
  }

  async function promptPassword(message) {
    const pw = window.prompt(message);
    if (pw === null) return null;
    if (!pw || pw.length < 8) {
      throw new Error('Пароль має бути не менше 8 символів');
    }
    return pw;
  }

  async function ensureUnlocked() {
    if (state.fs.isUnlocked()) return;
    const pw = await promptPassword('Сховище зашифроване. Введіть пароль:');
    if (!pw) throw new Error('Скасовано');
    await state.fs.unlockWithPassword(pw);
  }

  async function enableEncryptionFlow() {
    const pw1 = await promptPassword('Новий пароль шифрування (мін. 8 символів):');
    if (!pw1) return;
    const pw2 = window.prompt('Повторіть пароль:');
    if (pw1 !== pw2) throw new Error('Паролі не збігаються');
    if (!confirm('Увімкнути шифрування всіх локальних файлів? Спочатку зробіть «🔐 Бэкап».')) return;
    setStatus('Шифрування…');
    await state.fs.enableEncryption(pw1);
    setStatus('Шифрування увімкнено');
  }

  async function exportEncryptedBackup() {
    try {
      await ensureUnlocked();
      if (state.dirty && state.activeTab) await saveCurrent();
      const pw1 = await promptPassword('Пароль зашифрованого бэкапу (мін. 8 символів):');
      if (!pw1) return;
      const pw2 = window.prompt('Повторіть пароль бэкапу:');
      if (pw1 !== pw2) throw new Error('Паролі не збігаються');
      setStatus('Створення бэкапу Argon2id + AES-256-GCM…');
      const manifestPreview = await window.WorkspaceBackup.buildManifest(state.fs);
      const jsonSize = new TextEncoder().encode(JSON.stringify(manifestPreview)).byteLength;
      const sizeMb = (jsonSize / 1024 / 1024).toFixed(2);
      const limitMb = Math.round(window.WorkspaceSecurity.LIMITS.maxBackupBytes / 1024 / 1024);
      if (!confirm(
        `Розмір бэкапу: ~${sizeMb} МБ (${manifestPreview.recordCount} записів).\n`
        + `Ліміт: ${limitMb} МБ.\n\nПродовжити створення зашифрованого бэкапу?`,
      )) return;
      const suggested = window.WorkspaceCrypto.suggestArgon2Profile();
      const useFast = confirm(
        suggested.memory <= 16384
          ? 'Рекомендуємо швидкий Argon2 (worker, менше навантаження на CPU). OK = швидкий, Скасувати = стандартний'
          : 'Швидкий Argon2 (менше CPU, трохи слабший)? OK = швидкий, Скасувати = стандартний (64MB, worker)',
      );
      const kdf = useFast ? window.WorkspaceCrypto.FAST_ARGON2 : window.WorkspaceCrypto.DEFAULT_ARGON2;
      const { blob, manifest } = await state.fs.exportWorkspaceBackup({
        encrypted: true,
        password: pw1,
        kdf,
        onProgress: (t, p) => setStatus(`${t} (${p}%)`),
      });
      const stamp = new Date().toISOString().slice(0, 10);
      saveAs(blob, `averixor-backup-${stamp}.averixor-backup`);
      markBackupDone();
      setStatus(`Зашифрований бэкап: ${manifest.recordCount} записів`);
    } catch (err) {
      reportError('backup', err);
    }
  }

  function updateRestoreProgress(text, pct) {
    const bar = $('ws-restore-progress-bar');
    const label = $('ws-restore-progress-text');
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = text;
  }

  function showRestoreStep(step) {
    ['file', 'password', 'confirm', 'progress'].forEach((s) => {
      const el = $(`ws-restore-step-${s}`);
      if (el) el.hidden = s !== step;
    });
  }

  function openRestoreWizard() {
    const modal = $('ws-restore-modal');
    if (!modal) return;
    modal.hidden = false;
    state.restoreBuffer = null;
    state.restoreEncrypted = false;
    const pw = $('ws-restore-password');
    if (pw) pw.value = '';
    showRestoreStep('file');
    updateRestoreProgress('Оберіть файл .averixor-backup', 0);
  }

  function closeRestoreWizard() {
    const modal = $('ws-restore-modal');
    if (modal) modal.hidden = true;
    state.restoreBuffer = null;
  }

  async function onRestoreFileSelected(file) {
    try {
      const buf = await file.arrayBuffer();
      window.WorkspaceSecurity.assertBackupSize(buf.byteLength);
      const header = window.WorkspaceCrypto.parseBackupHeader(new Uint8Array(buf));
      state.restoreBuffer = buf;
      state.restoreEncrypted = header.encrypted;
      if (header.encrypted) {
        showRestoreStep('password');
        $('ws-restore-password')?.focus();
      } else {
        showRestoreStep('confirm');
      }
    } catch (err) {
      reportError('restore', err);
    }
  }

  function getRestoreMode() {
    const picked = document.querySelector('input[name="ws-restore-mode"]:checked');
    return picked ? picked.value : 'replace';
  }

  async function runRestore(password) {
    if (!state.restoreBuffer) return;
    if (state.restoreEncrypted && !password) {
      throw new Error('Введіть пароль бэкапу');
    }
    const mode = getRestoreMode();
    if (mode === 'replace') {
      if (!confirm(
        'УВАГА: режим «Замінити все».\n\n'
        + 'Усі поточні локальні файли будуть видалені та замінені вмістом бэкапу.\n'
        + 'Новіші локальні файли будуть втрачені.\n\n'
        + 'Рекомендуємо спочатку зробити бэкап поточного стану.\n\n'
        + 'Продовжити?',
      )) return;
    } else if (!confirm(
      'Режим «Лише відсутні».\n\n'
      + 'Будуть додані записи з бэкапу, яких немає зараз (за id).\n'
      + 'Існуючі файли не змінюються.\n\n'
      + 'Продовжити?',
    )) return;

    showRestoreStep('progress');
    const { manifest, result } = await state.fs.importWorkspaceBackup(
      state.restoreBuffer,
      state.restoreEncrypted ? password : null,
      (t, p) => updateRestoreProgress(t, p),
      mode,
    );
    markBackupDone();
    state.openTabs = [];
    state.activeTab = null;
    state.cwd = ROOT_ID;
    state.dirty = false;
    hideAllPanes();
    closeRestoreWizard();
    showWelcome();
    if (state.fs.encryptionEnabled && !state.fs.isUnlocked()) {
      await ensureUnlocked();
    }
    await refreshTree();
    const msg = mode === 'merge-missing'
      ? `Додано ${result.added} записів (пропущено ${result.skipped})`
      : `Відновлено ${manifest.recordCount} записів з бэкапу`;
    setStatus(msg);
  }

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg) {
    if (els.status) els.status.textContent = msg;
  }

  function markDirty() {
    state.dirty = true;
    setStatus('Є незбережені зміни');
  }

  function markClean() {
    state.dirty = false;
    setStatus('Збережено');
  }

  function reportError(scope, err) {
    console.error(`[workspace:${scope}]`, err);
    setStatus(`Помилка: ${err.message || err}`);
  }

  async function refreshTree() {
    try {
    await ensureUnlocked();
    const items = await state.fs.list(state.cwd);
    const path = await getBreadcrumb();
    els.treeTitle.textContent = path;
    els.fileTree.innerHTML = '';

    if (state.cwd !== ROOT_ID) {
      const parent = await state.fs.get(state.cwd);
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'ws-file-item is-folder';
      up.innerHTML = `<span class="ws-file-icon">⬆️</span><span>..</span>`;
      up.onclick = () => navigateUp();
      els.fileTree.appendChild(up);
    }

    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ws-file-item ${item.kind === 'folder' ? 'is-folder' : ''} ${state.activeTab === item.id ? 'is-active' : ''}`;
      btn.dataset.id = item.id;
      btn.innerHTML = `<span class="ws-file-icon">${iconFor(item.kind)}</span><span>${escapeHtml(item.name)}</span>`;
      btn.onclick = () => openItem(item);
      els.fileTree.appendChild(btn);
    });
    } catch (err) {
      reportError('refreshTree', err);
    }
  }

  async function getBreadcrumb() {
    const parts = [];
    let id = state.cwd;
    while (id && id !== ROOT_ID) {
      const f = await state.fs.get(id);
      if (!f) break;
      parts.unshift(f.name);
      id = f.parentId;
    }
    parts.unshift('Локальні файли');
    return parts.join(' / ');
  }

  async function navigateUp() {
    const cur = await state.fs.get(state.cwd);
    if (cur && cur.parentId) {
      state.cwd = cur.parentId;
      await refreshTree();
    }
  }

  async function openItem(item) {
    if (item.kind === 'folder') {
      state.cwd = item.id;
      await refreshTree();
      return;
    }
    await openFile(item.id);
  }

  async function openFile(id) {
    const file = await state.fs.get(id);
    if (!file) return;

    if (!state.openTabs.includes(id)) {
      state.openTabs.push(id);
    }
    state.activeTab = id;
    await renderTabs();
    await showEditor(file);
    await refreshTree();
    els.fileName.value = file.name;
  }

  async function renderTabs() {
    try {
      const entries = await Promise.all(
        state.openTabs.map(async (id) => ({ id, file: await state.fs.get(id) })),
      );
      state.openTabs = entries.filter((e) => e.file).map((e) => e.id);
      els.tabs.innerHTML = '';
      for (const { id, file } of entries) {
        if (!file) continue;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `ws-tab ${state.activeTab === id ? 'is-active' : ''}`;
        tab.innerHTML = `${iconFor(file.kind)} ${escapeHtml(file.name)} <span class="ws-tab-close" data-close="${id}" aria-label="Закрити">×</span>`;
        tab.onclick = (e) => {
          if (e.target.dataset.close) {
            closeTab(e.target.dataset.close);
            return;
          }
          openFile(id);
        };
        els.tabs.appendChild(tab);
      }
    } catch (err) {
      reportError('renderTabs', err);
    }
  }

  function closeTab(id) {
    state.openTabs = state.openTabs.filter((t) => t !== id);
    if (state.activeTab === id) {
      state.activeTab = state.openTabs[state.openTabs.length - 1] || null;
      if (state.activeTab) openFile(state.activeTab);
      else showWelcome();
    }
    void renderTabs();
  }

  function hideAllPanes() {
    els.editorArea.querySelectorAll('.ws-editor-pane').forEach((p) => p.classList.remove('is-active'));
    DocumentEditor.destroy();
    SpreadsheetEditor.destroy();
    PresentationEditor.destroy();
    PdfEditor.destroy();
  }

  function getOrCreatePane(id) {
    let pane = document.getElementById(`pane-${id}`);
    if (!pane) {
      pane = document.createElement('div');
      pane.id = `pane-${id}`;
      pane.className = 'ws-editor-pane';
      els.editorArea.appendChild(pane);
    }
    return pane;
  }

  async function showEditor(file) {
    hideAllPanes();
    const pane = getOrCreatePane(file.id);
    pane.classList.add('is-active');

    const content = typeof file.content === 'string' ? file.content : JSON.stringify(file.content);

    switch (file.kind) {
      case 'document':
      case 'text':
        DocumentEditor.mount(pane);
        DocumentEditor.load(content);
        DocumentEditor.quill.on('text-change', markDirty);
        break;
      case 'spreadsheet':
        SpreadsheetEditor.mount(pane);
        SpreadsheetEditor.load(content, file.id);
        setTimeout(() => {
          document.addEventListener('ws-dirty', markDirty);
        }, 100);
        break;
      case 'presentation':
        PresentationEditor.mount(pane);
        PresentationEditor.load(content);
        pane.addEventListener('input', markDirty);
        break;
      case 'pdf': {
        PdfEditor.mount(pane);
        let data = file.content;
        if (!(data instanceof ArrayBuffer) && typeof data !== 'string') {
          const blob = await state.fs.readBlob(file.id);
          data = await blob.arrayBuffer();
        }
        await PdfEditor.load(data);
        document.addEventListener('ws-dirty', markDirty);
        break;
      }
      case 'zip':
        await showZipView(pane, file);
        break;
      case 'image': {
        const blob = await state.fs.readBlob(file.id);
        const url = URL.createObjectURL(blob);
        pane.innerHTML = `<div class="ws-preview"><img src="${url}" alt="${escapeAttr(file.name)}"><p>${escapeHtml(file.name)}</p></div>`;
        break;
      }
      default:
        pane.innerHTML = `<div class="ws-preview"><p>📎 ${escapeHtml(file.name)}</p><p>Завантажте файл для перегляду на пристрої.</p><button type="button" class="button button-primary" id="ws-dl-binary">Завантажити</button></div>`;
        $('ws-dl-binary').onclick = () => downloadFile(file.id);
    }
  }

  async function showZipView(pane, file) {
    const blob = await state.fs.readBlob(file.id);
    const zip = await JSZip.loadAsync(blob);
    await validateZip(zip);
    const entries = [];
    zip.forEach((path, entry) => entries.push({ path, entry }));
    pane.innerHTML = `
      <div class="ws-zip-view">
        <h3>Архів: ${escapeHtml(file.name)}</h3>
        <p style="margin-bottom:16px">${entries.length} об'єктів у архіві</p>
        <div class="ws-zip-list" id="ws-zip-entries"></div>
        <button type="button" class="button button-primary" style="margin-top:16px" id="ws-zip-extract">Розпакувати в поточну папку</button>
      </div>`;
    const list = $('ws-zip-entries');
    entries.forEach(({ path, entry }) => {
      const div = document.createElement('div');
      div.className = 'ws-zip-item';
      div.innerHTML = `<span>${entry.dir ? '📁' : '📄'} ${escapeHtml(path)}</span>`;
      list.appendChild(div);
    });
    $('ws-zip-extract').onclick = () => extractZip(file, zip);
  }

  async function extractZip(file, zip) {
    try {
      await validateZip(zip);
      let count = 0;
      const tasks = [];
      zip.forEach((path, entry) => {
        if (entry.dir) return;
        tasks.push(entry.async('uint8array').then(async (data) => {
          const name = sanitizeFilename(path.split('/').pop());
          if (!name) return;
          assertFileSize(data.byteLength, name);
          await state.fs.createFile({
            name,
            parentId: state.cwd,
            kind: kindFromName(name),
            mime: MIME.guess(name),
            content: data,
          });
          count += 1;
        }));
      });
      await Promise.all(tasks);
      setStatus(`Розпаковано ${count} файл(ів) з ${file.name}`);
      await refreshTree();
    } catch (err) {
      reportError('extractZip', err);
    }
  }

  const MIME = {
    guess(name) {
      const k = kindFromName(name);
      const map = {
        document: WorkspaceMIME.document,
        spreadsheet: WorkspaceMIME.spreadsheet,
        presentation: WorkspaceMIME.presentation,
        pdf: WorkspaceMIME.pdf,
        zip: WorkspaceMIME.zip,
        text: WorkspaceMIME.text,
        image: 'image/png',
      };
      return map[k] || WorkspaceMIME.binary;
    },
  };

  function showWelcome() {
    hideAllPanes();
    els.fileName.value = '';
    let pane = $('pane-welcome');
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'pane-welcome';
      pane.className = 'ws-editor-pane is-active';
      pane.innerHTML = `
        <div class="ws-welcome">
          <h2>Демо-офіс Averixor Cloud</h2>
          <p>Локальне редагування в браузері (IndexedDB). <strong>Не підключено до Nextcloud.</strong> Імпорт DOCX, XLSX, PDF, ZIP. Експортуйте результат і завантажте в хмару вручну.</p>
          <div class="ws-welcome-cards">
            <button type="button" class="ws-welcome-card" data-new="document"><strong>📄 Документ</strong><span>Текстовий редактор</span></button>
            <button type="button" class="ws-welcome-card" data-new="spreadsheet"><strong>📊 Таблиця</strong><span>Електронна таблиця</span></button>
            <button type="button" class="ws-welcome-card" data-new="presentation"><strong>📽️ Презентація</strong><span>Слайди</span></button>
            <button type="button" class="ws-welcome-card" data-import=""><strong>📥 Імпорт</strong><span>XLSX, CSV, PDF, ZIP…</span></button>
          </div>
        </div>`;
      els.editorArea.appendChild(pane);
      pane.querySelectorAll('[data-new]').forEach((btn) => {
        btn.onclick = () => createNew(btn.dataset.new);
      });
      pane.querySelector('[data-import]').onclick = () => els.fileInput.click();
    }
    pane.classList.add('is-active');
  }

  async function createNew(kind) {
    const names = {
      document: 'Новий документ.averixor-doc',
      spreadsheet: 'Нова таблиця.averixor-sheet',
      presentation: 'Нова презентація.averixor-slides',
      folder: 'Нова папка',
    };
    let file;
    if (kind === 'folder') {
      file = await state.fs.mkdir(names.folder, state.cwd);
      await refreshTree();
      return;
    }
    const defaults = {
      document: JSON.stringify({ html: '<h2>Новий документ</h2><p></p>' }),
      spreadsheet: JSON.stringify({ data: [[{ v: 'Колонка A' }, { v: 'Колонка B' }], [{ v: '' }, { v: '' }]] }),
      presentation: JSON.stringify({ slides: [{ title: 'Заголовок', body: 'Пункт 1\nПункт 2' }] }),
    };
    file = await state.fs.createFile({
      name: names[kind],
      parentId: state.cwd,
      kind,
      mime: WorkspaceMIME[kind],
      content: defaults[kind],
    });
    await openFile(file.id);
    markDirty();
  }

  async function saveCurrent() {
    if (!state.activeTab) return;
    try {
      const file = await state.fs.get(state.activeTab);
      if (!file) return;

      let content = file.content;
      switch (file.kind) {
        case 'document':
        case 'text':
          content = DocumentEditor.serialize();
          break;
        case 'spreadsheet':
          content = SpreadsheetEditor.serialize();
          break;
        case 'presentation':
          content = PresentationEditor.serialize();
          break;
        case 'pdf': {
          const serialized = PdfEditor.serialize();
          if (serialized) content = serialized;
          break;
        }
        default:
          break;
      }

      const newName = els.fileName.value.trim();
      if (newName && newName !== file.name) {
        await state.fs.rename(file.id, newName);
      }
      await state.fs.updateContent(file.id, content);
      markClean();
      await refreshTree();
      await renderTabs();
      setStatus(`Збережено: ${newName || file.name}`);
    } catch (err) {
      reportError('save', err);
    }
  }

  async function exportCurrent() {
    if (!state.activeTab) return;
    const file = await state.fs.get(state.activeTab);
    if (!file) return;

    let blob;
    let name = file.name;

    if (file.kind === 'spreadsheet') {
      const xlsx = SpreadsheetEditor.exportXlsx();
      if (xlsx) {
        blob = new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        name = name.replace(/\.[^.]+$/, '') + '.xlsx';
      }
    } else if (file.kind === 'document') {
      const html = DocumentEditor.exportHtml();
      blob = new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${file.name}</title></head><body>${html}</body></html>`], { type: 'text/html' });
      name = name.replace(/\.[^.]+$/, '') + '.html';
    } else if (file.kind === 'presentation') {
      blob = new Blob([PresentationEditor.serialize()], { type: 'application/json' });
    } else if (file.kind === 'pdf') {
      // exportPdf() — лише для завантаження (вбудовує анотації з пам'яті сесії).
      // Персистенція — тільки через saveCurrent() → serialize().
      const buf = await PdfEditor.exportPdf();
      if (buf) blob = new Blob([buf], { type: 'application/pdf' });
    } else {
      blob = await state.fs.readBlob(file.id);
    }

    if (blob) saveAs(blob, name);
  }

  async function downloadFile(id) {
    const file = await state.fs.get(id);
    const blob = await state.fs.readBlob(id);
    if (blob && file) saveAs(blob, file.name);
  }

  async function exportAll() {
    try {
      performance.mark('ws-export-all-start');
      const files = await state.fs.listAllFiles();
      if (!files.length) {
        setStatus('Немає файлів для експорту');
        return;
      }
      const zip = new JSZip();
      for (const { file, path } of files) {
        const full = await state.fs.get(file.id);
        if (!full || full.content == null) continue;
        if (typeof full.content === 'string') {
          zip.file(path, full.content);
        } else if (full.content instanceof ArrayBuffer) {
          zip.file(path, full.content);
        } else if (full.content instanceof Uint8Array) {
          zip.file(path, full.content);
        } else {
          zip.file(path, JSON.stringify(full.content));
        }
      }
      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      performance.mark('ws-export-all-end');
      performance.measure('ws-export-all', 'ws-export-all-start', 'ws-export-all-end');
      const measure = performance.getEntriesByName('ws-export-all').pop();
      const stamp = new Date().toISOString().slice(0, 10);
      saveAs(out, `averixor-workspace-${stamp}.zip`);
      markBackupDone();
      setStatus(`Експортовано ${files.length} файл(ів) за ${Math.round(measure?.duration || 0)} мс`);
    } catch (err) {
      reportError('exportAll', err);
    }
  }

  async function handleImport(fileList) {
    try {
      let imported = 0;
      for (const file of fileList) {
        const buf = await file.arrayBuffer();
        assertFileSize(buf.byteLength, file.name);
        const name = sanitizeFilename(file.name);
        const ext = name.split('.').pop().toLowerCase();

        if (ext === 'zip') {
          const zip = await JSZip.loadAsync(buf);
          await validateZip(zip);
          await state.fs.createFile({
            name,
            parentId: state.cwd,
            kind: 'zip',
            mime: WorkspaceMIME.zip,
            content: buf,
          });
          imported += 1;
          continue;
        }

      if (['xlsx', 'xls', 'ods'].includes(ext)) {
        const content = await importXlsxToContent(buf);
        await state.fs.createFile({
          name: name.replace(/\.[^.]+$/, '.averixor-sheet'),
          parentId: state.cwd,
          kind: 'spreadsheet',
          mime: WorkspaceMIME.spreadsheet,
          content,
        });
        imported += 1;
        continue;
      }

      if (ext === 'csv') {
        const text = new TextDecoder().decode(buf);
        const content = await importCsvToContent(text);
        await state.fs.createFile({
          name: name.replace(/\.csv$/, '.averixor-sheet'),
          parentId: state.cwd,
          kind: 'spreadsheet',
          mime: WorkspaceMIME.spreadsheet,
          content,
        });
        imported += 1;
        continue;
      }

      if (ext === 'pdf') {
        await state.fs.createFile({
          name,
          parentId: state.cwd,
          kind: 'pdf',
          mime: WorkspaceMIME.pdf,
          content: buf,
        });
        imported += 1;
        continue;
      }

      if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
        let html = '<p>Імпортований документ</p>';
        if (ext === 'docx' && window.mammoth) {
          const result = await mammoth.convertToHtml({ arrayBuffer: buf });
          html = sanitizeHtml(result.value);
        } else {
          html = `<p>${escapeHtml(new TextDecoder().decode(buf).slice(0, 50000))}</p>`;
        }
        await state.fs.createFile({
          name: name.replace(/\.[^.]+$/, '.averixor-doc'),
          parentId: state.cwd,
          kind: 'document',
          mime: WorkspaceMIME.document,
          content: JSON.stringify({ html }),
        });
        imported += 1;
        continue;
      }

      if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        await state.fs.createFile({
          name,
          parentId: state.cwd,
          kind: 'image',
          mime: file.type || 'image/png',
          content: buf,
        });
        imported += 1;
        continue;
      }

      if (['txt', 'md', 'json', 'xml'].includes(ext)) {
        const text = new TextDecoder().decode(buf);
        await state.fs.createFile({
          name,
          parentId: state.cwd,
          kind: ext === 'md' || ext === 'txt' ? 'document' : 'text',
          mime: WorkspaceMIME.text,
          content: JSON.stringify({ html: `<pre>${escapeHtml(text)}</pre>` }),
        });
        imported += 1;
        continue;
      }

      await state.fs.createFile({
        name,
        parentId: state.cwd,
        kind: kindFromName(name),
        mime: file.type || WorkspaceMIME.binary,
        content: buf,
      });
      imported += 1;
    }
    await refreshTree();
    setStatus(`Імпортовано ${imported} файл(ів)`);
    } catch (err) {
      reportError('import', err);
    }
  }

  async function deleteSelected() {
    if (!state.activeTab) return;
    if (!confirm('Видалити цей файл?')) return;
    const id = state.activeTab;
    closeTab(id);
    await state.fs.delete(id);
    await refreshTree();
    setStatus('Видалено');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function bindUi() {
    els.saveBtn.onclick = () => saveCurrent();
    els.exportBtn.onclick = () => exportCurrent();
    els.exportAllBtn.onclick = () => exportAll();
    els.encryptedBackupBtn.onclick = () => exportEncryptedBackup();
    els.restoreBtn.onclick = () => openRestoreWizard();
    els.encryptBtn.onclick = () => enableEncryptionFlow().catch((e) => reportError('encrypt', e));
    els.importBtn.onclick = () => els.fileInput.click();
    els.fileInput.onchange = (e) => {
      if (e.target.files.length) handleImport(e.target.files);
      e.target.value = '';
    };
    els.newDoc.onclick = () => createNew('document');
    els.newSheet.onclick = () => createNew('spreadsheet');
    els.newSlides.onclick = () => createNew('presentation');
    els.newFolder.onclick = () => createNew('folder');
    els.deleteBtn.onclick = () => deleteSelected();
    els.fileName.onchange = markDirty;

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrent();
      }
    });
  }

  async function init() {
    try {
    els.status = $('ws-status');
    els.fileTree = $('ws-file-tree');
    els.treeTitle = $('ws-tree-title');
    els.tabs = $('ws-tabs');
    els.editorArea = $('ws-editor-area');
    els.fileName = $('ws-file-name');
    els.fileInput = $('ws-file-input');
    els.saveBtn = $('ws-save');
    els.exportBtn = $('ws-export');
    els.exportAllBtn = $('ws-export-all');
    els.encryptedBackupBtn = $('ws-encrypted-backup');
    els.restoreBtn = $('ws-restore');
    els.encryptBtn = $('ws-encrypt');
    els.importBtn = $('ws-import');
    els.newDoc = $('ws-new-doc');
    els.newSheet = $('ws-new-sheet');
    els.newSlides = $('ws-new-slides');
    els.newFolder = $('ws-new-folder');
    els.deleteBtn = $('ws-delete');

    await state.fs.init();
    bindUi();
    window.addEventListener('ws-schema-upgrade', () => {
      setStatus('Оновлено схему БД — зробіть «Усе в ZIP» перед роботою');
      const el = $('ws-backup-banner');
      if (el) el.hidden = false;
    });
    if (state.fs.encryptionEnabled && !state.fs.isUnlocked()) {
      try {
        await ensureUnlocked();
      } catch (err) {
        reportError('unlock', err);
      }
    }
    checkBackupReminder();
    $('ws-backup-now')?.addEventListener('click', () => exportEncryptedBackup());
    $('ws-backup-plain')?.addEventListener('click', () => exportAll());
    $('ws-backup-dismiss')?.addEventListener('click', () => {
      markBackupDone();
    });
    $('ws-restore-close')?.addEventListener('click', closeRestoreWizard);
    $('ws-restore-cancel')?.addEventListener('click', closeRestoreWizard);
    $('ws-restore-pick')?.addEventListener('click', () => $('ws-restore-input')?.click());
    $('ws-restore-input')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) onRestoreFileSelected(f);
      e.target.value = '';
    });
    $('ws-restore-password-next')?.addEventListener('click', () => {
      const pw = $('ws-restore-password')?.value || '';
      if (pw.length < 8) {
        reportError('restore', new Error('Пароль — мінімум 8 символів'));
        return;
      }
      showRestoreStep('confirm');
    });
    $('ws-restore-confirm')?.addEventListener('click', async () => {
      try {
        const pw = state.restoreEncrypted ? ($('ws-restore-password')?.value || '') : null;
        await runRestore(pw);
      } catch (err) {
        reportError('restore', err);
      }
    });
    await refreshTree();
    showWelcome();
    setStatus('Готово');
    } catch (err) {
      reportError('init', err);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

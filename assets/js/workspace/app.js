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
  const BACKUP_SNOOZE_KEY = 'averixor-ws-backup-snooze';
  const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const BACKUP_SNOOZE_MS = 24 * 60 * 60 * 1000;
  let onWsDirty = null;
  let autosaveTimer = null;

  function markBackupDone() {
    try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* empty */ }
    hideBackupBanner();
  }

  function hideBackupBanner() {
    const el = $('ws-backup-banner');
    if (el) el.hidden = true;
  }

  function snoozeBackupBanner() {
    try { localStorage.setItem(BACKUP_SNOOZE_KEY, String(Date.now())); } catch { /* empty */ }
    hideBackupBanner();
  }

  function checkBackupReminder() {
    const el = $('ws-backup-banner');
    if (!el) return;
    let snooze = 0;
    try { snooze = Number(localStorage.getItem(BACKUP_SNOOZE_KEY) || 0); } catch { /* empty */ }
    if (snooze && Date.now() - snooze < BACKUP_SNOOZE_MS) return;
    let last = 0;
    try { last = Number(localStorage.getItem(BACKUP_KEY) || 0); } catch { /* empty */ }
    if (!last || Date.now() - last > BACKUP_INTERVAL_MS) {
      el.hidden = false;
    }
  }

  function safeAsync(fn) {
    return (...args) => {
      Promise.resolve(fn(...args)).catch((err) => reportError('action', err));
    };
  }

  // --- Custom modal system (replaces raw window.prompt/confirm for pre-release polish) ---
  let dialogResolver = null;
  let dialogCleanup = null;

  function closeDialog(result) {
    const modal = $('ws-dialog-modal');
    if (modal) modal.hidden = true;
    if (dialogCleanup) { dialogCleanup(); dialogCleanup = null; }
    const res = dialogResolver;
    dialogResolver = null;
    if (res) res(result);
  }

  function showDialog({ title, bodyHTML, actions = [], cancelLabel = 'Скасувати', allowCancel = true }) {
    return new Promise((resolve) => {
      const modal = $('ws-dialog-modal');
      const titleEl = $('ws-dialog-title');
      const bodyEl = $('ws-dialog-body');
      const actionsEl = $('ws-dialog-actions');
      const cancelBtn = $('ws-dialog-cancel');
      if (!modal || !titleEl || !bodyEl || !actionsEl || !cancelBtn) {
        // fallback to native if elements missing (should not happen)
        const r = window.confirm(title + '\n\n' + (bodyHTML || ''));
        return resolve(r ? (actions[0] && actions[0].value != null ? actions[0].value : true) : null);
      }

      titleEl.textContent = title || '';
      bodyEl.innerHTML = bodyHTML || '';
      actionsEl.innerHTML = '';

      dialogResolver = resolve;

      actions.forEach((act, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = act.primary ? 'button button-primary' : 'button button-secondary';
        btn.textContent = act.label;
        btn.onclick = () => {
          closeDialog(act.value != null ? act.value : true);
        };
        actionsEl.appendChild(btn);
      });

      const onCancel = () => closeDialog(null);
      cancelBtn.onclick = onCancel;
      cancelBtn.hidden = !allowCancel;

      const backdrop = $('ws-dialog-backdrop');
      const onBackdrop = (e) => { if (e.target === backdrop) onCancel(); };
      if (backdrop) backdrop.addEventListener('click', onBackdrop, { once: true });

      // Keyboard support
      const onKey = (e) => {
        if (e.key === 'Escape' && allowCancel) {
          e.preventDefault();
          onCancel();
        }
        if (e.key === 'Enter' && actions.length) {
          // activate first primary or first action
          const primary = actionsEl.querySelector('.button-primary') || actionsEl.querySelector('.button');
          if (primary) primary.click();
        }
      };
      document.addEventListener('keydown', onKey, { once: true });

      dialogCleanup = () => {
        if (backdrop) backdrop.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
      };

      modal.hidden = false;
      // focus first input if any
      const firstInput = bodyEl.querySelector('input');
      if (firstInput) setTimeout(() => firstInput.focus(), 0);

      // lightweight strength hint (for password dialogs)
      const pwInp = bodyEl.querySelector('#ws-dlg-pw1');
      const strEl = document.getElementById('ws-pw-strength');
      if (pwInp && strEl) {
        const update = () => {
          const v = pwInp.value || '';
          if (!v) { strEl.textContent = ''; return; }
          let lvl = 'слабкий';
          if (v.length >= 16 && /[A-Z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v)) lvl = 'відмінний';
          else if (v.length >= 12 && /[A-Z]/.test(v) && /\d/.test(v)) lvl = 'добрий';
          else if (v.length >= 8) lvl = 'середній';
          strEl.textContent = `Міцність: ${lvl}`;
        };
        pwInp.addEventListener('input', update, { passive: true });
        update();
      }

      // attach show/hide toggles while dialog is open (before user submits)
      bodyEl.querySelectorAll('.ws-pw-toggle').forEach((t) => {
        t.onclick = () => {
          const targetId = t.dataset.for;
          const inp = document.getElementById(targetId);
          if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
          t.textContent = (inp && inp.type === 'text') ? '🙈' : '👁';
        };
      });
    });
  }

  async function promptPassword(message, { requireConfirm = false, title = 'Введіть пароль' } = {}) {
    const body = `
      <p>${escapeHtml(message || 'Введіть пароль (мін. 8 символів):')}</p>
      <div class="ws-pw-row">
        <input type="password" id="ws-dlg-pw1" autocomplete="new-password" minlength="8" placeholder="Пароль" />
        <button type="button" class="ws-pw-toggle" data-for="ws-dlg-pw1" aria-label="Показати пароль">👁</button>
      </div>
      <div class="ws-pw-hint" id="ws-pw-strength"></div>
      ${requireConfirm ? `
        <div class="ws-pw-row">
          <input type="password" id="ws-dlg-pw2" autocomplete="new-password" minlength="8" placeholder="Повторіть пароль" />
          <button type="button" class="ws-pw-toggle" data-for="ws-dlg-pw2" aria-label="Показати пароль">👁</button>
        </div>
        <div class="ws-pw-hint">Паролі повинні збігатися</div>
      ` : ''}
    `;
    const res = await showDialog({
      title,
      bodyHTML: body,
      actions: [{ label: 'OK', value: 'submit', primary: true }],
      allowCancel: true,
    });
    if (!res) return null;

    const pw1 = ($('ws-dlg-pw1') || {}).value || '';
    const pw2 = requireConfirm ? (($('ws-dlg-pw2') || {}).value || '') : pw1;

    if (!pw1 || pw1.length < 8) {
      throw new Error('Пароль має бути не менше 8 символів');
    }
    if (requireConfirm && pw1 !== pw2) {
      throw new Error('Паролі не збігаються');
    }

    return pw1;
  }

  async function wsConfirm(message, { danger = false, title = 'Підтвердження' } = {}) {
    const body = `<p>${escapeHtml(message)}</p>`;
    const res = await showDialog({
      title,
      bodyHTML: body,
      actions: [
        { label: danger ? 'Так, продовжити' : 'Так', value: true, primary: !danger },
        { label: 'Ні', value: false, primary: false }
      ],
      allowCancel: true,
    });
    return !!res;
  }

  async function ensureUnlocked() {
    if (state.fs.isUnlocked()) return;
    const pw = await promptPassword('Сховище зашифроване. Введіть пароль:');
    if (!pw) throw new Error('Скасовано');
    await state.fs.unlockWithPassword(pw);
  }

  async function enableEncryptionFlow() {
    const pw1 = await promptPassword('Новий пароль шифрування (мін. 8 символів):', { requireConfirm: true, title: 'Увімкнути шифрування' });
    if (!pw1) return;
    const ok = await wsConfirm('Увімкнути шифрування всіх локальних файлів? Спочатку зробіть резервну копію (🔐).', { title: 'Шифрування сховища', danger: true });
    if (!ok) return;
    setStatus('Шифрування…');
    await state.fs.enableEncryption(pw1);
    setStatus('Шифрування увімкнено');
  }

  async function exportEncryptedBackup() {
    try {
      await ensureUnlocked();
      if (state.dirty && state.activeTab) await saveCurrent();
      const pw1 = await promptPassword('Пароль зашифрованої резервної копії (мін. 8 символів):', { requireConfirm: true, title: 'Зашифрована резервна копія' });
      if (!pw1) return;
      setStatus('Створення резервної копії Argon2id + AES-256-GCM…');
      const manifestPreview = await window.WorkspaceBackup.buildManifest(state.fs);
      const jsonSize = new TextEncoder().encode(JSON.stringify(manifestPreview)).byteLength;
      const sizeMb = (jsonSize / 1024 / 1024).toFixed(2);
      const limitMb = Math.round(window.WorkspaceSecurity.LIMITS.maxBackupBytes / 1024 / 1024);
      const sizeOk = await wsConfirm(
        `Розмір резервної копії: ~${sizeMb} МБ (${manifestPreview.recordCount} записів).\nЛіміт: ${limitMb} МБ.\n\nПродовжити створення зашифрованої резервної копії?`,
        { title: 'Підтвердити створення бэкапу' }
      );
      if (!sizeOk) return;
      const suggested = window.WorkspaceCrypto.suggestArgon2Profile();
      const useFast = await wsConfirm(
        suggested.memory <= 16384
          ? 'Рекомендуємо швидкий Argon2 (worker, менше навантаження на CPU). Так = швидкий, Ні = стандартний'
          : 'Швидкий Argon2 (менше CPU, трохи слабший)? Так = швидкий, Ні = стандартний (64MB, worker)',
        { title: 'Профіль Argon2' }
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
      setStatus(`Зашифрована резервна копія: ${manifest.recordCount} записів`);
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
    // wizard already presented modes + warning text; proceed directly (no double-confirm)

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
      : `Відновлено ${manifest.recordCount} записів з резервної копії`;
    setStatus(msg);
  }

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, tone) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.classList.remove('is-busy', 'is-ok', 'is-warn', 'is-error');
    if (tone) els.status.classList.add(tone);
    else if (/завантаж|шифру|резерв|експорт|імпорт|віднов|збереж/i.test(msg)) els.status.classList.add('is-busy');
    else if (/готово|збережено/i.test(msg)) els.status.classList.add('is-ok');
    else if (/незбережен|нагад/i.test(msg)) els.status.classList.add('is-warn');
    else if (/помилк/i.test(msg)) els.status.classList.add('is-error');
  }

  function markDirty() {
    state.dirty = true;
    setStatus('Є незбережені зміни (автозбереження…)');
    scheduleAutosave();
  }

  function markClean() {
    state.dirty = false;
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    setStatus('Збережено');
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      if (state.dirty && state.activeTab) {
        saveCurrent().catch((e) => { /* silent autosave fail, manual still works */ });
      }
    }, 1500);
  }

  function reportError(scope, err) {
    console.error(`[workspace:${scope}]`, err);
    const msg = err?.message || String(err);
    setStatus(`Помилка: ${msg}`, 'is-error');
    const alertEl = $('ws-error-alert');
    if (alertEl) {
      alertEl.hidden = false;
      alertEl.textContent = msg;
    }
  }

  function checkWorkspaceLibs() {
    const missing = [];
    if (typeof window.Quill !== 'function') missing.push('Quill (документи)');
    if (typeof window.jspreadsheet !== 'function') missing.push('jSpreadsheet (таблиці)');
    if (typeof window.XLSX === 'undefined') missing.push('SheetJS (імпорт/експорт XLSX)');
    if (missing.length) {
      reportError(
        'libs',
        new Error(
          `Не завантажено офісні бібліотеки: ${missing.join(', ')}. Перевірте інтернет або оновіть сторінку (Ctrl+Shift+R).`,
        ),
      );
      return false;
    }
    return true;
  }

  function assertEditorLib(kind) {
    if (kind === 'document' || kind === 'text') {
      if (typeof window.Quill !== 'function') {
        throw new Error('Редактор документів (Quill) не завантажився. Оновіть сторінку.');
      }
    }
    if (kind === 'spreadsheet') {
      if (typeof window.jspreadsheet !== 'function') {
        throw new Error('Редактор таблиць (jSpreadsheet) не завантажився. Оновіть сторінку.');
      }
    }
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
      up.onclick = safeAsync(() => navigateUp());
      els.fileTree.appendChild(up);
    }

    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ws-file-item ${item.kind === 'folder' ? 'is-folder' : ''} ${state.activeTab === item.id ? 'is-active' : ''}`;
      btn.dataset.id = item.id;
      if (state.activeTab === item.id) btn.setAttribute('aria-current', 'true');
      btn.innerHTML = `<span class="ws-file-icon">${iconFor(item.kind)}</span><span>${escapeHtml(item.name)}</span>`;
      btn.onclick = safeAsync(() => openItem(item));
      els.fileTree.appendChild(btn);
    });

    if (items.length === 0 && state.cwd === ROOT_ID) {
      const empty = document.createElement('p');
      empty.className = 'ws-tree-empty';
      empty.textContent = 'Папка порожня. Створіть документ або імпортуйте файл.';
      els.fileTree.appendChild(empty);
    }
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
    try {
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
    } catch (err) {
      if (err?.code === 'LOCKED') {
        try {
          await ensureUnlocked();
          return openFile(id);
        } catch (unlockErr) {
          reportError('open', unlockErr);
        }
        return;
      }
      reportError('open', err);
    }
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
            safeAsync(() => closeTab(e.target.dataset.close))();
            return;
          }
          safeAsync(() => openFile(id))();
        };
        els.tabs.appendChild(tab);
      }
    } catch (err) {
      reportError('renderTabs', err);
    }
  }

  async function closeTab(id) {
    if (state.dirty && state.activeTab === id) {
      const ok = await wsConfirm('Є незбережені зміни. Закрити без збереження?', { title: 'Закрити вкладку' });
      if (!ok) return false;
      state.dirty = false;
    }
    state.openTabs = state.openTabs.filter((t) => t !== id);
    if (state.activeTab === id) {
      state.activeTab = state.openTabs[state.openTabs.length - 1] || null;
      if (state.activeTab) void openFile(state.activeTab);
      else showWelcome();
    }
    void renderTabs();
    return true;
  }

  function detachWsDirtyListener() {
    if (onWsDirty) {
      document.removeEventListener('ws-dirty', onWsDirty);
      onWsDirty = null;
    }
  }

  function attachWsDirtyListener() {
    detachWsDirtyListener();
    onWsDirty = markDirty;
    document.addEventListener('ws-dirty', onWsDirty);
  }

  function hideAllPanes() {
    detachWsDirtyListener();
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

  function focusEditorArea(file) {
    requestAnimationFrame(() => {
      const main = document.querySelector('.workspace-main');
      const area = els.editorArea;
      if (main && window.matchMedia('(max-width: 900px)').matches) {
        main.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      area?.scrollTo({ top: 0, behavior: 'smooth' });
      if (file?.kind === 'document' || file?.kind === 'text') {
        DocumentEditor.quill?.focus();
      } else if (file?.kind === 'spreadsheet') {
        area?.querySelector('.jexcel_content')?.focus?.();
      } else if (file?.kind === 'presentation') {
        $('ws-slide-title')?.focus();
      }
    });
  }

  async function showEditor(file) {
    try {
    assertEditorLib(file.kind);
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
        setTimeout(() => attachWsDirtyListener(), 100);
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
        attachWsDirtyListener();
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
        $('ws-dl-binary').onclick = safeAsync(() => downloadFile(file.id));
    }
    } catch (err) {
      reportError('editor', err);
      return;
    }
    focusEditorArea(file);
    setStatus(`Відкрито: ${file.name}`);
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
          <p class="ws-welcome-eyebrow">Локальний демо-офіс</p>
          <h2>Демо-офіс Averixor Cloud</h2>
          <p class="ws-welcome-lead">Редагування в браузері · IndexedDB · без Nextcloud. Імпорт DOCX, XLSX, PDF, ZIP — експортуйте й завантажте в хмару вручну.</p>
          <div class="ws-welcome-cards">
            <button type="button" class="ws-welcome-card" data-new="document"><span class="ws-welcome-card-icon" aria-hidden="true">📄</span><strong>Документ</strong><span>Текстовий редактор</span></button>
            <button type="button" class="ws-welcome-card" data-new="spreadsheet"><span class="ws-welcome-card-icon" aria-hidden="true">📊</span><strong>Таблиця</strong><span>Електронна таблиця</span></button>
            <button type="button" class="ws-welcome-card" data-new="presentation"><span class="ws-welcome-card-icon" aria-hidden="true">📽️</span><strong>Презентація</strong><span>Слайди</span></button>
            <button type="button" class="ws-welcome-card" data-import=""><span class="ws-welcome-card-icon" aria-hidden="true">📥</span><strong>Імпорт</strong><span>XLSX, CSV, PDF, ZIP…</span></button>
          </div>
        </div>`;
      els.editorArea.appendChild(pane);
      pane.querySelectorAll('[data-new]').forEach((btn) => {
        btn.onclick = safeAsync(() => createNew(btn.dataset.new));
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
    const ok = await wsConfirm('Видалити цей файл? Назва: ' + (els.fileName?.value || ''), { title: 'Видалення файлу', danger: true });
    if (!ok) return;
    const id = state.activeTab;
    await closeTab(id);
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
    els.saveBtn.onclick = safeAsync(() => saveCurrent());
    els.exportBtn.onclick = safeAsync(() => exportCurrent());
    els.exportAllBtn.onclick = safeAsync(() => exportAll());
    els.encryptedBackupBtn.onclick = () => exportEncryptedBackup();
    els.restoreBtn.onclick = () => openRestoreWizard();
    els.encryptBtn.onclick = safeAsync(() => enableEncryptionFlow());
    els.importBtn.onclick = () => els.fileInput.click();
    els.fileInput.onchange = (e) => {
      if (e.target.files.length) safeAsync(() => handleImport(e.target.files))();
      e.target.value = '';
    };
    els.newDoc.onclick = safeAsync(() => createNew('document'));
    els.newSheet.onclick = safeAsync(() => createNew('spreadsheet'));
    els.newSlides.onclick = safeAsync(() => createNew('presentation'));
    els.newFolder.onclick = safeAsync(() => createNew('folder'));
    els.deleteBtn.onclick = safeAsync(() => deleteSelected());
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
        safeAsync(() => saveCurrent())();
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
    if (!checkWorkspaceLibs()) {
      setStatus('Бібліотеки не завантажені', 'is-error');
    }
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
      snoozeBackupBanner();
    });
    $('ws-open-cloud')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window.openAverixorCloud === 'function') {
        window.openAverixorCloud();
        return;
      }
      const url =
        e.currentTarget?.dataset?.cloudUrl ||
        window.AverixorCloudConfig?.url ||
        'https://cloud.averixor.xyz/';
      window.open(url, '_blank', 'noopener');
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

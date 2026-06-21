/**
 * Averixor Cloud — валідація імпорту (розмір, імена, zip bomb)
 */
(() => {
  'use strict';

  const LIMITS = {
    maxFileBytes: 50 * 1024 * 1024,
    maxZipEntries: 500,
    maxZipUncompressedBytes: 120 * 1024 * 1024,
    maxSingleZipEntryBytes: 50 * 1024 * 1024,
    maxFilenameLength: 200,
    maxZipPathDepth: 8,
    maxBackupBytes: 250 * 1024 * 1024,
  };

  function sanitizeFilename(name) {
    if (!name || typeof name !== 'string') return 'file';
    let base = name.split(/[/\\]/).pop() || 'file';
    base = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
    if (!base || base === '.' || base === '..') base = 'file';
    if (base.length > LIMITS.maxFilenameLength) {
      const ext = base.includes('.') ? `.${base.split('.').pop()}` : '';
      base = base.slice(0, LIMITS.maxFilenameLength - ext.length) + ext;
    }
    return base;
  }

  function assertFileSize(bytes, label = 'Файл') {
    if (bytes > LIMITS.maxFileBytes) {
      throw new Error(`${label} перевищує ліміт ${Math.round(LIMITS.maxFileBytes / 1024 / 1024)} МБ`);
    }
  }

  function sanitizeHtml(html) {
    if (!html || typeof html !== 'string') return '';
    if (window.DOMPurify) {
      return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      });
    }
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  async function validateZip(zip) {
    let entryCount = 0;
    let totalUncompressed = 0;
    const tasks = [];

    zip.forEach((path, entry) => {
      entryCount += 1;
      if (entryCount > LIMITS.maxZipEntries) {
        throw new Error(`ZIP: занадто багато записів (>${LIMITS.maxZipEntries})`);
      }
      const depth = path.split('/').filter(Boolean).length;
      if (depth > LIMITS.maxZipPathDepth) {
        throw new Error(`ZIP: занадто глибокий шлях (${path})`);
      }
      if (/\.\.(\/|$)/.test(path) || path.startsWith('/')) {
        throw new Error(`ZIP: небезпечний шлях (${path})`);
      }
      if (entry.dir) return;
      tasks.push(
        entry.async('uint8array').then((data) => {
          if (data.byteLength > LIMITS.maxSingleZipEntryBytes) {
            throw new Error(`ZIP: файл ${path} занадто великий`);
          }
          totalUncompressed += data.byteLength;
          if (totalUncompressed > LIMITS.maxZipUncompressedBytes) {
            throw new Error('ZIP: перевищено сумарний розпакований обсяг (zip bomb?)');
          }
        }),
      );
    });

    await Promise.all(tasks);
    return { entryCount, totalUncompressed };
  }

  function assertBackupSize(bytes) {
    if (bytes > LIMITS.maxBackupBytes) {
      throw new Error(`Бэкап перевищує ліміт ${Math.round(LIMITS.maxBackupBytes / 1024 / 1024)} МБ`);
    }
  }

  window.WorkspaceSecurity = {
    LIMITS,
    sanitizeFilename,
    sanitizeHtml,
    assertFileSize,
    assertBackupSize,
    validateZip,
  };
})();

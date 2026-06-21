/**
 * Averixor Cloud — криптографія: Argon2id (Web Worker) + PBKDF2 (legacy)
 */
(() => {
  'use strict';

  const PBKDF2_ITERATIONS = 600000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const VERIFIER_PLAIN = 'averixor-crypto-v1-ok';
  const BACKUP_MAGIC = 'AVXRBACK1';
  const KDF_NONE = 0;
  const KDF_ARGON2ID = 1;
  const KDF_PBKDF2 = 2;

  /** Стандарт: безпечніше, повільніше (~4–12 с на слабких ПК) */
  const DEFAULT_ARGON2 = { type: 'argon2id', memory: 65536, iterations: 3, parallelism: 4 };
  /** Швидкий: мобільні / слабкі CPU (~1–3 с) */
  const FAST_ARGON2 = { type: 'argon2id', memory: 16384, iterations: 2, parallelism: 2 };

  let argon2Worker = null;
  let workerMsgId = 0;
  const workerPending = new Map();

  function b64(bytes) {
    let bin = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomSalt() {
    return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  }

  function u32le(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  }

  function readU32le(buf, off) {
    return new DataView(buf.buffer, buf.byteOffset + off, 4).getUint32(0, true);
  }

  function workerScriptUrl() {
    const tag = document.querySelector('script[src*="workspace/crypto.js"]');
    if (tag && tag.src) {
      return new URL('crypto-worker.js', tag.src).href;
    }
    return '/assets/js/workspace/crypto-worker.js';
  }

  function getArgon2Worker() {
    if (argon2Worker) return argon2Worker;
    argon2Worker = new Worker(workerScriptUrl());
    argon2Worker.onmessage = (event) => {
      const { id, ok, hash, error } = event.data;
      const pending = workerPending.get(id);
      if (!pending) return;
      workerPending.delete(id);
      if (ok) pending.resolve(new Uint8Array(hash));
      else pending.reject(new Error(error || 'Argon2 worker failed'));
    };
    argon2Worker.onerror = (err) => {
      workerPending.forEach(({ reject }) => reject(err));
      workerPending.clear();
    };
    return argon2Worker;
  }

  function argon2HashInWorker(password, salt, params) {
    const worker = getArgon2Worker();
    const id = ++workerMsgId;
    return new Promise((resolve, reject) => {
      workerPending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        password,
        salt: Array.from(salt instanceof Uint8Array ? salt : new Uint8Array(salt)),
        params,
      });
    });
  }

  async function deriveKeyPbkdf2(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async function deriveKeyArgon2id(password, salt, params = DEFAULT_ARGON2) {
    let hashBytes;
    try {
      hashBytes = await argon2HashInWorker(password, salt, params);
    } catch (workerErr) {
      console.warn('[crypto] Argon2 worker failed, trying main-thread fallback', workerErr);
      if (!window.argon2) {
        throw new Error('Argon2 недоступний');
      }
      const result = await argon2.hash({
        pass: password,
        salt,
        time: params.iterations,
        mem: params.memory,
        parallelism: params.parallelism,
        hashLen: 32,
        type: argon2.ArgonType.Argon2id,
        raw: true,
      });
      hashBytes = result.hash;
    }
    return crypto.subtle.importKey(
      'raw',
      hashBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async function deriveKey(password, salt, kdf = DEFAULT_ARGON2) {
    if (kdf && kdf.type === 'pbkdf2') {
      return deriveKeyPbkdf2(password, salt);
    }
    return deriveKeyArgon2id(password, salt, kdf || DEFAULT_ARGON2);
  }

  function suggestArgon2Profile() {
    const weakCpu = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    return (weakCpu || mobile) ? FAST_ARGON2 : DEFAULT_ARGON2;
  }

  async function encryptBytes(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv, ciphertext: new Uint8Array(ct) };
  }

  async function decryptBytes(key, iv, ciphertext) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new Uint8Array(pt);
  }

  async function encryptPayload(key, payload) {
    const enc = new TextEncoder();
    const { iv, ciphertext } = await encryptBytes(key, enc.encode(payload));
    return { iv: b64(iv), data: b64(ciphertext) };
  }

  async function decryptPayload(key, ivB64, dataB64) {
    const pt = await decryptBytes(key, fromB64(ivB64), fromB64(dataB64));
    return new TextDecoder().decode(pt);
  }

  function isEncryptedContent(content) {
    return content && typeof content === 'object' && content._enc === 1 && content.iv && content.data;
  }

  async function wrapContent(key, content) {
    let payload;
    let contentType = 'null';
    if (content == null) {
      payload = JSON.stringify({ contentType, value: null });
    } else if (typeof content === 'string') {
      contentType = 'string';
      payload = JSON.stringify({ contentType, value: content });
    } else if (content instanceof ArrayBuffer) {
      contentType = 'arraybuffer';
      payload = JSON.stringify({ contentType, value: b64(new Uint8Array(content)) });
    } else {
      contentType = 'json';
      payload = JSON.stringify({ contentType, value: content });
    }
    const { iv, data } = await encryptPayload(key, payload);
    return { _enc: 1, iv, data };
  }

  async function unwrapContent(key, wrapped) {
    const json = await decryptPayload(key, wrapped.iv, wrapped.data);
    const parsed = JSON.parse(json);
    if (parsed.contentType === 'null' || parsed.value == null) return null;
    if (parsed.contentType === 'string') return parsed.value;
    if (parsed.contentType === 'arraybuffer') return fromB64(parsed.value).buffer;
    return parsed.value;
  }

  async function createVerifier(key) {
    return encryptPayload(key, VERIFIER_PLAIN);
  }

  async function checkVerifier(key, verifier) {
    try {
      const plain = await decryptPayload(key, verifier.iv, verifier.data);
      return plain === VERIFIER_PLAIN;
    } catch {
      return false;
    }
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function packEncryptedBackup(jsonUtf8, password, kdf = DEFAULT_ARGON2) {
    const salt = randomSalt();
    const key = await deriveKey(password, salt, kdf);
    const { iv, ciphertext } = await encryptBytes(key, jsonUtf8);
    const magic = new TextEncoder().encode(BACKUP_MAGIC);
    const parts = [
      magic,
      new Uint8Array([1]),
      new Uint8Array([KDF_ARGON2ID]),
      salt,
      u32le(kdf.memory),
      u32le(kdf.iterations),
      new Uint8Array([kdf.parallelism]),
      iv,
      u32le(ciphertext.length),
      ciphertext,
    ];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  function packPlainBackup(jsonUtf8) {
    const magic = new TextEncoder().encode(BACKUP_MAGIC);
    const parts = [magic, new Uint8Array([1]), new Uint8Array([KDF_NONE]), u32le(jsonUtf8.length), jsonUtf8];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  function parseBackupHeader(buf) {
    const magic = new TextDecoder().decode(buf.slice(0, 9));
    if (magic !== BACKUP_MAGIC) {
      throw new Error('Невідомий формат бэкапу (очікується .averixor-backup)');
    }
    const version = buf[9];
    if (version !== 1) throw new Error(`Версія бэкапу ${version} не підтримується`);
    const kdfType = buf[10];
    if (kdfType === KDF_NONE) {
      const len = readU32le(buf, 11);
      const payload = buf.slice(15, 15 + len);
      return { encrypted: false, payload };
    }
    if (kdfType === KDF_ARGON2ID) {
      const salt = buf.slice(11, 27);
      const memory = readU32le(buf, 27);
      const iterations = readU32le(buf, 31);
      const parallelism = buf[35];
      const iv = buf.slice(36, 48);
      const ctLen = readU32le(buf, 48);
      const ciphertext = buf.slice(52, 52 + ctLen);
      return {
        encrypted: true,
        salt,
        kdf: { type: 'argon2id', memory, iterations, parallelism },
        iv,
        ciphertext,
      };
    }
    if (kdfType === KDF_PBKDF2) {
      const salt = buf.slice(11, 27);
      const iterations = readU32le(buf, 27);
      const iv = buf.slice(36, 48);
      const ctLen = readU32le(buf, 48);
      const ciphertext = buf.slice(52, 52 + ctLen);
      return {
        encrypted: true,
        salt,
        kdf: { type: 'pbkdf2', iterations },
        iv,
        ciphertext,
      };
    }
    throw new Error('Невідомий KDF у бэкапі');
  }

  async function decryptBackupPayload(header, password) {
    if (!password) throw new Error('Потрібен пароль бэкапу');
    try {
      const key = await deriveKey(password, header.salt, header.kdf);
      const pt = await decryptBytes(key, header.iv, header.ciphertext);
      return pt;
    } catch {
      throw new Error('Невірний пароль або пошкоджений бэкап');
    }
  }

  window.WorkspaceCrypto = {
    PBKDF2_ITERATIONS,
    DEFAULT_ARGON2,
    FAST_ARGON2,
    KDF_NONE,
    KDF_ARGON2ID,
    KDF_PBKDF2,
    deriveKey,
    deriveKeyPbkdf2,
    deriveKeyArgon2id,
    suggestArgon2Profile,
    randomSalt,
    b64,
    fromB64,
    isEncryptedContent,
    wrapContent,
    unwrapContent,
    createVerifier,
    checkVerifier,
    sha256Hex,
    packEncryptedBackup,
    packPlainBackup,
    parseBackupHeader,
    decryptBackupPayload,
  };
})();

/**
 * Web Worker: Argon2id off main thread (argon2-browser via importScripts)
 */
/* global argon2 */
importScripts('https://cdn.jsdelivr.net/npm/argon2-browser@1.18.0/dist/argon2-bundled.min.js');

self.onmessage = async (event) => {
  const { id, password, salt, params } = event.data;
  try {
    const result = await argon2.hash({
      pass: password,
      salt: new Uint8Array(salt),
      time: params.iterations,
      mem: params.memory,
      parallelism: params.parallelism,
      hashLen: 32,
      type: argon2.ArgonType.Argon2id,
      raw: true,
    });
    self.postMessage({ id, ok: true, hash: Array.from(result.hash) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};

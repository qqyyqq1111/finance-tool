/* ============================================================
 * crypto.js — 本地数据加密（批次⑤，07-PRD §2.1）
 * 方案：Web Crypto API，PBKDF2(SHA-256, 15万次) 口令派生 → AES-GCM-256
 *  - 加密对象：transactions / settlements（密文落 LocalStorage）
 *  - 不加密：settings / categories / accounts（元数据）
 *  - 密钥只存内存，刷新/锁定后需口令解锁；忘记口令 = 数据不可恢复
 * ============================================================ */
(function (global) {
  'use strict';

  var C = {};
  var ITERATIONS = 150000;
  var keyMaterial = null; // 解锁后的 CryptoKey（仅内存）

  /* ---------------- 环境兼容（浏览器 / Node 单测） ---------------- */

  function getSubtle() {
    if (globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) return window.crypto.subtle;
    if (typeof require === 'function') {
      try { return require('crypto').webcrypto.subtle; } catch (e) { /* node 无 webcrypto */ }
    }
    return null;
  }

  function randomBytes(n) {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof window !== 'undefined' && window.crypto);
    if (c && c.getRandomValues) {
      var a = new Uint8Array(n);
      c.getRandomValues(a);
      return a;
    }
    return new Uint8Array(require('crypto').randomBytes(n));
  }

  function u8ToB64(bytes) {
    if (typeof btoa === 'function') {
      var s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }
    return Buffer.from(bytes).toString('base64');
  }

  function b64ToU8(b64) {
    if (typeof atob === 'function') {
      var s = atob(b64);
      var u = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  /* ---------------- 密钥派生 / 加解密原语 ---------------- */

  function deriveKey(pin, saltU8) {
    var subtle = getSubtle();
    var enc = new TextEncoder();
    return subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: saltU8, iterations: ITERATIONS, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function encryptJson(obj, key) {
    var subtle = getSubtle();
    var iv = randomBytes(12);
    var data = new TextEncoder().encode(JSON.stringify(obj));
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data).then(function (ct) {
      return { __enc: 1, iv: u8ToB64(iv), data: u8ToB64(new Uint8Array(ct)) };
    });
  }

  function decryptJson(blob, key) {
    var subtle = getSubtle();
    return subtle.decrypt({ name: 'AES-GCM', iv: b64ToU8(blob.iv) }, key, b64ToU8(blob.data))
      .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }

  /* ---------------- 状态 ---------------- */

  C.available = function () { return !!getSubtle(); };
  C.randomSalt = function () { return u8ToB64(randomBytes(16)); }; // v1.0.1 身份锁

  C.isEnabled = function () {
    var s = fcDb._cryptoBridge.rawRead('settings');
    return !!(s && s.encryptionEnabled === true);
  };

  C.isUnlocked = function () { return !!keyMaterial; };

  /* ---------------- 开启加密 ---------------- */

  C.enable = function (pin) {
    if (!/^\d{6}$/.test(pin)) return Promise.resolve({ ok: false, errors: ['口令需为 6 位数字'] });
    if (C.isEnabled()) return Promise.resolve({ ok: false, errors: ['加密已开启'] });
    var bridge = fcDb._cryptoBridge;
    var salt = randomBytes(16);
    return deriveKey(pin, salt).then(function (key) {
      var txs = bridge.rawRead('transactions') || [];
      var sts = bridge.rawRead('settlements') || [];
      return Promise.all([encryptJson(txs, key), encryptJson(sts, key)]).then(function (blobs) {
        bridge.rawWrite('cryptoMeta', { v: 1, salt: u8ToB64(salt), iterations: ITERATIONS, algo: 'PBKDF2-SHA256 / AES-GCM-256', createdAt: Date.now() });
        bridge.rawWrite('transactions', blobs[0]);
        bridge.rawWrite('settlements', blobs[1]);
        keyMaterial = key;
        bridge.setSession({ transactions: txs, settlements: sts });
        var s = bridge.rawRead('settings');
        s.encryptionEnabled = true;
        bridge.rawWrite('settings', s);
        return { ok: true };
      });
    }).catch(function (e) {
      console.error('[crypto] 开启失败', e);
      return { ok: false, errors: ['加密开启失败：当前环境可能不支持 Web Crypto'] };
    });
  };

  /* ---------------- 解锁（刷新/锁定后） ---------------- */

  C.unlock = function (pin) {
    var bridge = fcDb._cryptoBridge;
    var meta = bridge.rawRead('cryptoMeta');
    if (!meta) return Promise.resolve({ ok: false, errors: ['未开启加密'] });
    return deriveKey(pin, b64ToU8(meta.salt)).then(function (key) {
      var txBlob = bridge.rawRead('transactions');
      var stBlob = bridge.rawRead('settlements');
      var txP = (txBlob && txBlob.__enc) ? decryptJson(txBlob, key) : Promise.resolve(txBlob || []);
      var stP = (stBlob && stBlob.__enc) ? decryptJson(stBlob, key) : Promise.resolve(stBlob || []);
      return Promise.all([txP, stP]).then(function (data) {
        keyMaterial = key;
        bridge.setSession({ transactions: data[0], settlements: data[1] });
        return { ok: true };
      });
    }).catch(function (e) {
      console.warn('[crypto] 解锁失败', e);
      return { ok: false, errors: ['口令错误，或数据已损坏'] };
    });
  };

  /* ---------------- 锁定（清内存密钥） ---------------- */

  C.lock = function () {
    keyMaterial = null;
    fcDb._cryptoBridge.clearSession();
    return { ok: true };
  };

  /* ---------------- PIN 校验哈希（v1.0.1 身份切换锁用） ----------------
   * PBKDF2 派生 256bit → SHA-256 摘要 hex；只存摘要不存口令/密钥 */

  C.deriveHash = function (pin, saltB64, iterations) {
    var subtle = getSubtle();
    var enc = new TextEncoder();
    return subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) {
        return subtle.deriveBits(
          { name: 'PBKDF2', salt: b64ToU8(saltB64), iterations: iterations || ITERATIONS, hash: 'SHA-256' },
          base, 256
        );
      })
      .then(function (bits) {
        return subtle.digest('SHA-256', bits);
      })
      .then(function (d) {
        var u = new Uint8Array(d), s = '';
        for (var i = 0; i < u.length; i++) s += ('0' + u[i].toString(16)).slice(-2);
        return s;
      });
  };

  /* ---------------- 关闭加密（口令验证后明文落盘） ---------------- */

  C.disable = function (pin) {
    return C.unlock(pin).then(function (r) {
      if (!r.ok) return r;
      var bridge = fcDb._cryptoBridge;
      var cache = bridge.getSession();
      bridge.rawWrite('transactions', cache.transactions);
      bridge.rawWrite('settlements', cache.settlements);
      bridge.rawRemove('cryptoMeta');
      var s = bridge.rawRead('settings');
      s.encryptionEnabled = false;
      bridge.rawWrite('settings', s);
      keyMaterial = null;
      bridge.clearSession();
      return { ok: true };
    });
  };

  /* ---------------- 加密落盘（内存会话 → 密文 LocalStorage） ---------------- */

  var persistTimer = null;
  C.persistSoon = function () {
    if (!keyMaterial || persistTimer) return;
    persistTimer = setTimeout(function () { persistTimer = null; C.persist(); }, 150);
  };

  C.persist = function () {
    if (!keyMaterial) return Promise.resolve({ ok: false, errors: ['未解锁'] });
    var bridge = fcDb._cryptoBridge;
    var cache = bridge.getSession();
    if (!cache) return Promise.resolve({ ok: false, errors: ['无会话'] });
    return Promise.all([
      encryptJson(cache.transactions, keyMaterial),
      encryptJson(cache.settlements, keyMaterial)
    ]).then(function (blobs) {
      bridge.rawWrite('transactions', blobs[0]);
      bridge.rawWrite('settlements', blobs[1]);
      return { ok: true };
    }).catch(function (e) {
      console.error('[crypto] 落盘失败', e);
      return { ok: false, errors: ['加密落盘失败'] };
    });
  };

  global.fcCrypto = C;
})(typeof window !== 'undefined' ? window : globalThis);

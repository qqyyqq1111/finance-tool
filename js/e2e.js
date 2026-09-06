/* ============================================================
 * e2e.js — 端到端加密密钥体系 + 双人配对（v1.1 批次⑦，09-PRD §3）
 *
 * 职责：
 *  - 双层密钥：familyKey（公开账/结算/规则，双方共享）、personalKey（私密/小金库，仅本人）
 *  - 邀请配对：24 字符链接 secret（~142bit 熵）+ 8 位短码兜底；familyKey 用码派生密钥
 *    AES-GCM 包装后存云端 invites 表，服务器永远拿不到明文密钥
 *  - 密钥备份：familyKey+personalKey 用登录口令 PBKDF2 包装后存 personal_docs，
 *    换设备登录后输口令即可恢复（RLS 仅本人可读）
 *
 * 红线：本模块所有密钥/明文只在本机；云端只有密文。不碰 DOM 渲染（UI 在 settings.js）。
 * 单机兼容：未登录/未配对时本模块完全不介入，v1.0 功能不受影响（09-PRD §10）。
 * ============================================================ */
(function (global) {
  'use strict';

  var E = {};
  var LS_KEY = 'fc_family';
  var PBKDF2_ITERS = 150000;          // 与本地加密 crypto.js 同强度
  var INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 邀请 24h 过期
  var SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var SHORT_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混 I/L/O/0/1

  /* ---------------- 基础原语（浏览器 / Node 单测双兼容） ---------------- */

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

  E.available = function () { return !!getSubtle(); };

  /* ---------------- 纯函数（不碰 localStorage / 网络，可单测） ---------------- */

  /** 生成 32 字节随机密钥，base64 返回（AES-GCM-256） */
  E.genKeyB64 = function () { return u8ToB64(randomBytes(32)); };

  /** 邀请码：24 字符链接 secret + 8 位短码 */
  E.genInviteCodes = function () {
    return { secret: randString(SECRET_ALPHABET, 24), short: randString(SHORT_ALPHABET, 8) };
  };

  function randString(alphabet, len) {
    var bytes = randomBytes(len), out = '';
    for (var i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  /** SHA-256 十六进制（invites.code_hash 用，服务端 digest 同算法） */
  E.sha256Hex = function (text) {
    var subtle = getSubtle();
    return subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (digest) {
      var bytes = new Uint8Array(digest), hex = '';
      for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
      return hex;
    });
  };

  /** 从 base64 原始密钥导入 AES-GCM CryptoKey */
  function importAesKey(keyB64) {
    return getSubtle().importKey('raw', b64ToU8(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /** 口令/邀请码 → PBKDF2 派生 AES-GCM 密钥 */
  function deriveAesKey(secret, saltU8, iters) {
    var subtle = getSubtle();
    return subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: saltU8, iterations: iters || PBKDF2_ITERS, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
      });
  }

  /** 用 secret 包装一把 base64 密钥 → 自描述密文 JSON 字符串（salt/iv 非密，随密文存） */
  E.wrapKey = function (keyB64, secret) {
    var salt = randomBytes(16), iv = randomBytes(12);
    return deriveAesKey(secret, salt).then(function (derived) {
      return getSubtle().encrypt({ name: 'AES-GCM', iv: iv }, derived, new TextEncoder().encode(keyB64));
    }).then(function (ct) {
      return JSON.stringify({ v: 1, salt: u8ToB64(salt), iv: u8ToB64(iv), data: u8ToB64(new Uint8Array(ct)) });
    });
  };

  /** 解包；密码/码错误时 AES-GCM 认证失败抛异常（调用方转用户可读错误） */
  E.unwrapKey = function (blobJson, secret) {
    var blob = typeof blobJson === 'string' ? JSON.parse(blobJson) : blobJson;
    return deriveAesKey(secret, b64ToU8(blob.salt)).then(function (derived) {
      return getSubtle().decrypt({ name: 'AES-GCM', iv: b64ToU8(blob.iv) }, derived, b64ToU8(blob.data));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  };

  /**
   * familyKey 双路包装（09-PRD §3.3）：
   *   s = 链接 secret 包装（主路径，高熵）；c = 短码包装（人工输入兜底）
   * 两路解同一把 familyKey，服务端只存密文。
   */
  E.wrapFamilyForInvite = function (familyKeyB64, codes) {
    return Promise.all([
      E.wrapKey(familyKeyB64, codes.secret),
      E.wrapKey(familyKeyB64, codes.short)
    ]).then(function (blobs) { return JSON.stringify({ s: blobs[0], c: blobs[1] }); });
  };

  /** 用拿到的码（链接 secret 或短码）解 familyKey；先试链接路再试短码路 */
  E.unwrapFamilyFromInvite = function (encJson, code) {
    var enc = typeof encJson === 'string' ? JSON.parse(encJson) : encJson;
    return E.unwrapKey(enc.s, code).catch(function () { return E.unwrapKey(enc.c, code); });
  };

  /** 任意明文 → familyKey 加密文本（家庭名/昵称 name_enc 用） */
  E.encryptText = function (text, keyB64) {
    var iv = randomBytes(12);
    return importAesKey(keyB64).then(function (key) {
      return getSubtle().encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(String(text)));
    }).then(function (ct) {
      return JSON.stringify({ v: 1, iv: u8ToB64(iv), data: u8ToB64(new Uint8Array(ct)) });
    });
  };
  E.decryptText = function (blobJson, keyB64) {
    var blob = typeof blobJson === 'string' ? JSON.parse(blobJson) : blobJson;
    return importAesKey(keyB64).then(function (key) {
      return getSubtle().decrypt({ name: 'AES-GCM', iv: b64ToU8(blob.iv) }, key, b64ToU8(blob.data));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  };

  /** 登录口令包装双密钥备份（personal_docs._key_backup） */
  E.backupPayload = function (st, password) {
    var inner = JSON.stringify({ f: st.familyKey, p: st.personalKey, fid: st.familyId, mid: st.memberId });
    var salt = randomBytes(16), iv = randomBytes(12);
    return deriveAesKey(password, salt).then(function (derived) {
      return getSubtle().encrypt({ name: 'AES-GCM', iv: iv }, derived, new TextEncoder().encode(inner));
    }).then(function (ct) {
      return JSON.stringify({ v: 1, salt: u8ToB64(salt), iv: u8ToB64(iv), data: u8ToB64(new Uint8Array(ct)) });
    });
  };

  /** 从备份密文恢复；口令错误抛异常 */
  E.restorePayload = function (encPayload, password) {
    var blob = typeof encPayload === 'string' ? JSON.parse(encPayload) : encPayload;
    return deriveAesKey(password, b64ToU8(blob.salt)).then(function (derived) {
      return getSubtle().decrypt({ name: 'AES-GCM', iv: b64ToU8(blob.iv) }, derived, b64ToU8(blob.data));
    }).then(function (pt) {
      var inner = JSON.parse(new TextDecoder().decode(pt));
      return { familyKey: inner.f, personalKey: inner.p, familyId: inner.fid, memberId: inner.mid };
    });
  };

  /** 从粘贴文本中提取邀请码：支持整链接（#/join?c=xxx）、纯 secret、纯短码 */
  E.extractJoinCode = function (text) {
    var m = String(text || '').match(/[#?]c=([A-Za-z0-9]{8,24})/);
    var code = m ? m[1] : String(text || '').trim().split(/[\s&]/)[0];
    return code;
  };

  /* ---------------- 本地配对状态（fc_family） ---------------- */

  E.state = function () {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  function saveState(st) { localStorage.setItem(LS_KEY, JSON.stringify(st)); return st; }
  E.clearState = function () { localStorage.removeItem(LS_KEY); };

  /* ---------------- 云端编排（需登录；cloud.js 提供 _client） ---------------- */

  function sb() {
    if (!global.cloud || !global.cloud.available() || !cloud._client()) return null;
    return cloud._client();
  }
  function currentUser(client) {
    return client.auth.getUser().then(function (r) {
      return (r && r.data && r.data.user) || null;
    });
  }
  function fail(msg) { return { ok: false, errors: [msg] }; }

  /** 查云端成员身份：{familyId, memberId, paired} 或 null（未加入任何家庭） */
  E.fetchMembership = function () {
    var client = sb();
    if (!client) return Promise.resolve(null);
    return currentUser(client).then(function (user) {
      if (!user) return null;
      return client.from('family_members').select('family_id, member_id').eq('user_id', user.id)
        .then(function (r) {
          if (r.error || !r.data || !r.data.length) return null;
          var row = r.data[0];
          return client.from('family_members').select('member_id', { count: 'exact', head: true })
            .eq('family_id', row.family_id)
            .then(function (c) {
              return { familyId: row.family_id, memberId: row.member_id, paired: (c.count || r.data.length) >= 2 };
            });
        });
    });
  };

  /** 创建家庭（邀请方，memberId=m1） */
  E.createFamily = function (opts) {
    var client = sb();
    if (!client) return Promise.resolve(fail('云服务未就绪，请先登录'));
    var password = String(opts.password || '');
    if (password.length < 6) return Promise.resolve(fail('请输入登录密码（至少 6 位，用于加密云端密钥备份）'));
    var familyName = String(opts.familyName || '我们的家').slice(0, 20);
    return currentUser(client).then(function (user) {
      if (!user) return fail('请先登录');
      var familyKey = E.genKeyB64();
      var personalKey = E.genKeyB64();
      // 1. 建家庭行
      return client.from('families').insert({ created_by: user.id, name_enc: null }).select().single()
        .then(function (r) {
          if (r.error) return fail('创建家庭失败：' + r.error.message);
          var familyId = r.data.id;
          var st = saveState({ familyId: familyId, memberId: 'm1', familyKey: familyKey, personalKey: personalKey, createdAt: Date.now() });
          // 2. 家庭名/昵称加密回填 + 成员行
          return Promise.all([
            E.encryptText(familyName, familyKey),
            E.encryptText(String(opts.myName || '').slice(0, 12) || '我', familyKey)
          ]).then(function (encs) {
            return Promise.all([
              client.from('families').update({ name_enc: encs[0] }).eq('id', familyId),
              client.from('family_members').insert({ family_id: familyId, user_id: user.id, member_id: 'm1', display_name_enc: encs[1] })
            ]).then(function () {
              // 3. 密钥备份（换设备恢复用）
              return E.backupKeys(password).then(function (br) {
                if (!br.ok) return br;
                return { ok: true, familyId: familyId, memberId: 'm1' };
              });
            });
          });
        });
    });
  };

  /** 生成邀请（链接 + 短码，24h 一次性） */
  E.createInvite = function () {
    var client = sb();
    var st = E.state();
    if (!client) return Promise.resolve(fail('云服务未就绪，请先登录'));
    if (!st) return Promise.resolve(fail('请先创建或加入家庭'));
    return currentUser(client).then(function (user) {
      if (!user) return fail('请先登录');
      var codes = E.genInviteCodes();
      return Promise.all([
        E.wrapFamilyForInvite(st.familyKey, codes),
        E.sha256Hex(codes.secret)
      ]).then(function (arr) {
        var enc = arr[0], codeHash = arr[1];
        return client.from('invites').insert({
          family_id: st.familyId,
          enc_family_key: enc,
          code_hash: codeHash,
          short_code: codes.short,
          expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
          used: false,
          attempts: 0,
          created_by: user.id
        }).select('id').single().then(function (r) {
          if (r.error) return fail('邀请生成失败：' + r.error.message);
          var link = location.origin + location.pathname + '#/join?c=' + codes.secret;
          return { ok: true, link: link, short: codes.short, secret: codes.secret, expiresAt: Date.now() + INVITE_TTL_MS };
        });
      });
    });
  };

  /** 兑换邀请（被邀请方，memberId=m2） */
  E.redeemInvite = function (rawInput, password) {
    var client = sb();
    if (!client) return Promise.resolve(fail('云服务未就绪，请先登录'));
    var code = E.extractJoinCode(rawInput);
    if (!/^[A-Za-z0-9]{8,24}$/.test(code)) return Promise.resolve(fail('邀请码格式不正确（应为 8 位短码或邀请链接）'));
    if (String(password || '').length < 6) return Promise.resolve(fail('请输入登录密码（至少 6 位，用于加密你的密钥备份）'));
    return currentUser(client).then(function (user) {
      if (!user) return fail('请先登录');
      return client.rpc('redeem_invite', { p_code: code }).then(function (r) {
        if (r.error) return fail('兑换失败：' + r.error.message);
        var res = r.data;
        if (!res || res.ok !== true) return fail((res && res.error) || '邀请码无效或已过期');
        return E.unwrapFamilyFromInvite(res.enc_family_key, code).then(function (familyKey) {
          var st = saveState({ familyId: res.family_id, memberId: 'm2', familyKey: familyKey, personalKey: E.genKeyB64(), createdAt: Date.now() });
          // 回填昵称密文（RPC 建的成员行无昵称）
          var myName = '';
          try {
            var s = JSON.parse(localStorage.getItem('fc_settings') || '{}');
            var me = (s.members || []).filter(function (m) { return m.id === 'm2'; })[0];
            myName = me ? me.name : '';
          } catch (e) { /* 无本地设置时用默认 */ }
          var nameP = myName ? E.encryptText(myName, familyKey) : Promise.resolve(null);
          return nameP.then(function (nameEnc) {
            var upd = nameEnc
              ? client.from('family_members').update({ display_name_enc: nameEnc }).eq('family_id', res.family_id).eq('user_id', user.id)
              : Promise.resolve(null);
            return upd.then(function () {
              return E.backupKeys(password).then(function (br) {
                if (!br.ok) return br;
                return { ok: true, familyId: st.familyId, memberId: 'm2' };
              });
            });
          });
        }).catch(function () { return fail('邀请信息解密失败：链接可能已损坏或不完整'); });
      });
    });
  };

  /** 上传密钥备份到 personal_docs（RLS 仅本人） */
  E.backupKeys = function (password) {
    var client = sb();
    var st = E.state();
    if (!client || !st) return Promise.resolve(fail('本地无配对状态'));
    return currentUser(client).then(function (user) {
      if (!user) return fail('请先登录');
      return E.backupPayload(st, password).then(function (payload) {
        return client.from('personal_docs').upsert({
          user_id: user.id,
          entity_type: '_key_backup',
          entity_id: 'main',
          enc_payload: payload,
          updated_at: Date.now(),
          device_id: (global.fcDb && fcDb.getDeviceId) ? fcDb.getDeviceId() : 'unknown',
          deleted: false
        }, { onConflict: 'user_id,entity_type,entity_id' }).then(function (r) {
          if (r.error) return fail('密钥备份失败：' + r.error.message);
          return { ok: true };
        });
      });
    });
  };

  /** 换设备：从 personal_docs 拉备份并用登录口令恢复 */
  E.restoreKeys = function (password) {
    var client = sb();
    if (!client) return Promise.resolve(fail('云服务未就绪，请先登录'));
    return currentUser(client).then(function (user) {
      if (!user) return fail('请先登录');
      return client.from('personal_docs')
        .select('enc_payload')
        .eq('entity_type', '_key_backup').eq('entity_id', 'main')
        .maybeSingle().then(function (r) {
          if (r.error) return fail('读取密钥备份失败：' + r.error.message);
          if (!r.data) return fail('云端没有密钥备份：请在原设备上完成过配对，或让伴侣发你新邀请');
          return E.restorePayload(r.data.enc_payload, password).then(function (st) {
            saveState({ familyId: st.familyId, memberId: st.memberId, familyKey: st.familyKey, personalKey: st.personalKey, restoredAt: Date.now() });
            return { ok: true, familyId: st.familyId, memberId: st.memberId };
          }).catch(function () { return fail('密码错误，或备份数据已损坏'); });
        });
    });
  };

  global.fcE2E = E;
})(typeof window !== 'undefined' ? window : this);

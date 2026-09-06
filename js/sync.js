/**
 * sync.js — 同步引擎（v1.1 批次⑧，09-PRD §6）
 *
 * 职责：
 *  - push：扫描本地 _sync='dirty' 记录 → 加密 → upsert family_docs/personal_docs
 *  - pull：拉取 since lastPullAt → 解密 → LWW 合并
 *  - 墓碑：deleted=true 同步后双方物理清理
 *  - 三层隐私路由：public→familyKey/family_docs; private→personalKey/family_docs; vault→personalKey/personal_docs
 *  - 调度：debounce 3s、启动后、登录后、网络恢复
 *
 * 纯函数（mergeRecord/classifyForSync）不碰 DOM/localStorage，可 Node 单测。
 * 红线：未登录/未配对时本模块不介入，v1.0 功能不受影响。
 * ============================================================ */
(function (global) {
  'use strict';

  var S = {};
  var LS_LAST_PULL = 'fc_sync_last_pull';
  var DEBOUNCE_MS = 3000;

  /* ================ 纯函数（可单测） ================ */

  /**
   * LWW 合并：决定本地记录是否被远端覆盖
   * @param {Object|null} local - 本地记录（可能不存在=null）
   * @param {Object} remote - 远端记录
   * @returns {{action:'skip'|'write'|'delete', record:Object|null}}
   *   skip=本地更新或相同，不动；write=写入远端版；delete=物理删除本地
   */
  S.mergeRecord = function (local, remote) {
    if (!remote) return { action: 'skip', record: local };
    // 本地无此记录
    if (!local) {
      if (remote.deleted) return { action: 'skip', record: null }; // 远端已删，本地也无，无需操作
      return { action: 'write', record: remote };
    }
    // 都有 → 比 updatedAt
    var localT = local.updatedAt || 0;
    var remoteT = remote.updatedAt || 0;
    if (remoteT > localT) {
      // 远端更新
      if (remote.deleted) return { action: 'delete', record: null };
      return { action: 'write', record: remote };
    }
    if (remoteT < localT) {
      // 本地更新，跳过
      return { action: 'skip', record: local };
    }
    // updatedAt 相等 → deviceId 字典序 tiebreak（大者胜=确定性）
    var localD = local.deviceId || '';
    var remoteD = remote.deviceId || '';
    if (remoteD > localD) {
      if (remote.deleted) return { action: 'delete', record: null };
      return { action: 'write', record: remote };
    }
    // 本地 deviceId >= 远端，跳过
    return { action: 'skip', record: local };
  };

  /**
   * 分类记录的同步路由
   * @param {Object} rec - 业务记录（tx/settlement/category/settings）
   * @param {String} entityType - 'tx'|'settlement'|'category'|'settings'
   * @returns {{table:'family_docs'|'personal_docs', encKey:'family'|'personal'}}
   */
  S.classifyForSync = function (rec, entityType) {
    // 交易按隐私层级路由
    if (entityType === 'tx') {
      var privacy = rec.privacy || 'public';
      if (privacy === 'vault') {
        return { table: 'personal_docs', encKey: 'personal' };
      }
      if (privacy === 'private') {
        return { table: 'family_docs', encKey: 'personal' };
      }
      return { table: 'family_docs', encKey: 'family' };
    }
    // 结算/分类/设置 → 家庭共享
    return { table: 'family_docs', encKey: 'family' };
  };

  /**
   * 扫描本地 dirty 记录，返回待推送列表
   * @param {Object} db - fcDb 实例（需 _cryptoBridge.rawRead）
   * @returns {Array} [{entityType, entity, rec, route}]
   */
  S.scanDirty = function (db) {
    var result = [];
    var sources = [
      { type: 'tx', key: 'transactions' },
      { type: 'settlement', key: 'settlements' },
      { type: 'category', key: 'categories' }
    ];
    sources.forEach(function (src) {
      var list = db._cryptoBridge.rawRead(src.key) || [];
      list.forEach(function (rec) {
        if (rec && rec._sync === 'dirty') {
          result.push({
            entityType: src.type,
            entity: src.key,
            rec: rec,
            route: S.classifyForSync(rec, src.type)
          });
        }
      });
    });
    // settings 特殊：整体一条记录
    var settings = db._cryptoBridge.rawRead('settings');
    if (settings && settings._sync === 'dirty') {
      result.push({
        entityType: 'settings',
        entity: 'settings',
        rec: settings,
        route: S.classifyForSync(settings, 'settings')
      });
    }
    return result;
  };

  /* ================ 加密/解密桥接 ================ */

  function getE2E() { return global.fcE2E || null; }
  function getCloud() { return global.cloud || null; }
  function getDb() { return global.fcDb || null; }

  function getSt() {
    var e = getE2E();
    return e ? e.state() : null;
  }

  function getKeys() {
    var st = getSt();
    if (!st) return null;
    return { familyKey: st.familyKey, personalKey: st.personalKey, familyId: st.familyId, memberId: st.memberId };
  }

  function sb() {
    var c = getCloud();
    if (!c || !c.available() || !c._client()) return null;
    return c._client();
  }

  function currentUser(client) {
    return client.auth.getUser().then(function (r) {
      return (r && r.data && r.data.user) || null;
    });
  }

  /* ================ Push ================ */

  /**
   * 推送所有 dirty 记录到云端
   * @returns {Promise<{ok:Boolean, pushed:Number, errors:Array}>}
   */
  S.pushDirty = function () {
    var client = sb();
    if (!client) return Promise.resolve({ ok: false, errors: ['云服务不可用'] });
    var keys = getKeys();
    if (!keys) return Promise.resolve({ ok: false, errors: ['未配对，无法同步'] });
    var db = getDb();
    if (!db) return Promise.resolve({ ok: false, errors: ['数据层未就绪'] });

    var dirty = S.scanDirty(db);
    if (!dirty.length) return Promise.resolve({ ok: true, pushed: 0, errors: [] });

    return currentUser(client).then(function (user) {
      if (!user) return { ok: false, errors: ['未登录'], pushed: 0 };
      var uid = user.id;
      var deviceId = db.getDeviceId();

      // 逐条加密 + upsert
      var ops = dirty.map(function (item) {
        var rec = item.rec;
        var route = item.route;
        var keyB64 = route.encKey === 'family' ? keys.familyKey : keys.personalKey;
        var payload = JSON.stringify(rec);

        return getE2E().encryptText(payload, keyB64).then(function (encPayload) {
          if (route.table === 'family_docs') {
            return client.from('family_docs').upsert({
              family_id: keys.familyId,
              entity_type: item.entityType,
              entity_id: rec.id,
              enc_payload: encPayload,
              enc_key: route.encKey,
              owner_uid: uid,
              updated_at: rec.updatedAt || Date.now(),
              device_id: deviceId,
              deleted: rec.deleted || false
            }, { onConflict: 'family_id,entity_type,entity_id' }).then(function (r) {
              return { ok: !r.error, error: r.error ? r.error.message : null, id: rec.id };
            });
          } else {
            // personal_docs
            return client.from('personal_docs').upsert({
              user_id: uid,
              entity_type: item.entityType,
              entity_id: rec.id,
              enc_payload: encPayload,
              updated_at: rec.updatedAt || Date.now(),
              device_id: deviceId,
              deleted: rec.deleted || false
            }, { onConflict: 'user_id,entity_type,entity_id' }).then(function (r) {
              return { ok: !r.error, error: r.error ? r.error.message : null, id: rec.id };
            });
          }
        }).catch(function (e) {
          return { ok: false, error: e.message || '加密失败', id: rec.id };
        });
      });

      return Promise.all(ops).then(function (results) {
        // 成功的标记 clean，失败的保留 dirty
        var succeeded = results.filter(function (r) { return r.ok; });
        var failed = results.filter(function (r) { return !r.ok; });
        markSyncStatus(db, succeeded.map(function (r) { return r.id; }), 'clean');
        var errors = failed.map(function (r) { return r.error + ' (id:' + r.id + ')'; });
        return { ok: failed.length === 0, pushed: succeeded.length, errors: errors };
      });
    });
  };

  /* ================ Pull ================ */

  /**
   * 拉取云端变更并合并到本地
   * @returns {Promise<{ok:Boolean, pulled:Number, errors:Array}>}
   */
  S.pullSince = function () {
    var client = sb();
    if (!client) return Promise.resolve({ ok: false, errors: ['云服务不可用'] });
    var keys = getKeys();
    if (!keys) return Promise.resolve({ ok: false, errors: ['未配对，无法同步'] });
    var db = getDb();
    if (!db) return Promise.resolve({ ok: false, errors: ['数据层未就绪'] });

    var lastPull = parseInt(localStorage.getItem(LS_LAST_PULL) || '0', 10) || 0;

    return currentUser(client).then(function (user) {
      if (!user) return { ok: false, errors: ['未登录'], pulled: 0 };
      var uid = user.id;

      // 并行拉取 family_docs + personal_docs
      var famQuery = client.from('family_docs')
        .select('entity_type,entity_id,enc_payload,enc_key,owner_uid,updated_at,device_id,deleted')
        .eq('family_id', keys.familyId)
        .gt('updated_at', lastPull)
        .order('updated_at', { ascending: true });

      var perQuery = client.from('personal_docs')
        .select('entity_type,entity_id,enc_payload,updated_at,device_id,deleted')
        .eq('user_id', uid)
        .gt('updated_at', lastPull)
        .order('updated_at', { ascending: true });

      return Promise.all([famQuery, perQuery]).then(function (rs) {
        var famRows = (rs[0].data) || [];
        var perRows = (rs[1].data) || [];
        var maxTs = lastPull;
        var merged = 0;
        var placeholderCount = 0;

        // 处理 family_docs
        var famOps = famRows.map(function (row) {
          if (row.updated_at > maxTs) maxTs = row.updated_at;
          var keyB64;
          if (row.enc_key === 'family') {
            keyB64 = keys.familyKey;
          } else {
            // personal 密钥
            if (row.owner_uid === uid) {
              keyB64 = keys.personalKey; // 自己的私密账
            } else {
              // 对方的私密账 → 不解密，计为占位
              placeholderCount++;
              return Promise.resolve({ merged: false, placeholder: true });
            }
          }
          return getE2E().decryptText(row.enc_payload, keyB64).then(function (json) {
            var remote = JSON.parse(json);
            remote._sync = 'clean';
            var local = findLocalRecord(db, row.entity_type, row.entity_id);
            var m = S.mergeRecord(local, remote);
            if (m.action === 'write') {
              upsertLocalRecord(db, row.entity_type, m.record);
              merged++;
            } else if (m.action === 'delete') {
              deleteLocalRecord(db, row.entity_type, row.entity_id);
              merged++;
            }
            return { merged: true, placeholder: false };
          }).catch(function (e) {
            // 解密失败=对方私密账，计为占位
            placeholderCount++;
            return { merged: false, placeholder: true };
          });
        });

        // 处理 personal_docs（仅本人，全部可解密）
        var perOps = perRows.map(function (row) {
          if (row.updated_at > maxTs) maxTs = row.updated_at;
          return getE2E().decryptText(row.enc_payload, keys.personalKey).then(function (json) {
            var remote = JSON.parse(json);
            remote._sync = 'clean';
            var local = findLocalRecord(db, row.entity_type, row.entity_id);
            var m = S.mergeRecord(local, remote);
            if (m.action === 'write') {
              upsertLocalRecord(db, row.entity_type, m.record);
              merged++;
            } else if (m.action === 'delete') {
              deleteLocalRecord(db, row.entity_type, row.entity_id);
              merged++;
            }
            return { merged: true };
          }).catch(function () { return { merged: false }; });
        });

        return Promise.all(famOps.concat(perOps)).then(function () {
          // 更新 lastPullAt
          localStorage.setItem(LS_LAST_PULL, String(maxTs));
          // 触发 UI 刷新
          if (global.settingsUI && global.settingsUI.renderCloud) global.settingsUI.renderCloud();
          if (global.ledgerUI && global.ledgerUI.render) global.ledgerUI.render();
          if (global.dashboardUI && global.dashboardUI.render) global.dashboardUI.render();
          return { ok: true, pulled: merged, errors: [], placeholders: placeholderCount };
        });
      });
    });
  };

  /* ================ 本地记录查找/写入/删除 ================ */

  var ENTITY_TO_KEY = {
    'tx': 'transactions',
    'settlement': 'settlements',
    'category': 'categories',
    'settings': 'settings'
  };

  function findLocalRecord(db, entityType, entityId) {
    if (entityType === 'settings') {
      var s = db._cryptoBridge.rawRead('settings');
      return s; // settings 整体一条
    }
    var key = ENTITY_TO_KEY[entityType];
    if (!key) return null;
    var list = db._cryptoBridge.rawRead(key) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === entityId) return list[i];
    }
    return null;
  }

  function upsertLocalRecord(db, entityType, record) {
    if (entityType === 'settings') {
      var s = db._cryptoBridge.rawRead('settings') || {};
      // 合并 settings 字段（远端覆盖同名）
      for (var k in record) { s[k] = record[k]; }
      s._sync = 'clean';
      db._cryptoBridge.rawWrite('settings', s);
      return;
    }
    var key = ENTITY_TO_KEY[entityType];
    if (!key) return;
    var list = db._cryptoBridge.rawRead(key) || [];
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === record.id) {
        list[i] = record;
        found = true;
        break;
      }
    }
    if (!found) list.push(record);
    db._cryptoBridge.rawWrite(key, list);
  }

  function deleteLocalRecord(db, entityType, entityId) {
    if (entityType === 'settings') return; // settings 不删
    var key = ENTITY_TO_KEY[entityType];
    if (!key) return;
    var list = db._cryptoBridge.rawRead(key) || [];
    var filtered = list.filter(function (r) { return r.id !== entityId; });
    db._cryptoBridge.rawWrite(key, filtered);
  }

  function markSyncStatus(db, ids, status) {
    if (!ids.length) return;
    ['transactions', 'settlements', 'categories'].forEach(function (key) {
      var list = db._cryptoBridge.rawRead(key) || [];
      var changed = false;
      list.forEach(function (rec) {
        if (ids.indexOf(rec.id) >= 0 && rec._sync !== status) {
          rec._sync = status;
          changed = true;
        }
      });
      if (changed) db._cryptoBridge.rawWrite(key, list);
    });
    // settings
    var s = db._cryptoBridge.rawRead('settings');
    if (s && ids.indexOf(s.id || 'settings') >= 0) {
      s._sync = status;
      db._cryptoBridge.rawWrite('settings', s);
    }
  }

  /* ================ 同步调度 ================ */

  var syncTimer = null;
  var syncing = false;

  /**
   * 完整同步：先 push 后 pull
   * @returns {Promise<{ok:Boolean, pushed:Number, pulled:Number, errors:Array}>}
   */
  S.syncNow = function () {
    if (syncing) return Promise.resolve({ ok: false, errors: ['同步进行中'], pushed: 0, pulled: 0 });
    var st = getSt();
    if (!st) return Promise.resolve({ ok: false, errors: ['未配对'], pushed: 0, pulled: 0 });
    if (!sb()) return Promise.resolve({ ok: false, errors: ['云服务不可用'], pushed: 0, pulled: 0 });

    syncing = true;
    updateSyncBadge('syncing');
    return S.pushDirty().then(function (pr) {
      if (!pr.ok) {
        syncing = false;
        updateSyncBadge('error');
        return { ok: false, pushed: pr.pushed, pulled: 0, errors: pr.errors };
      }
      return S.pullSince().then(function (pl) {
        syncing = false;
        updateSyncBadge(pl.ok ? 'ok' : 'error');
        return {
          ok: pl.ok,
          pushed: pr.pushed,
          pulled: pl.pulled,
          errors: pl.errors || [],
          placeholders: pl.placeholders || 0
        };
      });
    }).catch(function (e) {
      syncing = false;
      updateSyncBadge('error');
      return { ok: false, pushed: 0, pulled: 0, errors: [e.message || '同步失败'] };
    });
  };

  /**
   * debounce 3s 后同步
   */
  S.scheduleSync = function () {
    if (!getSt() || !sb()) return; // 未配对/离线不调度
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      S.syncNow();
    }, DEBOUNCE_MS);
  };

  /**
   * 标记记录为 dirty 并调度同步
   * @param {Array} ids - 记录 ID 列表
   * @param {String} entityType - 'tx'|'settlement'|'category'|'settings'
   */
  S.markDirty = function (ids, entityType) {
    var db = getDb();
    if (!db) return;
    var key = ENTITY_TO_KEY[entityType] || entityType;
    if (entityType === 'settings') {
      var s = db._cryptoBridge.rawRead('settings');
      if (s) { s._sync = 'dirty'; db._cryptoBridge.rawWrite('settings', s); }
    } else {
      var list = db._cryptoBridge.rawRead(key) || [];
      list.forEach(function (rec) {
        if (ids.indexOf(rec.id) >= 0) rec._sync = 'dirty';
      });
      db._cryptoBridge.rawWrite(key, list);
    }
    S.scheduleSync();
  };

  /* ================ UI 状态桥接 ================ */

  function updateSyncBadge(state) {
    var el = document.getElementById('sync-badge');
    if (!el) return;
    var labels = { ok: '✅', syncing: '🔄', error: '⚠️', idle: '' };
    el.textContent = labels[state] || '';
  }

  S.getSyncState = function () {
    if (syncing) return 'syncing';
    var lastPull = parseInt(localStorage.getItem(LS_LAST_PULL) || '0', 10) || 0;
    var db = getDb();
    if (db) {
      var dirty = S.scanDirty(db);
      if (dirty.length) return 'pending';
    }
    return lastPull ? 'ok' : 'idle';
  };

  /* ================ 初始化与绑定 ================ */

  S.bind = function () {
    // 网络恢复 → 自动同步
    window.addEventListener('online', function () {
      S.syncNow();
    });
    // 离线提示
    window.addEventListener('offline', function () {
      updateSyncBadge('error');
    });
  };

  /* ================ 导出 ================ */

  global.fcSync = S;
})(window);

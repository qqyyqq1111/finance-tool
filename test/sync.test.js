/**
 * sync.test.js — 同步引擎纯函数单测（v1.1 批次⑧，09-PRD §6）
 *
 * 覆盖：LWW 合并、墓碑处理、隐私路由分类、dirty 扫描
 * 依赖：Node crypto 提供 webcrypto.subtle（Node 16+）
 * ============================================================ */
'use strict';

// ---- localStorage stub ----
var _store = {};
global.localStorage = {
  getItem: function (k) { return k in _store ? _store[k] : null; },
  setItem: function (k, v) { _store[k] = String(v); },
  removeItem: function (k) { delete _store[k]; },
  key: function (i) { return Object.keys(_store)[i] || null; },
  get length() { return Object.keys(_store).length; }
};
global.window = global;

// 加载 sync.js（纯函数不依赖 DOM/supabase）
require('../js/sync.js');
var S = global.fcSync;

var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.log('  FAIL: ' + name); }
}

/* =================== [1] LWW 合并：远端更新 =================== */
console.log('[1] LWW 合并 — 远端更新');
(function () {
  // 本地旧、远端新 → 写入远端
  var local = { id: 'a', amount: 100, updatedAt: 1000, deviceId: 'dev1', _sync: 'clean' };
  var remote = { id: 'a', amount: 200, updatedAt: 2000, deviceId: 'dev2', _sync: 'clean' };
  var m = S.mergeRecord(local, remote);
  assert(m.action === 'write', '远端 updatedAt 更大 → write');
  assert(m.record.amount === 200, '写入远端版（amount=200）');
})();

/* =================== [2] LWW 合并：本地更新 =================== */
console.log('[2] LWW 合并 — 本地更新');
(function () {
  var local = { id: 'a', amount: 300, updatedAt: 3000, deviceId: 'dev1', _sync: 'clean' };
  var remote = { id: 'a', amount: 200, updatedAt: 2000, deviceId: 'dev2', _sync: 'clean' };
  var m = S.mergeRecord(local, remote);
  assert(m.action === 'skip', '本地 updatedAt 更大 → skip');
  assert(m.record.amount === 300, '保留本地版（amount=300）');
})();

/* =================== [3] LWW 合并：本地无记录 =================== */
console.log('[3] LWW 合并 — 本地无记录');
(function () {
  var m1 = S.mergeRecord(null, { id: 'b', amount: 500, updatedAt: 1000, deleted: false });
  assert(m1.action === 'write', '本地无+远端非删 → write');
  assert(m1.record.id === 'b', '写入远端记录');

  var m2 = S.mergeRecord(null, { id: 'c', updatedAt: 1000, deleted: true });
  assert(m2.action === 'skip', '本地无+远端已删 → skip（无需操作）');
})();

/* =================== [4] LWW 合并：时间戳相等 deviceId tiebreak =================== */
console.log('[4] LWW 合并 — 相等时间戳 deviceId tiebreak');
(function () {
  // 远端 deviceId 字典序更大 → 远端胜
  var local = { id: 'a', amount: 100, updatedAt: 1000, deviceId: 'aaa', _sync: 'clean' };
  var remote = { id: 'a', amount: 200, updatedAt: 1000, deviceId: 'zzz', _sync: 'clean' };
  var m = S.mergeRecord(local, remote);
  assert(m.action === 'write', 'updatedAt 相等+远端 deviceId > 本地 → write');
  assert(m.record.amount === 200, '远端 deviceId 胜（amount=200）');

  // 本地 deviceId 更大 → 本地胜
  var m2 = S.mergeRecord(
    { id: 'a', amount: 100, updatedAt: 1000, deviceId: 'zzz', _sync: 'clean' },
    { id: 'a', amount: 200, updatedAt: 1000, deviceId: 'aaa', _sync: 'clean' }
  );
  assert(m2.action === 'skip', 'updatedAt 相等+本地 deviceId >= 远端 → skip');
})();

/* =================== [5] 墓碑：远端删除 =================== */
console.log('[5] 墓碑 — 远端删除');
(function () {
  // 本地有、远端删且更新 → 物理删除
  var local = { id: 'a', amount: 100, updatedAt: 1000, deviceId: 'd1' };
  var remote = { id: 'a', updatedAt: 2000, deviceId: 'd2', deleted: true };
  var m = S.mergeRecord(local, remote);
  assert(m.action === 'delete', '远端 deleted=true 且更新 → delete');

  // 远端删但本地更旧 → 本地胜，跳过
  var m2 = S.mergeRecord(
    { id: 'a', updatedAt: 3000, deviceId: 'd1' },
    { id: 'a', updatedAt: 2000, deviceId: 'd2', deleted: true }
  );
  assert(m2.action === 'skip', '本地更新 → 远端墓碑被忽略 → skip');
})();

/* =================== [6] 墓碑：远端删除本地无 =================== */
console.log('[6] 墓碑 — 远端删除本地无');
(function () {
  var m = S.mergeRecord(null, { id: 'x', updatedAt: 1000, deleted: true });
  assert(m.action === 'skip', '本地无+远端墓碑 → skip');
})();

/* =================== [7] 隐私路由：public → family =================== */
console.log('[7] 隐私路由分类 — public');
(function () {
  var tx = { privacy: 'public', amount: 100 };
  var r = S.classifyForSync(tx, 'tx');
  assert(r.table === 'family_docs', 'public → family_docs');
  assert(r.encKey === 'family', 'public → familyKey');
})();

/* =================== [8] 隐私路由：private → family_docs/personal =================== */
console.log('[8] 隐私路由分类 — private');
(function () {
  var tx = { privacy: 'private', amount: 100 };
  var r = S.classifyForSync(tx, 'tx');
  assert(r.table === 'family_docs', 'private → family_docs（拉到但对方解不开）');
  assert(r.encKey === 'personal', 'private → personalKey');
})();

/* =================== [9] 隐私路由：vault → personal_docs =================== */
console.log('[9] 隐私路由分类 — vault');
(function () {
  var tx = { privacy: 'vault', amount: 100 };
  var r = S.classifyForSync(tx, 'tx');
  assert(r.table === 'personal_docs', 'vault → personal_docs（物理隔离）');
  assert(r.encKey === 'personal', 'vault → personalKey');
})();

/* =================== [10] 隐私路由：settlement/category → family =================== */
console.log('[10] 隐私路由分类 — settlement/category');
(function () {
  var s = { id: 's1', month: '2026-01' };
  assert(S.classifyForSync(s, 'settlement').table === 'family_docs', 'settlement → family_docs');
  assert(S.classifyForSync(s, 'settlement').encKey === 'family', 'settlement → familyKey');

  var c = { id: 'c1', name: '餐饮' };
  assert(S.classifyForSync(c, 'category').table === 'family_docs', 'category → family_docs');
  assert(S.classifyForSync(c, 'category').encKey === 'family', 'category → familyKey');

  var st = { members: [] };
  assert(S.classifyForSync(st, 'settings').table === 'family_docs', 'settings → family_docs');
})();

/* =================== [11] dirty 扫描：识别 dirty 记录 =================== */
console.log('[11] dirty 扫描');
(function () {
  // mock db._cryptoBridge.rawRead
  var mockDb = {
    _cryptoBridge: {
      rawRead: function (key) {
        if (key === 'transactions') {
          return [
            { id: 't1', _sync: 'dirty', privacy: 'public' },
            { id: 't2', _sync: 'clean', privacy: 'public' },
            { id: 't3', _sync: 'dirty', privacy: 'vault' }
          ];
        }
        if (key === 'settlements') return [];
        if (key === 'categories') return [];
        if (key === 'settings') return null;
        return null;
      }
    }
  };
  var dirty = S.scanDirty(mockDb);
  assert(dirty.length === 2, '扫描出 2 条 dirty（t1+t3）');
  assert(dirty[0].rec.id === 't1', '第一条是 t1');
  assert(dirty[1].rec.id === 't3', '第二条是 t3');
  assert(dirty[1].route.table === 'personal_docs', 't3(vault) → personal_docs');
})();

/* =================== [12] dirty 扫描：settings =================== */
console.log('[12] dirty 扫描 — settings');
(function () {
  var mockDb = {
    _cryptoBridge: {
      rawRead: function (key) {
        if (key === 'transactions') return [];
        if (key === 'settlements') return [];
        if (key === 'categories') return [{ id: 'c1', _sync: 'dirty' }];
        if (key === 'settings') return { _sync: 'dirty', members: [] };
        return null;
      }
    }
  };
  var dirty = S.scanDirty(mockDb);
  assert(dirty.length === 2, '扫描出 2 条 dirty（category+settings）');
  assert(dirty[1].entityType === 'settings', '最后一条是 settings');
})();

/* =================== [13] LWW 边界：updatedAt 为 0 =================== */
console.log('[13] LWW 边界 — updatedAt 缺失');
(function () {
  var local = { id: 'a', amount: 100, deviceId: 'd1' }; // updatedAt 未设
  var remote = { id: 'a', amount: 200, updatedAt: 1, deviceId: 'd2' };
  var m = S.mergeRecord(local, remote);
  assert(m.action === 'write', '本地 updatedAt=0 + 远端有值 → write');
})();

/* =================== [14] LWW 边界：两端都无 updatedAt =================== */
console.log('[14] LWW 边界 — 两端都无 updatedAt');
(function () {
  var local = { id: 'a', amount: 100, deviceId: 'zzz' };
  var remote = { id: 'a', amount: 200, deviceId: 'aaa' };
  var m = S.mergeRecord(local, remote);
  assert(m.action === 'skip', 'updatedAt 均 0 → deviceId tiebreak → 本地 zzz > 远端 aaa → skip');
})();

/* =================== [15] LWW 边界：remote 为 null =================== */
console.log('[15] LWW 边界 — remote 为 null');
(function () {
  var m = S.mergeRecord({ id: 'a', updatedAt: 1 }, null);
  assert(m.action === 'skip', 'remote=null → skip');
})();

/* =================== [16] 墓碑：远端删除+时间戳相等 =================== */
console.log('[16] 墓碑 — 远端删除+时间戳相等 deviceId tiebreak');
(function () {
  // 远端 deviceId > 本地 + 远端 deleted → delete
  var m = S.mergeRecord(
    { id: 'a', updatedAt: 1000, deviceId: 'aaa' },
    { id: 'a', updatedAt: 1000, deviceId: 'zzz', deleted: true }
  );
  assert(m.action === 'delete', '相等时间戳+远端 deviceId 胜+墓碑 → delete');
})();

/* =================== [17] 隐私路由：undefined privacy 默认 public =================== */
console.log('[17] 隐私路由 — undefined privacy 默认 public');
(function () {
  var tx = { amount: 100 }; // privacy 未设
  var r = S.classifyForSync(tx, 'tx');
  assert(r.table === 'family_docs', 'undefined privacy → family_docs');
  assert(r.encKey === 'family', 'undefined privacy → familyKey');
})();

/* =================== [18] dirty 扫描：空数据 =================== */
console.log('[18] dirty 扫描 — 空数据');
(function () {
  var mockDb = { _cryptoBridge: { rawRead: function () { return null; } } };
  var dirty = S.scanDirty(mockDb);
  assert(dirty.length === 0, '空数据 → 0 条 dirty');
})();

/* =================== [19] dirty 扫描：全 clean =================== */
console.log('[19] dirty 扫描 — 全 clean');
(function () {
  var mockDb = {
    _cryptoBridge: {
      rawRead: function (key) {
        if (key === 'transactions') return [{ id: 't1', _sync: 'clean' }];
        if (key === 'settlements') return [{ id: 's1', _sync: 'clean' }];
        if (key === 'categories') return [{ id: 'c1', _sync: 'clean' }];
        if (key === 'settings') return { _sync: 'clean' };
        return null;
      }
    }
  };
  assert(S.scanDirty(mockDb).length === 0, '全 clean → 0 条 dirty');
})();

/* =================== [20] LWW：远端和本地完全相同 =================== */
console.log('[20] LWW — 完全相同（updatedAt+deviceId 都相等）');
(function () {
  var rec = { id: 'a', amount: 100, updatedAt: 1000, deviceId: 'dev1' };
  var m = S.mergeRecord(rec, rec);
  assert(m.action === 'skip', '完全相同 → skip（本地 deviceId >= 远端）');
})();

/* ---- summary ---- */
console.log('\n=================================');
console.log('sync.test.js: ' + passed + ' passed, ' + failed + ' failed (total ' + (passed + failed) + ')');
console.log('=================================');
if (failed > 0) console.log('❌ 有失败用例');
else console.log('✅ 全部通过');
process.exit(failed > 0 ? 1 : 0);

/* ============================================================
 * schema v1→v2 迁移 + 同步字段打标单测（node test/schema-v2.test.js）
 * 覆盖 09-PRD §5.1：updatedAt / deviceId / deleted / _sync
 * ============================================================ */
'use strict';

/* ---- localStorage 桩 ---- */
function makeLocalStorageStub() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    key: function (i) { return Object.keys(store)[i] || null; },
    get length() { return Object.keys(store).length; },
    _dump: function () { return store; }
  };
}
global.localStorage = makeLocalStorageStub();
global.window = global;

/* ---- 载入被测代码 ---- */
require('../js/db.js');

/* ---- 极简断言 ---- */
var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}
function resetStorage() { global.localStorage = makeLocalStorageStub(); }
function lsSet(key, val) { global.localStorage.setItem(key, JSON.stringify(val)); }
function lsGet(key) { var raw = global.localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); }

/* ============================================================
 * [1] stampSyncV2 纯函数
 * ============================================================ */
console.log('[1] stampSyncV2 纯函数（补齐/幂等/回退）');
var dev = 'dev_test123', T = 5000;

assert(fcDb.stampSyncV2(null, dev, T) === null, 'null 安全返回');
assert(fcDb.stampSyncV2('x', dev, T) === 'x', '非对象原样返回');

var old1 = { id: 't1', amount: 1000, createdAt: 1000 };
fcDb.stampSyncV2(old1, dev, T);
assert(old1.updatedAt === 1000, 'updatedAt 缺失时回退 createdAt');
assert(old1.deviceId === dev, 'deviceId 补齐');
assert(old1.deleted === false, 'deleted 补 false');
assert(old1._sync === 'dirty', '_sync 补 dirty');
assert(old1.amount === 1000 && old1.id === 't1', '业务字段不被改动');

var old2 = { id: 't2', createdAt: 2000 }; // 无 updatedAt 无 createdAt? 有 createdAt
fcDb.stampSyncV2(old2, dev, T);
assert(old2.updatedAt === 2000, 'updatedAt 回退 createdAt（2000）');

var old3 = { id: 't3' }; // 连 createdAt 都没有
fcDb.stampSyncV2(old3, dev, T);
assert(old3.updatedAt === T, 'updatedAt/createdAt 均缺时回退 now');

var clean = { id: 't4', updatedAt: 800, deviceId: 'dev_other', deleted: true, _sync: 'clean', createdAt: 700 };
fcDb.stampSyncV2(clean, dev, T);
assert(clean.updatedAt === 800, '幂等：updatedAt 已存在不覆盖');
assert(clean.deviceId === 'dev_other', '幂等：deviceId 已存在不覆盖');
assert(clean.deleted === true, '幂等：deleted=true 保留（墓碑不被翻案）');
assert(clean._sync === 'clean', '幂等：_sync=clean 不重置 dirty');

var dirtyKept = { id: 't5', _sync: 'dirty' };
fcDb.stampSyncV2(dirtyKept, dev, T);
assert(dirtyKept._sync === 'dirty', '_sync=dirty 保持 dirty');

/* ============================================================
 * [2] migrateCollectionV2 纯函数
 * ============================================================ */
console.log('[2] migrateCollectionV2 集合迁移');
var list = [{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }];
var ret = fcDb.migrateCollectionV2(list, dev, T);
assert(ret === list && list.length === 2, '返回原数组（原地补齐）');
assert(list[0].deviceId === dev && list[1].deviceId === dev, '逐条补齐 deviceId');
assert(list[0]._sync === 'dirty' && list[1]._sync === 'dirty', '逐条标 dirty');
assert(fcDb.migrateCollectionV2(null, dev, T) === null, 'null 原样返回');

/* ============================================================
 * [3] v1 → v2 迁移（模拟旧版本数据落库后 migrate）
 * ============================================================ */
console.log('[3] v1→v2 存量数据迁移');
resetStorage();
// 构造 v1 时代的数据形态：无 deviceId/deleted/_sync；settlements/categories 无 updatedAt
lsSet('fc_schema_version', 1);
lsSet('fc_settings', { familyName: '老家', members: [{ id: 'm1', name: '海', emoji: '🧑' }, { id: 'm2', name: '棠', emoji: '👩' }], currentViewer: 'm1' });
lsSet('fc_transactions', [
  { id: 't_old1', date: '2026-03-01', type: 'expense', amount: 12800, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true, note: '旧火锅', splitRatio: { m1: 50, m2: 50 }, createdAt: 1000, updatedAt: 1000 },
  { id: 't_old2', date: '2026-03-02', type: 'income', amount: 500000, categoryId: 'c_salary', ownerId: 'm2', privacy: 'public', shared: false, note: '旧工资', splitRatio: { m1: 50, m2: 50 }, createdAt: 2000, updatedAt: 2000 }
]);
lsSet('fc_settlements', [
  { id: 's_old1', month: '2026-02', status: 'settled', from: 'm2', to: 'm1', amount: 500, itemsCount: 3, totalShare: { m1: 30000, m2: 30500 }, createdAt: 900, confirmedAt: 900, settledAt: 950, voidedAt: null }
]);
lsSet('fc_categories', [
  { id: 'c_food', name: '餐饮', icon: '🍜', type: 'expense', builtin: true, hidden: false },
  { id: 'c_custom1', name: '宠物', icon: '🐱', type: 'expense', builtin: false, hidden: false, createdAt: 800 }
]);

fcDb.migrate();

assert(lsGet('fc_schema_version') === 2, '迁移后 schema 版本 = 2');
var devId = lsGet('fc_device_id');
assert(typeof devId === 'string' && devId.indexOf('dev_') === 0, 'deviceId 生成并持久化（fc_device_id）');
assert(fcDb.getDeviceId() === devId, 'getDeviceId 与落盘一致且稳定');

var txs = lsGet('fc_transactions');
assert(txs.every(function (t) { return t.deviceId === devId && t.deleted === false && t._sync === 'dirty'; }), '交易全部补齐 deviceId/deleted/_sync=dirty');
assert(txs[0].updatedAt === 1000 && txs[1].updatedAt === 2000, '交易 updatedAt 保留旧值（不重置）');
assert(txs[0].amount === 12800 && txs[0].note === '旧火锅' && txs[1].ownerId === 'm2', '交易业务字段原样保留');

var sts = lsGet('fc_settlements');
assert(sts[0].deviceId === devId && sts[0].deleted === false && sts[0]._sync === 'dirty', '结算补齐同步字段');
assert(sts[0].updatedAt === 900, '结算 updatedAt 缺失回退 createdAt(900)');
assert(sts[0].status === 'settled' && sts[0].amount === 500, '结算业务字段原样保留');

var cats = lsGet('fc_categories');
assert(cats.every(function (c) { return c.deviceId === devId && c.deleted === false && c._sync === 'dirty'; }), '分类补齐同步字段（存量全量 dirty 待首推）');
assert(cats[0].updatedAt && cats[0].name === '餐饮', '无 createdAt 的预置分类 updatedAt 回退 now');
assert(cats[1].updatedAt === 800, '自定义分类 updatedAt 回退 createdAt(800)');

/* 幂等：版本=2 再 migrate 不翻案 */
txs[0]._sync = 'clean'; lsSet('fc_transactions', txs);
fcDb.migrate();
assert(lsGet('fc_transactions')[0]._sync === 'clean', '重复 migrate 幂等：clean 不被重置为 dirty');

/* ============================================================
 * [4] 全新 v2 安装：写入自动打标
 * ============================================================ */
console.log('[4] 全新 v2 安装：写入自动打标');
resetStorage();
fcDb.migrate(); // 模拟 app.js boot：首行先 migrate（version 不存在 → 写当前版本）
assert(fcDb.init({ familyName: '新家', members: [{ name: '海', emoji: '🧑' }, { name: '棠', emoji: '👩' }], ratio: { m1: 50, m2: 50 } }).ok, 'init 成功');
assert(lsGet('fc_schema_version') === 2, '新装 schema 版本直接 = 2');

var presetCats = fcDb.categoriesList();
assert(presetCats.every(function (c) { return c._sync === 'clean' && c.deleted === false && !!c.deviceId; }), '预置分类 _sync=clean（内容不推送，仅 hidden 变更推送）');

var addR = fcDb.tx.add({ date: '2026-09-06', type: 'expense', amount: 6660, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', note: '新火锅' });
assert(addR.ok, '新增交易成功');
assert(addR.record._sync === 'dirty' && addR.record.deleted === false && !!addR.record.deviceId, '新增交易带 dirty/deviceId/deleted=false');
assert(typeof addR.record.updatedAt === 'number' && addR.record.updatedAt >= addR.record.createdAt, '新增交易 updatedAt 有效');

var beforeUpd = addR.record.updatedAt;
var updR = fcDb.tx.update(addR.record.id, { note: '改备注' });
assert(updR.ok && updR.record._sync === 'dirty', '更新交易后 _sync=dirty');
assert(updR.record.updatedAt >= beforeUpd, '更新交易 updatedAt 刷新');
assert(updR.record.note === '改备注', '更新内容生效');

/* 结算打标 */
var splitModuleOk = typeof fcSplit !== 'undefined';
if (!splitModuleOk) {
  // 直接构造 settlements.add 需要的 result 结构
  var stR = fcDb.settlements.add('2026-08', {
    transfer: { from: 'm2', to: 'm1', amount: 123 },
    items: [1, 2], shares: { m1: 10000, m2: 10123 }
  });
  assert(stR.ok, '新增结算成功');
  assert(stR.record._sync === 'dirty' && !!stR.record.deviceId && stR.record.deleted === false, '新增结算带同步字段');
  var stSet = fcDb.settlements.setStatus(stR.record.id, 'settled');
  assert(stSet.ok && stSet.record._sync === 'dirty', '结算状态变更置 dirty');
}

/* 分类打标 */
var catR = fcDb.categories.add({ name: '宠物', icon: '🐱', type: 'expense' });
assert(catR.ok, '新增自定义分类成功');
assert(catR.record._sync === 'dirty' && !!catR.record.deviceId && catR.record.deleted === false, '新增分类带同步字段');
var hidR = fcDb.categories.setHidden('c_fun', true);
assert(hidR.ok, '隐藏预置分类成功');
var funCat = fcDb.categoriesList().filter(function (c) { return c.id === 'c_fun'; })[0];
assert(funCat.hidden === true && funCat._sync === 'dirty', '分类 hidden 变更置 dirty（预置分类隐藏状态需同步）');

/* ============================================================
 * [5] deviceId 稳定性
 * ============================================================ */
console.log('[5] deviceId 跨调用稳定');
var d1 = fcDb.getDeviceId(), d2 = fcDb.getDeviceId();
assert(d1 === d2 && d1.indexOf('dev_') === 0, 'getDeviceId 多次调用一致');

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n========================================');
console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
console.log('========================================');
process.exit(failed ? 1 : 0);

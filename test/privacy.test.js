/* ============================================================
 * privacy/db 核心逻辑单测（node test/privacy.test.js 直接运行）
 * 覆盖 07-PRD §10 隐私×身份验收矩阵 + 分摊前统计口径
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
    get length() { return Object.keys(store).length; }
  };
}
global.localStorage = makeLocalStorageStub();
global.window = global;

/* ---- 载入被测代码 ---- */
require('../js/db.js');
require('../js/privacy.js');

/* ---- 极简断言 ---- */
var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

/* ---- 测试数据 ---- */
console.log('[1] 初始化 + 建账');
assert(fcDb.init({ familyName: '测试家', members: [{ name: '小海', emoji: '🧑' }, { name: '小棠', emoji: '👩' }], ratio: { m1: 50, m2: 50 } }).ok, 'init 成功');

var today = '2026-09-06';
var vaultId = fcDb.getVaultOf('m1').id;
var r1 = fcDb.tx.add({ date: today, type: 'expense', amount: 6660, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true, note: '公开餐' });
var r2 = fcDb.tx.add({ date: today, type: 'expense', amount: 8888, categoryId: 'c_shopping', ownerId: 'm1', privacy: 'private', note: '私密账' });
var r3 = fcDb.tx.add({ date: today, type: 'expense', amount: 9999, categoryId: 'c_other', ownerId: 'm1', privacy: 'vault', vaultId: vaultId, note: '小金库账' });
var r4 = fcDb.tx.add({ date: today, type: 'income', amount: 500000, categoryId: 'c_salary', ownerId: 'm2', privacy: 'public', note: '小棠工资' });
if (!(r1.ok && r2.ok && r3.ok && r4.ok)) {
  console.error('入库失败详情:', JSON.stringify([r1, r2, r3, r4]));
}
assert(r1.ok && r2.ok && r3.ok && r4.ok, '四笔账目入库');
assert(r1.record.shared === true && r2.record.shared === false && r3.record.shared === false, 'shared 强制约束：public支出可参与；private/vault 强制不参与');
var bad1 = fcDb.tx.add({ date: today, type: 'expense', amount: 100, categoryId: 'c_food', ownerId: 'm2', privacy: 'vault', vaultId: vaultId });
assert(!bad1.ok, '校验：小金库账目不能归属非本人');
var bad2 = fcDb.tx.add({ date: today, type: 'expense', amount: -5, categoryId: 'c_food', ownerId: 'm1', privacy: 'public' });
assert(!bad2.ok, '校验：金额必须>0');

console.log('[2] 隐私×身份矩阵（小海=m1 视角）');
var v1 = fcPrivacy.view(fcDb.tx.list(), 'm1');
assert(v1.visible.length === 4, '本人可见全部4笔（含自己的私密/小金库）');
assert(v1.placeholders.length === 0, '本人视角无占位行');

console.log('[3] 隐私×身份矩阵（小棠=m2 视角）');
var v2 = fcPrivacy.view(fcDb.tx.list(), 'm2');
assert(v2.visible.length === 2, '对方可见2笔（m1公开餐 + 自己工资）');
assert(v2.placeholders.length === 1 && v2.placeholders[0].id === r2.record.id, 'm1私密账→恰好1条占位');
assert(v2.visible.every(function (t) { return t.id !== r3.record.id; }), 'm1小金库账→完全无痕（不在可见列表）');
assert(v2.placeholders.every(function (t) { return t.id !== r3.record.id; }), 'm1小金库账→也不在占位列表');

console.log('[4] 统计口径（07-PRD §5.3）');
var t1 = fcPrivacy.monthTotals(fcDb.tx.list(), 'm1', '2026-09');
assert(t1.expense === 6660 + 8888 + 9999 && t1.income === 500000, '本人口径：支=公开+私密+小金库；收含对方公开收入');
var t2 = fcPrivacy.monthTotals(fcDb.tx.list(), 'm2', '2026-09');
assert(t2.expense === 6660 && t2.income === 500000, '对方口径：支仅公开账，收=自己工资（私密/小金库不泄入统计）');

console.log('[5] 小金库视图');
var vaultV = fcPrivacy.vaultView(fcDb.tx.list(), 'm1');
assert(vaultV.list.length === 1 && vaultV.balance === -9999, 'm1小金库余额=-9999分，仅1笔');
assert(fcPrivacy.vaultView(fcDb.tx.list(), 'm2').list.length === 0, 'm2小金库为空');

console.log('[6] 编辑/删除');
var u1 = fcDb.tx.update(r1.record.id, { amount: 7770 });
assert(u1.ok && fcDb.tx.list()[0].amount === 7770, '更新金额生效');
var d1 = fcDb.tx.remove(r4.record.id);
assert(d1.ok && fcDb.tx.list().length === 3, '删除生效');

console.log('[7] 导入导出闭环');
var json = fcDb.exportAll();
fcDb.resetAll();
var imp = fcDb.importAll(json);
assert(imp.ok && fcDb.tx.list().length === 3 && fcDb.getSettings().members.length === 2, '导出→清空→导入 完整还原');

console.log('');
console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);

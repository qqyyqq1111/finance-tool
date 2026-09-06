/* ============================================================
 * 分摊结算引擎单测（node test/split.test.js 直接运行）
 * 逐条覆盖 07-PRD §6.4 验收用例 + 结算锁定规则
 * 设计要点：
 *  - 每个用例独立月份，避免相互污染
 *  - 比例在落账时固化到交易（splitRatio），规则改动不追溯（07-PRD §6.1）
 * 注：PRD §6.4 用例3"覆盖比例8:2"与用例2的 m1:m2 书写约定矛盾
 *     （8:2 按 m1:m2 应为 A 付160，期望却是40），按统一约定实现，
 *     用例数据修正为 m1:m2=2:8（A 承担2成）→ A应付B 40元。
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

require('../js/db.js');
require('../js/privacy.js');
require('../js/split.js');

var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}
function settle(month) { return fcSplit.monthSettlement(fcDb.tx.list(), month, fcDb.getSettings()); }

console.log('[0] 初始化');
assert(fcDb.init({ familyName: '测试家', members: [{ name: '小海', emoji: '🧑' }, { name: '小棠', emoji: '👩' }], ratio: { m1: 50, m2: 50 } }).ok, 'init 成功（默认5:5）');

console.log('[1] 用例1 基本5:5：A垫付100元共同餐饮 → B应付A 50元（2026-01）');
var r1 = fcDb.tx.add({ date: '2026-01-10', type: 'expense', amount: 10000, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true, note: '共同餐' });
assert(r1.ok && r1.record.splitRatio.m1 === 50, '入库且固化比例50:50');
var st = settle('2026-01');
assert(st.items.length === 1 && st.transfer.from === 'm2' && st.transfer.to === 'm1' && st.transfer.amount === 5000, 'B应付A 5000分');

console.log('[2] 用例2 自定义比例：房租7000元 3:7(m1:m2) A垫付 → B应付A 4900元（2026-02）');
assert(fcDb.setSplitRule({ defaultRatio: { m1: 30, m2: 70 } }).ok, '默认比例改为3:7');
var r2 = fcDb.tx.add({ date: '2026-02-01', type: 'expense', amount: 700000, categoryId: 'c_rent', ownerId: 'm1', privacy: 'public', shared: true, note: '房租' });
assert(r2.record.splitRatio.m1 === 30, '落账固化3:7');
st = settle('2026-02');
assert(st.transfer.amount === 490000 && st.transfer.from === 'm2' && st.transfer.to === 'm1', 'B应付A 4900元（700000×70%）');
assert(settle('2026-01').transfer.amount === 5000, '规则改动不影响历史账目（1月仍按50:50）');
assert(fcDb.setSplitRule({ defaultRatio: { m1: 50, m2: 50 } }).ok, '恢复默认5:5');

console.log('[3] 用例3 类别覆盖：购物200元 A承担2成(m1:m2=20:80) B垫付 → A应付B 40元（2026-03）');
assert(fcDb.setSplitRule({ categoryOverrides: { c_shopping: { m1: 20, m2: 80 } } }).ok, '设置购物覆盖20:80');
var r3 = fcDb.tx.add({ date: '2026-03-05', type: 'expense', amount: 20000, categoryId: 'c_shopping', ownerId: 'm2', privacy: 'public', shared: true, note: '购物' });
st = settle('2026-03');
assert(st.transfer.from === 'm1' && st.transfer.to === 'm2' && st.transfer.amount === 4000, 'A应付B 4000分');
assert(fcDb.setSplitRule({ categoryOverrides: { c_shopping: null } }).ok, '删除覆盖恢复默认');

console.log('[4] 用例4/5 私密、小金库、不分摊、收入 均不参与（2026-04）');
var r4 = fcDb.tx.add({ date: '2026-04-01', type: 'expense', amount: 50000, categoryId: 'c_gift', ownerId: 'm1', privacy: 'private', note: '私密' });
var r5 = fcDb.tx.add({ date: '2026-04-02', type: 'expense', amount: 100000, categoryId: 'c_other', ownerId: 'm1', privacy: 'vault', vaultId: fcDb.getVaultOf('m1').id, note: '小金库' });
var r6 = fcDb.tx.add({ date: '2026-04-03', type: 'expense', amount: 30000, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: false, note: '公开但不分摊' });
var r7 = fcDb.tx.add({ date: '2026-04-04', type: 'income', amount: 500000, categoryId: 'c_salary', ownerId: 'm2', privacy: 'public', note: '工资' });
var r8 = fcDb.tx.add({ date: '2026-04-05', type: 'expense', amount: 3333, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true, note: '尾差餐' });
st = settle('2026-04');
assert(st.items.length === 1, '仅1笔共同支出进入构成明细');
assert(st.items[0].txId === r8.record.id, '私密/小金库/不分摊/收入均被排除');

console.log('[5] 用例6 尾差：33.33元 5:5 → 1667/1666（差额给m1）');
var one = fcSplit.splitOne(3333, { m1: 50, m2: 50 });
assert(one.m1 === 1667 && one.m2 === 1666 && one.m1 + one.m2 === 3333, '单笔尾差 m1=1667 m2=1666');

console.log('[6] 用例7 收入不参与 + 汇总守恒');
assert(st.balance.m1 === -st.balance.m2, '双人 balance 互为相反数');
assert(st.paid.m1 === 3333 && st.paid.m2 === 0, '垫付仅计共同支出实付人');
assert(st.shares.m1 + st.shares.m2 === 3333, '分摊合计=支出合计');

console.log('[7] 跨月隔离（2026-05）');
var r9 = fcDb.tx.add({ date: '2026-05-01', type: 'expense', amount: 99900, categoryId: 'c_fun', ownerId: 'm2', privacy: 'public', shared: true, note: '5月支出' });
assert(settle('2026-04').items.every(function (i) { return i.txId !== r9.record.id; }), '5月支出不进4月结算');

console.log('[8] 用例8 锁定：确认4月结算后账目写操作被拦截');
var st4 = settle('2026-04');
var addRes = fcDb.settlements.add('2026-04', st4);
assert(addRes.ok, '确认4月结算成功');
assert(!fcDb.settlements.add('2026-04', st4).ok, '同月重复确认被拦截');
var upd = fcDb.tx.update(r8.record.id, { amount: 20000 });
assert(!upd.ok && /已确认结算/.test(upd.errors[0]), '编辑4月账目被拦截并提示');
var del = fcDb.tx.remove(r8.record.id);
assert(!del.ok && /已确认结算/.test(del.errors[0]), '删除4月账目被拦截');
var add2 = fcDb.tx.add({ date: '2026-04-20', type: 'expense', amount: 500, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true });
assert(!add2.ok && /已确认结算/.test(add2.errors[0]), '向已结算月份补录被拦截');
var updMay = fcDb.tx.update(r9.record.id, { amount: 88800 });
assert(updMay.ok, '未结算月份（5月）修改不受影响');

console.log('[9] 标记结清 + 作废解锁');
assert(fcDb.settlements.setStatus(addRes.record.id, 'settled').ok, '标记已结清');
assert(fcDb.settlements.setStatus(addRes.record.id, 'settled').ok === false, '重复标记结清被拦截');
var voidRes = fcDb.settlements.setStatus(addRes.record.id, 'void');
assert(voidRes.ok && fcDb.settlements.findByMonth('2026-04') === null, '作废后该月无有效结算');
assert(fcDb.tx.update(r8.record.id, { amount: 20000 }).ok, '作废后4月账目可编辑');
assert(fcDb.tx.update(r8.record.id, { amount: 3333 }).ok, '还原金额');

console.log('[10] 两清：双方各垫付一笔相同额度的共同支出（2026-06，偶数分）');
var c1 = fcDb.tx.add({ date: '2026-06-01', type: 'expense', amount: 10000, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true });
var c2 = fcDb.tx.add({ date: '2026-06-02', type: 'expense', amount: 10000, categoryId: 'c_food', ownerId: 'm2', privacy: 'public', shared: true });
var st6 = settle('2026-06');
assert(st6.twoClean && st6.transfer === null && st6.balance.m1 === 0 && st6.balance.m2 === 0, '本月两清');

console.log('');
console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);

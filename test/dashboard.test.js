/* ============================================================
 * 仪表盘/设置/分类/版本 单测（node test/dashboard.test.js 直接运行）
 * 覆盖 07-PRD §7 看板口径、§8 成员/分类管理、§9 版本分层
 * ============================================================ */
'use strict';

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
require('../js/dashboard.js');

var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

console.log('[0] 初始化');
assert(fcDb.init({ familyName: '测试家', members: [{ name: '小海', emoji: '🧑' }, { name: '小棠', emoji: '👩' }], ratio: { m1: 50, m2: 50 } }).ok, 'init 成功');
var M = '2026-09';

console.log('[1] 数据准备（含不同隐私/分类/日期）');
fcDb.tx.add({ date: M + '-01', type: 'expense', amount: 10000, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true, note: '餐1' });
fcDb.tx.add({ date: M + '-01', type: 'expense', amount: 30000, categoryId: 'c_food', ownerId: 'm2', privacy: 'public', shared: true, note: '餐2' });
fcDb.tx.add({ date: M + '-02', type: 'expense', amount: 20000, categoryId: 'c_shopping', ownerId: 'm1', privacy: 'public', shared: false, note: '购物' });
fcDb.tx.add({ date: M + '-02', type: 'expense', amount: 50000, categoryId: 'c_transport', ownerId: 'm1', privacy: 'private', note: '私密交通' });
fcDb.tx.add({ date: M + '-03', type: 'expense', amount: 70000, categoryId: 'c_other', ownerId: 'm1', privacy: 'vault', vaultId: fcDb.getVaultOf('m1').id, note: '小金库' });
fcDb.tx.add({ date: M + '-03', type: 'income', amount: 1200000, categoryId: 'c_salary', ownerId: 'm2', privacy: 'public', note: '工资' });

console.log('[2] 分类占比（本人m1视角，07-PRD §7 口径）');
var bd = fcDash.categoryBreakdown(fcDb.tx.list(), 'm1', M);
// m1可见支出：餐1=10000(food) 餐2=30000(food) 购物20000(shopping) 私密交通50000(transport) 小金库70000(other)
assert(bd.total === 10000 + 30000 + 20000 + 50000 + 70000, '总支出=本人可见全部支出（含私密/小金库，不含收入）');
var food = bd.items.filter(function (i) { return i.categoryId === 'c_food'; })[0];
assert(food && food.amount === 40000 && Math.abs(food.pct - 40000 / 180000) < 1e-9, '餐饮合计40000且占比正确');
assert(bd.items[0].amount >= bd.items[1].amount, '按金额倒序');
assert(Math.abs(bd.items.reduce(function (s, i) { return s + i.pct; }, 0) - 1) < 1e-9, '占比合计=1');

console.log('[3] 分类占比（对方m2视角：私密/小金库不可见）');
var bd2 = fcDash.categoryBreakdown(fcDb.tx.list(), 'm2', M);
// m2可见支出：餐1 10000(food) 餐2 30000(food) 购物20000(shopping)；私密交通与小金库不可见
assert(bd2.total === 60000, '对方口径不含私密/小金库（10000+30000+20000）');
assert(bd2.items.every(function (i) { return ['c_food', 'c_shopping'].indexOf(i.categoryId) >= 0; }), '不泄露transport/other分类');
assert(bd2.total === fcPrivacy.monthTotals(fcDb.tx.list(), 'm2', M).expense, '§10验收：分类占比合计=查看人可见支出合计（口径一致）');

console.log('[4] 记账天数（去重日期）');
var rd = fcDash.recordDays(fcDb.tx.list(), 'm1', M);
assert(rd.count === 3 && rd.daysInMonth === 30, '3个有记录日期 / 9月30天');

console.log('[5] 双人对比复用结算引擎（仅public共同支出）');
var cmp = fcDash.duoCompare(fcDb.tx.list(), M, fcDb.getSettings());
assert(cmp.paid.m1 === 10000 && cmp.paid.m2 === 30000, '垫付仅共同支出（餐1 m1/餐2 m2），购物不分摊、私密/小金库排除');

console.log('[6] 成员管理（改名/emoji；约束）');
assert(fcDb.updateMember('m1', { name: '阿晨' }).ok, '改名成功');
assert(fcDb.findMember('m1').name === '阿晨', '落库生效');
assert(!fcDb.updateMember('m1', { name: '' }).ok, '空昵称拒绝');
assert(!fcDb.updateMember('m1', { name: '1234567' }).ok, '超6字拒绝');
assert(fcDb.updateMember('m1', { emoji: '🐱' }).ok && fcDb.findMember('m1').emoji === '🐱', '改emoji成功');
assert(!fcDb.updateMember('mX', { name: 'x' }).ok, '不存在成员拒绝');

console.log('[7] 分类管理（预置可隐藏不可删；自定义规则）');
var builtin = fcDb.categoriesList()[0].id;
assert(!fcDb.categories.remove(builtin).ok, '预置分类不可删除');
assert(fcDb.categories.setHidden(builtin, true).ok && fcDb.categoriesList()[0].hidden === true, '预置可隐藏');
var add1 = fcDb.categories.add({ name: '宠物', type: 'expense' });
assert(add1.ok, '自定义分类可添加');
assert(!fcDb.categories.add({ name: '宠物', type: 'expense' }).ok, '同名拒绝');
assert(!fcDb.categories.add({ name: 'x', type: 'bad' }).ok, '非法类型拒绝');
// 被交易引用的自定义分类不可删
fcDb.tx.add({ date: M + '-10', type: 'expense', amount: 5000, categoryId: add1.record.id, ownerId: 'm1', privacy: 'public' });
assert(!fcDb.categories.remove(add1.record.id).ok, '有账目的自定义分类不可删除');
// 无引用的自定义可删
var add2 = fcDb.categories.add({ name: '闲置', type: 'income' });
assert(fcDb.categories.remove(add2.record.id).ok, '无引用自定义可删除');

console.log('[8] 版本分层（tier）');
assert(fcDb.setTier('free').ok && fcDb.getSettings().tier === 'free', '可切免费版');
assert(fcDb.setTier('family').ok && fcDb.getSettings().tier === 'family', '可切会员版');
assert(!fcDb.setTier('vip').ok, '非法版本拒绝');

console.log('');
console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);

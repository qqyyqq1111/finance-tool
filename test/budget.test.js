/* ============================================================
 * budget.test.js — F4 支出预算 纯函数单测（v1.2 批次④）
 * 运行：node test/budget.test.js
 * ============================================================ */
'use strict';

global.window = global;
require('../js/budget.js');
var B = fcBudget;

var passed = 0;
var failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}
function eq(name, actual, expected) {
  check(name + '（实际=' + JSON.stringify(actual) + '）', JSON.stringify(actual) === JSON.stringify(expected));
}

var CATS = [
  { id: 'c_food', name: '餐饮', icon: '🍜', type: 'expense', builtin: true },
  { id: 'c_transport', name: '交通', icon: '🚌', type: 'expense', builtin: true },
  { id: 'c_shopping', name: '购物', icon: '🛍️', type: 'expense', builtin: true },
  { id: 'c_salary', name: '工资', icon: '💼', type: 'income', builtin: true }
];

/* ---------- 1. expenseCategories ---------- */
eq('支出分类3个', B.expenseCategories(CATS).length, 3);
check('不含工资', B.expenseCategories(CATS).every(function (c) { return c.type === 'expense'; }));

/* ---------- 2. normalizeBudget ---------- */
var nb = B.normalizeBudget(null, CATS);
eq('默认全部支出分类预算0', Object.keys(nb.budgets).length, 3);
eq('餐饮默认0', nb.budgets.c_food, 0);
eq('enableSuggestions默认true', nb.enableSuggestions, true);
eq('suggestionsDismissed默认空对象', nb.suggestionsDismissed, {});

var oldB = { budgets: { c_food: 200000 }, enableSuggestions: false };
var nb2 = B.normalizeBudget(oldB, CATS);
eq('保留已有预算', nb2.budgets.c_food, 200000);
eq('缺失分类补0', nb2.budgets.c_transport, 0);
eq('enableSuggestions=false保留', nb2.enableSuggestions, false);

/* ---------- 3. prevMonthKey ---------- */
eq('10月→9月', B.prevMonthKey('2026-10'), '2026-09');
eq('1月→去年12月', B.prevMonthKey('2026-01'), '2025-12');

/* ---------- 4. monthExpenseByCat ---------- */
var txs = [
  { date: '2026-10-01', type: 'expense', amount: 10000, categoryId: 'c_food' },
  { date: '2026-10-02', type: 'expense', amount: 20000, categoryId: 'c_food' },
  { date: '2026-10-03', type: 'expense', amount: 5000, categoryId: 'c_transport' },
  { date: '2026-10-04', type: 'income', amount: 50000, categoryId: 'c_salary' },
  { date: '2026-09-30', type: 'expense', amount: 9999, categoryId: 'c_food' }
];
var spent = B.monthExpenseByCat(txs, '2026-10');
eq('餐饮10月合计3万', spent.c_food, 30000);
eq('交通10月5千', spent.c_transport, 5000);
check('不含收入', spent.c_salary === undefined);
check('不含9月', spent.c_food === 30000);

/* ---------- 5. progressLevel ---------- */
eq('50% ok', B.progressLevel(0.5), 'ok');
eq('60% watch', B.progressLevel(0.6), 'watch');
eq('79% watch', B.progressLevel(0.79), 'watch');
eq('80% near', B.progressLevel(0.8), 'near');
eq('99% near', B.progressLevel(0.99), 'near');
eq('100% over', B.progressLevel(1), 'over');
eq('150% over', B.progressLevel(1.5), 'over');

/* ---------- 6. warnLevel ---------- */
eq('79% null', B.warnLevel(0.79), null);
eq('80% warn', B.warnLevel(0.8), 'warn');
eq('99% warn', B.warnLevel(0.99), 'warn');
eq('100% over', B.warnLevel(1), 'over');
eq('149% over', B.warnLevel(1.49), 'over');
eq('150% severe', B.warnLevel(1.5), 'severe');

/* ---------- 7. budgetProgress ---------- */
var b1 = B.normalizeBudget({ budgets: { c_food: 250000, c_transport: 100000 } }, CATS);
var prog = B.budgetProgress(b1, spent, CATS);
eq('餐饮行预算25万', prog.rows[0].budget, 250000);
eq('餐饮已花3万', prog.rows[0].spent, 30000);
check('餐饮12%=ok', prog.rows[0].level === 'ok');
eq('交通行已花5千', prog.rows.filter(function (r) { return r.id === 'c_transport'; })[0].spent, 5000);
eq('总预算35万', prog.total.budget, 350000);
eq('总已花3.5万', prog.total.spent, 35000);
eq('总剩余31.5万', prog.total.remain, 315000);
check('购物无预算无支出不出现', !prog.rows.some(function (r) { return r.id === 'c_shopping'; }));

/* 超支场景 */
var spentOver = { c_food: 300000 };
var progOver = B.budgetProgress(b1, spentOver, CATS);
var foodRow = progOver.rows.filter(function (r) { return r.id === 'c_food'; })[0];
eq('餐饮pct120%', foodRow.pct, 1.2);
eq('餐饮level over', foodRow.level, 'over');

/* ---------- 8. ifAddOver ---------- */
var info = B.ifAddOver(b1, spent, 'c_food', 200000); // 已有3万+加20万=23万，预算25万→92%
eq('加后23万', info.spentAfter, 230000);
eq('pct 92%', info.pctAfter, 0.92);
eq('warnLevel warn', info.warnLevel, 'warn');
eq('未超支overAmount 0', info.overAmount, 0);

var info2 = B.ifAddOver(b1, spent, 'c_food', 250000); // 3万+25万=28万，预算25万→112%
eq('超支3万', info2.overAmount, 30000);
eq('warnLevel over', info2.warnLevel, 'over');

/* ---------- 9. lastMonthExpenseByCat ---------- */
var last = B.lastMonthExpenseByCat(txs, '2026-10');
eq('上月(9月)餐饮9999', last.c_food, 9999);

/* ---------- 10. fillFromLastMonth ---------- */
var filled = B.fillFromLastMonth(B.expenseCategories(CATS), { c_food: 100000, c_transport: 50000 }, 0.9);
eq('餐饮=9万', filled.budgets.c_food, 90000);
eq('交通=4.5万', filled.budgets.c_transport, 45000);
eq('购物上月0→0', filled.budgets.c_shopping, 0);
eq('总13.5万', filled.totalBudget, 135000);

/* ---------- 11. distributeTotal ---------- */
var dist = B.distributeTotal(B.expenseCategories(CATS), { c_food: 60000, c_transport: 30000, c_shopping: 10000 }, 100000);
eq('餐饮6万', dist.budgets.c_food, 60000);
eq('交通3万', dist.budgets.c_transport, 30000);
eq('购物1万', dist.budgets.c_shopping, 10000);
eq('合计10万', dist.totalBudget, 100000);

/* 比例分配（上月各1万，总3千→各1千，尾差归最后） */
var dist2 = B.distributeTotal(B.expenseCategories(CATS), { c_food: 10000, c_transport: 10000, c_shopping: 10000 }, 3000);
check('合计正好3000', dist2.budgets.c_food + dist2.budgets.c_transport + dist2.budgets.c_shopping === 3000);

/* ---------- 12. consecutiveOverMonths ---------- */
var b2 = B.normalizeBudget({ budgets: { c_food: 100000 } }, CATS);
var txs3 = [
  { date: '2026-08-10', type: 'expense', amount: 150000, categoryId: 'c_food' },
  { date: '2026-09-10', type: 'expense', amount: 120000, categoryId: 'c_food' },
  { date: '2026-10-10', type: 'expense', amount: 80000, categoryId: 'c_food' }
];
// 8月15万>10万、9月12万>10万、10月8万<10万 → 从10月向前：10月不超支→0
eq('10月未超→0', B.consecutiveOverMonths(b2, txs3, 'c_food', ['2026-08', '2026-09', '2026-10']), 0);

var txs4 = [
  { date: '2026-08-10', type: 'expense', amount: 50000, categoryId: 'c_food' },
  { date: '2026-09-10', type: 'expense', amount: 120000, categoryId: 'c_food' },
  { date: '2026-10-10', type: 'expense', amount: 150000, categoryId: 'c_food' }
];
// 8月不超、9月超、10月超 → 连续2
eq('9/10连超→2', B.consecutiveOverMonths(b2, txs4, 'c_food', ['2026-08', '2026-09', '2026-10']), 2);

/* ---------- 13. optimizeSuggestion ---------- */
var foodCat = { id: 'c_food', name: '餐饮' };
var s1 = B.optimizeSuggestion(foodCat, txs4, '2026-10', 150000, 100000);
check('超支返回非空', s1 && s1.length > 0);
check('含超预算金额', s1.indexOf('超预算') >= 0);
check('未超支返回null', B.optimizeSuggestion(foodCat, [], '2026-10', 50000, 100000) === null);

/* 购物冲动消费场景 */
var shopCat = { id: 'c_shopping', name: '购物' };
var shopTx = [
  { date: '2026-10-01', type: 'expense', amount: 5000, categoryId: 'c_shopping' },
  { date: '2026-10-02', type: 'expense', amount: 8000, categoryId: 'c_shopping' },
  { date: '2026-10-03', type: 'expense', amount: 3000, categoryId: 'c_shopping' },
  { date: '2026-10-04', type: 'expense', amount: 100000, categoryId: 'c_shopping' }
];
var s2 = B.optimizeSuggestion(shopCat, shopTx, '2026-10', 116000, 50000);
check('购物建议含冷静期', s2.indexOf('冷静期') >= 0);

/* 通用兜底：与上月对比 */
var foodTxInc = [
  { date: '2026-10-01', type: 'expense', amount: 150000, categoryId: 'c_food' }
];
// 上月餐饮5万，本月15万 → 触发"比上月多花"
var s3 = B.optimizeSuggestion(foodCat, foodTxInc.concat([{ date: '2026-09-01', type: 'expense', amount: 50000, categoryId: 'c_food' }]), '2026-10', 150000, 100000);
check('比上月多花提示', s3.indexOf('比上月多花') >= 0);

/* ---------- 汇总 ---------- */
console.log('\n支出预算测试：' + passed + ' 项通过，' + failed + ' 项失败');
process.exit(failed ? 1 : 0);

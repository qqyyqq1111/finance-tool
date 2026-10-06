/**
 * test/trend.test.js — F8 月度收支趋势纯函数单测
 */
var assert = require('assert');
var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}
function eq(a, b, name) { ok(a === b, name + '（实际=' + JSON.stringify(a) + '）'); }

// localStorage stub
global.localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] || null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; },
  key: function (i) { return Object.keys(this._d)[i] || null; },
  get length() { return Object.keys(this._d).length; }
};
global.window = global;

require('../js/trend.js');
var T = global.fcTrend;

/* ---------- 1. lastNMonthKeys ---------- */
var keys = T.lastNMonthKeys('2026-10-06', 6);
eq(keys.length, 6, '返回6个月');
eq(keys[0], '2026-05', '最早月=2026-05');
eq(keys[5], '2026-10', '最近月=2026-10');

/* 跨年 */
var keys2 = T.lastNMonthKeys('2026-02-15', 3);
eq(keys2.join(','), '2025-12,2026-01,2026-02', '跨年正确');

/* ---------- 2. monthTotals ---------- */
var txs = [
  { date: '2026-10-01', type: 'income', amount: 100000 },
  { date: '2026-10-05', type: 'expense', amount: 30000 },
  { date: '2026-09-20', type: 'expense', amount: 50000 }, // 其他月
  { date: '2026-10-08', type: 'expense', amount: 20000 }
];
var m = T.monthTotals(txs, '2026-10');
eq(m.income, 100000, '10月收入10万');
eq(m.expense, 50000, '10月支出5万');
eq(m.balance, 50000, '10月结余5万');

/* ---------- 3. buildSeries ---------- */
var series = T.buildSeries(txs, ['2026-09', '2026-10']);
eq(series[0].expense, 50000, '9月支出5万');
eq(series[1].income, 100000, '10月收入10万');
eq(series[1].balance, 50000, '10月结余5万');

/* ---------- 4. nonZeroMonths ---------- */
eq(T.nonZeroMonths(series), 2, '2个有数据月份');
var empty = T.buildSeries([], ['2026-01', '2026-02']);
eq(T.nonZeroMonths(empty), 0, '空数据0个');

/* ---------- 5. trendSummary ---------- */
// 数据不足
eq(T.trendSummary(empty).level, 'empty', '无数据→empty');
eq(T.trendSummary(empty).text.indexOf('不足') >= 0, true, '数据不足文案');

// 结余持续增长 → good
var grow = [
  { monthKey: '2026-07', income: 100000, expense: 80000, balance: 20000 },
  { monthKey: '2026-08', income: 100000, expense: 70000, balance: 30000 },
  { monthKey: '2026-09', income: 100000, expense: 60000, balance: 40000 },
  { monthKey: '2026-10', income: 100000, expense: 50000, balance: 50000 }
];
eq(T.trendSummary(grow).level, 'good', '结余增长→good');
eq(T.trendSummary(grow).text.indexOf('增长') >= 0, true, '结余增长文案');

// 支出持续增长 → warn
var expUp = [
  { monthKey: '2026-07', income: 100000, expense: 30000, balance: 70000 },
  { monthKey: '2026-08', income: 100000, expense: 40000, balance: 60000 },
  { monthKey: '2026-09', income: 100000, expense: 50000, balance: 50000 },
  { monthKey: '2026-10', income: 100000, expense: 60000, balance: 40000 }
];
eq(T.trendSummary(expUp).level, 'warn', '支出增长→warn');
eq(T.trendSummary(expUp).text.indexOf('支出') >= 0, true, '支出增长文案');

// 平稳 → info
var flat = [
  { monthKey: '2026-07', income: 100000, expense: 50000, balance: 50000 },
  { monthKey: '2026-08', income: 100000, expense: 52000, balance: 48000 },
  { monthKey: '2026-09', income: 100000, expense: 49000, balance: 51000 },
  { monthKey: '2026-10', income: 100000, expense: 51000, balance: 49000 }
];
eq(T.trendSummary(flat).level, 'info', '平稳→info');

/* ---------- summary ---------- */
console.log('\n收支趋势测试：' + passed + ' 项通过，' + failed + ' 项失败');
process.exit(failed > 0 ? 1 : 0);

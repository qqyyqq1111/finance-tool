/* ============================================================
 * savings.test.js — F1 储蓄目标 纯函数单测（v1.2 批次③）
 * 运行：node test/savings.test.js
 * ============================================================ */
'use strict';

global.window = global;
require('../js/savings.js');
var V = fcSavings;

var passed = 0;
var failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}
function eq(name, actual, expected) {
  check(name + '（实际=' + JSON.stringify(actual) + '）', JSON.stringify(actual) === JSON.stringify(expected));
}

/* ---------- 1. 默认里程碑 ---------- */
var ms = V.defaultMilestones();
eq('里程碑数量5个', ms.length, 5);
eq('首里程碑10万（分）', ms[0].amount, 10000000);
eq('末里程碑100万（分）', ms[4].amount, 100000000);
check('里程碑reachedAt全空', ms.every(function (m) { return m.reachedAt === null; }));

/* ---------- 2. shiftYears ---------- */
eq('3年后同日', V.shiftYears('2026-10-04', 3), '2029-10-04');
eq('闰年2/29→平年2/28', V.shiftYears('2024-02-29', 1), '2025-02-28');
eq('减1年', V.shiftYears('2026-03-01', -1), '2025-03-01');

/* ---------- 3. createGoal ---------- */
var g = V.createGoal('2026-10-04', 5000000);
eq('默认目标100万分', g.targetAmount, 100000000);
eq('目标日期3年后', g.targetDate, '2029-10-04');
eq('起始金额', g.startAmount, 5000000);
eq('起始日期', g.startDate, '2026-10-04');
check('含5里程碑', g.milestones.length === 5);
var g2 = V.createGoal('2026-10-04', 0, 20000000);
eq('自定义目标金额', g2.targetAmount, 20000000);
var g3 = V.createGoal('2026-10-04');
eq('缺省起始为0', g3.startAmount, 0);

/* ---------- 4. monthsCeil ---------- */
eq('同日=0', V.monthsCeil('2026-10-04', '2026-10-04'), 0);
eq('16天后=1', V.monthsCeil('2026-10-04', '2026-10-20'), 1);
eq('差1天满月=1', V.monthsCeil('2026-10-04', '2026-11-03'), 1);
eq('整1月', V.monthsCeil('2026-10-04', '2026-11-04'), 1);
eq('1月零1天=2', V.monthsCeil('2026-10-04', '2026-11-05'), 2);
eq('3年', V.monthsCeil('2026-10-04', '2029-10-04'), 36);
eq('过期=0', V.monthsCeil('2026-10-04', '2025-01-01'), 0);

/* ---------- 5. humanRemain ---------- */
eq('不足1月', V.humanRemain('2026-10-04', '2026-10-20'), '不足1个月');
eq('已到期', V.humanRemain('2026-10-04', '2026-09-30'), '已到期');
eq('X个月', V.humanRemain('2026-10-04', '2027-02-04'), '4个月');
eq('X年', V.humanRemain('2026-10-04', '2028-10-04'), '2年');
eq('X年X月', V.humanRemain('2026-10-04', '2029-12-04'), '3年2个月');

/* ---------- 6. savedAmount ---------- */
eq('起始+净存', V.savedAmount({ startAmount: 100000 }, 50000), 150000);
eq('净值缺省', V.savedAmount({ startAmount: 100000 }), 100000);
eq('净支出可减少', V.savedAmount({ startAmount: 100000 }, -30000), 70000);

/* ---------- 7. progressPct ---------- */
var goal = { targetAmount: 100000000, startAmount: 0, targetDate: '2029-10-04' };
eq('0%', V.progressPct(goal, 0), 0);
eq('半程', V.progressPct(goal, 50000000), 0.5);
eq('100%', V.progressPct(goal, 100000000), 1);
eq('超额clamp到1', V.progressPct(goal, 150000000), 1);
eq('低于起始clamp到0', V.progressPct(goal, -100), 0);
var goalN = { targetAmount: 100, startAmount: 100 };
eq('目标≤起始且已达=1', V.progressPct(goalN, 100), 1);
eq('目标≤起始未达=0', V.progressPct(goalN, 50), 0);
var goalS = { targetAmount: 200000, startAmount: 100000 };
eq('非零起点半程', V.progressPct(goalS, 150000), 0.5);

/* ---------- 8. requiredMonthly ---------- */
eq('存够=0', V.requiredMonthly(goal, 100000000, '2026-10-04'), 0);
eq('36个月均分', V.requiredMonthly(goal, 0, '2026-10-04'), Math.ceil(100000000 / 36));
eq('零头向上取整', V.requiredMonthly({ targetAmount: 100001, startAmount: 0, targetDate: '2029-10-04' }, 0, '2026-10-04'), Math.ceil(100001 / 36));
eq('到期未够=全缺口', V.requiredMonthly({ targetAmount: 100000, startAmount: 0, targetDate: '2026-09-30' }, 50000, '2026-10-04'), 50000);

/* ---------- 9. avgMonthlySurplus ---------- */
eq('空数组=0', V.avgMonthlySurplus([]), 0);
eq('缺省=0', V.avgMonthlySurplus(), 0);
eq('单月', V.avgMonthlySurplus([300000]), 300000);
eq('三月平均', V.avgMonthlySurplus([100, 200, 300]), 200);
eq('取最近3个', V.avgMonthlySurplus([100, 200, 300, 900]), Math.round((200 + 300 + 900) / 3));
eq('含负值', V.avgMonthlySurplus([-100, 100, 300]), 100);

/* ---------- 10. assessPlan ---------- */
var a1 = V.assessPlan({ required: 100000, avg: 200000, monthsLeft: 36, totalRemain: 3600000 });
eq('月均足够=good', a1.level, 'good');
check('good含提前月数', typeof a1.earlyMonths === 'number');
// 3600000/200000=18个月 → 提前18
eq('提前月数正确', a1.earlyMonths, 18);
var a0 = V.assessPlan({ required: 0, avg: 100 });
eq('无需存=good', a0.level, 'good');
var a2 = V.assessPlan({ required: 100000, avg: 90000, monthsLeft: 36, totalRemain: 3600000 });
eq('差距10%=warn', a2.level, 'warn');
eq('warn差额', a2.extra, 10000);
var a3 = V.assessPlan({ required: 100000, avg: 50000, monthsLeft: 36, totalRemain: 3600000 });
eq('差距50%=behind', a3.level, 'behind');
var a4 = V.assessPlan({ required: 100000, avg: 80001, monthsLeft: 36, totalRemain: 3600000 });
eq('差距正好20%=warn', a4.level, 'warn');
var a5 = V.assessPlan({ required: 100000, avg: 79999, monthsLeft: 36, totalRemain: 3600000 });
eq('差距刚超20%=behind', a5.level, 'behind');

/* ---------- 11. checkMilestones ---------- */
var c1 = V.checkMilestones([{ amount: 10000000, reachedAt: null }], 15000000, 1234);
eq('达成→reachedAt写入', c1.list[0].reachedAt, 1234);
eq('newly含0', c1.newly, [0]);
var c2 = V.checkMilestones([{ amount: 10000000, reachedAt: 999 }], 15000000, 1234);
eq('已达成保留原时间', c2.list[0].reachedAt, 999);
eq('已达成不在newly', c2.newly, []);
var c3 = V.checkMilestones([{ amount: 10000000, reachedAt: null }], 50000, 1234);
check('未达成仍空', c3.list[0].reachedAt === null && c3.newly.length === 0);
var c4 = V.checkMilestones([
  { amount: 10000000, reachedAt: null },
  { amount: 30000000, reachedAt: null },
  { amount: 50000000, reachedAt: null }
], 40000000, 1234);
eq('跳达成：前两个newly', c4.newly, [0, 1]);
eq('第三个未达成', c4.list[2].reachedAt, null);
eq('空里程碑安全', V.checkMilestones(null, 100, 1).list.length, 0);

/* ---------- 12. balancesByMonths ---------- */
var txs = [
  { date: '2026-08-05', type: 'income', amount: 100000 },
  { date: '2026-08-10', type: 'expense', amount: 40000 },
  { date: '2026-09-01', type: 'income', amount: 200000 },
  { date: '2026-10-02', type: 'expense', amount: 10000 }
];
eq('按月净结余', V.balancesByMonths(txs, ['2026-08', '2026-09', '2026-10']), [60000, 200000, -10000]);
eq('无账月份=0', V.balancesByMonths(txs, ['2026-07']), [0]);

/* ---------- 13. netSince ---------- */
eq('起始日后净结余', V.netSince(txs, '2026-09-01'), 190000);
eq('很早日期=全部', V.netSince(txs, '2000-01-01'), 250000);
eq('很晚日期=0', V.netSince(txs, '2027-01-01'), 0);

/* ---------- 汇总 ---------- */
console.log('\n储蓄目标测试：' + passed + ' 项通过，' + failed + ' 项失败');
process.exit(failed ? 1 : 0);

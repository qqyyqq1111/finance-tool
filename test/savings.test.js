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

/* ---------- 12b. last3MonthKeys（0基月坑回归） ---------- */
eq('10月近3月', V.last3MonthKeys('2026-10-04'), ['2026-08', '2026-09', '2026-10']);
eq('年初跨年', V.last3MonthKeys('2026-01-15'), ['2025-11', '2025-12', '2026-01']);
eq('年末不越界', V.last3MonthKeys('2026-12-10'), ['2026-10', '2026-11', '2026-12']);
eq('3月取1/2/3', V.last3MonthKeys('2026-03-01'), ['2026-01', '2026-02', '2026-03']);

/* ---------- 13. netSince ---------- */
eq('起始日后净结余', V.netSince(txs, '2026-09-01'), 190000);
eq('很早日期=全部', V.netSince(txs, '2000-01-01'), 250000);
eq('很晚日期=0', V.netSince(txs, '2027-01-01'), 0);

/* ---------- 14. normalizeGoal（旧数据兼容） ---------- */
var legacy = {
  targetAmount: 100000000, targetDate: '2029-10-04',
  startAmount: 50000, startDate: '2026-10-04', milestones: []
};
var ng = V.normalizeGoal(legacy);
eq('旧数据补闲置阈值1万元', ng.idleThreshold, 1000000);
eq('旧数据默认目标型', ng.selectedPlan, 'target');
eq('旧数据idleDismissed=null', ng.idleDismissed, null);
eq('原字段保留', ng.targetAmount, 100000000);
var ng2 = V.normalizeGoal({
  targetAmount: 1, targetDate: '2027-01-01', startAmount: 0, startDate: '2026-01-01',
  selectedPlan: 'bad', idleThreshold: 500000
});
eq('非法方案回退target', ng2.selectedPlan, 'target');
eq('自定义阈值保留', ng2.idleThreshold, 500000);
eq('里程碑缺失补默认', V.normalizeGoal({
  targetAmount: 1, targetDate: 'x', startAmount: 0, startDate: 'x'
}).milestones.length, 5);

/* ---------- 15. shiftMonths ---------- */
eq('次月同日', V.shiftMonths('2026-10-04', 1), '2026-11-04');
eq('跨3月', V.shiftMonths('2026-10-04', 3), '2027-01-04');
eq('1月末+1月→2/28', V.shiftMonths('2026-01-31', 1), '2026-02-28');
eq('减1月', V.shiftMonths('2026-10-04', -1), '2026-09-04');
eq('3月末+1月→4/30', V.shiftMonths('2026-03-31', 1), '2026-04-30');

/* ---------- 16. incomeByMonths / avgMonthlyIncome ---------- */
var txsI = [
  { date: '2026-11-05', type: 'income', amount: 300000 },
  { date: '2026-11-20', type: 'income', amount: 100000 },
  { date: '2026-12-10', type: 'income', amount: 200000 }
];
eq('各月收入合计', V.incomeByMonths(txsI, ['2026-11', '2026-12']), [400000, 200000]);
eq('月均收入', V.avgMonthlyIncome([400000, 200000]), 300000);
eq('空窗口=0', V.avgMonthlyIncome([]), 0);

/* ---------- 17. planMonthly 三方案 ---------- */
eq('稳健型=结余×80%', V.planMonthly('stable', 5000000, 2638900), 4000000);
eq('目标型=按期所需', V.planMonthly('target', 5000000, 2638900), 2638900);
eq('激进型=结余100%', V.planMonthly('aggressive', 5000000, 2638900), 5000000);

/* ---------- 18. planEtaDate ---------- */
eq('月存5万19个月后', V.planEtaDate('2026-10-04', 5000000, 100000000, 5000000), '2028-05-04');
eq('月存0无法预计', V.planEtaDate('2026-10-04', 5000000, 100000000, 0), null);
eq('已存够=今天', V.planEtaDate('2026-10-04', 100000000, 100000000, 5000000), '2026-10-04');

/* ---------- 19. savingRate ---------- */
eq('储蓄率0.3', V.savingRate(300000, 1000000), 0.3);
eq('无收入=null', V.savingRate(300000, 0), null);
eq('超过1钳为1', V.savingRate(2000000, 1000000), 1);

/* ---------- 20. idleInfo / dismissIdle / includeIdle ---------- */
eq('超阈值显示', V.idleInfo({
  balance: 1100000, threshold: 1000000, dismissedMonth: null, today: '2026-10-04'
}), { show: true, idleAmount: 100000 });
eq('未超阈值不显示', V.idleInfo({
  balance: 500000, threshold: 1000000, dismissedMonth: null, today: '2026-10-04'
}), { show: false, idleAmount: 0 });
eq('本月已关闭不显示', V.idleInfo({
  balance: 1100000, threshold: 1000000, dismissedMonth: '2026-10', today: '2026-10-04'
}), { show: false, idleAmount: 100000 });
eq('上月关闭本月显示', V.idleInfo({
  balance: 1100000, threshold: 1000000, dismissedMonth: '2026-09', today: '2026-10-04'
}).show, true);
eq('dismissIdle结构', V.dismissIdle('2026-10'), { month: '2026-10', closes: 1 });
var baseG = {
  targetAmount: 100000000, targetDate: '2029-10-04', startAmount: 1000,
  startDate: '2026-10-04', milestones: [], idleThreshold: 1000000,
  selectedPlan: 'target', idleDismissed: null
};
var incG = V.includeIdle(baseG, 500000, '2026-10');
eq('纳入后起始金额增加', incG.startAmount, 501000);
eq('纳入后关闭本月提示', incG.idleDismissed.month, '2026-10');
check('纳入不改原goal', baseG.startAmount === 1000);

/* ---------- 21. healthLevel ---------- */
eq('35%优秀', V.healthLevel(0.35), 'excellent');
eq('30%优秀边界', V.healthLevel(0.3), 'excellent');
eq('25%良好', V.healthLevel(0.25), 'good');
eq('15%一般', V.healthLevel(0.15), 'normal');
eq('5%需改进', V.healthLevel(0.05), 'poor');
eq('null待评估', V.healthLevel(null), 'unknown');

/* ---------- 22. healthBreakdown ---------- */
var txsH = [
  { date: '2026-10-01', type: 'income', amount: 1000000, categoryId: 'cat_salary' },
  { date: '2026-10-02', type: 'expense', amount: 300000, categoryId: 'cat_food' },
  { date: '2026-09-15', type: 'expense', amount: 200000, categoryId: 'cat_food' },
  { date: '2026-08-10', type: 'expense', amount: 50000, categoryId: null }
];
var catsH = [
  { id: 'cat_salary', name: '工资' },
  { id: 'cat_food', name: '餐饮' }
];
var bd = V.healthBreakdown(txsH, ['2026-08', '2026-09', '2026-10'], catsH);
eq('活跃月=3', bd.activeMonths, 3);
eq('三月结余序列', bd.monthBalances, [-50000, -200000, 700000]);
eq('收入合计', bd.incomeTotal, 1000000);
eq('支出合计', bd.expenseTotal, 550000);
eq('收入构成首项工资', bd.incomeParts[0], { name: '工资', amount: 1000000 });
eq('支出Top3长度2', bd.top3.length, 2);
eq('Top1餐饮金额', bd.top3[0].amount, 500000);
eq('Top1名称', bd.top3[0].name, '餐饮');
check('Top1占比≈90.9%', Math.abs(bd.top3[0].pct - 0.9091) < 0.001);
eq('Top2其他(null分类)', bd.top3[1].name, '其他');
var bd2 = V.healthBreakdown(txsH, ['2026-05', '2026-06', '2026-07'], catsH);
eq('无账活跃月=0', bd2.activeMonths, 0);

/* ---------- 汇总 ---------- */
console.log('\n储蓄目标测试：' + passed + ' 项通过，' + failed + ' 项失败');
process.exit(failed ? 1 : 0);

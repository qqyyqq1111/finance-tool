/* ============================================================
 * savings.js — F1 储蓄目标看板（v1.2 批次③，docs/14 §3.1）
 * 口径红线：
 *  - 目标为家庭共同目标，存 settings.savingsGoal，随家庭设置云同步
 *  - 小金库（privacyLevel=vault）一律不计入共同储蓄
 *  - 本文件所有判定走纯函数；取数经 fcPrivacy，不做越权判断
 * ============================================================ */
(function (global) {
  'use strict';

  var V = {};

  /* ================= 常量 ================= */

  var TARGET_DEFAULT = 100000000; // 默认目标 100万元（单位：分）
  var DEFAULT_MILESTONE_YUAN = [100000, 300000, 500000, 800000, 1000000];
  var IDLE_THRESHOLD_DEFAULT = 1000000; // 闲置资金默认阈值 1万元（分）
  var PLANS = ['stable', 'target', 'aggressive'];
  var PLAN_META = {
    stable: { icon: '🟢', name: '稳健型', desc: '月均结余×80%，留弹性' },
    target: { icon: '🔵', name: '目标型', desc: '刚好按期达成（默认）' },
    aggressive: { icon: '🔴', name: '激进型', desc: '月均结余100%，全力攒' }
  };

  /* ================= 纯函数（单测覆盖） ================= */

  /** 默认里程碑：金额（分）+ reachedAt 空 */
  V.defaultMilestones = function () {
    return DEFAULT_MILESTONE_YUAN.map(function (yuan) {
      return { amount: yuan * 100, reachedAt: null };
    });
  };

  /** 在 YYYY-MM-DD 上加/减整年（手动拼串，避免时区漂移；2/29→平年2/28） */
  V.shiftYears = function (dateStr, years) {
    var p = dateStr.split('-').map(Number);
    var y = p[0] + years;
    var lastDay = new Date(y, p[1], 0).getDate(); // 目标年月的天数
    var d = Math.min(p[2], lastDay);
    return y + '-' + String(p[1]).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };

  /**
   * 新建目标（未持久化）
   * @param {String} today - YYYY-MM-DD
   * @param {Number} startAmountCents - 起始已存金额（分）
   * @param {Number} [targetCents]
   */
  V.createGoal = function (today, startAmountCents, targetCents) {
    return {
      targetAmount: targetCents || TARGET_DEFAULT,
      targetDate: V.shiftYears(today, 3),
      startAmount: startAmountCents || 0,
      startDate: today,
      milestones: V.defaultMilestones()
    };
  };

  /**
   * 两个日期间的整月数（向上取整；过期返回0）
   * 例：10-04→11-03 = 1；10-04→10-20 = 1；10-04→同日 = 0
   */
  V.monthsCeil = function (fromDate, toDate) {
    var f = fromDate.split('-').map(Number);
    var t = toDate.split('-').map(Number);
    var base = (t[0] - f[0]) * 12 + (t[1] - f[1]);
    if (t[2] > f[2]) base += 1;
    return base < 0 ? 0 : base;
  };

  /**
   * 剩余时间人类文案（独立于 monthsCeil 的保守口径，按真实月差）：
   * "已到期" / "不足1个月" / "X年X个月"
   */
  V.humanRemain = function (fromDate, toDate) {
    if (toDate < fromDate) return '已到期';
    var f = fromDate.split('-').map(Number);
    var t = toDate.split('-').map(Number);
    var m = (t[0] - f[0]) * 12 + (t[1] - f[1]);
    if (m === 0) return '不足1个月';
    var y = Math.floor(m / 12);
    var mm = m % 12;
    if (y && mm) return y + '年' + mm + '个月';
    if (y) return y + '年';
    return mm + '个月';
  };

  /** 当前已存：起始金额 + 起始日之后的共同净结余（UI 计算净值传入） */
  V.savedAmount = function (goal, netSinceStartCents) {
    return goal.startAmount + (netSinceStartCents || 0);
  };

  /** 进度百分比 0~1（目标≤起始视为已完成） */
  V.progressPct = function (goal, savedCents) {
    var span = goal.targetAmount - goal.startAmount;
    if (span <= 0) return savedCents >= goal.targetAmount ? 1 : 0;
    var p = (savedCents - goal.startAmount) / span;
    if (p < 0) return 0;
    if (p > 1) return 1;
    return p;
  };

  /** 每月需存（分）：剩余存款 / 剩余月数；已到期/已存够 → 0 */
  V.requiredMonthly = function (goal, savedCents, today) {
    var remain = goal.targetAmount - savedCents;
    if (remain <= 0) return 0;
    var months = V.monthsCeil(today, goal.targetDate);
    if (months === 0) return remain; // 已到期仍未存够：显示全部缺口
    return Math.ceil(remain / months);
  };

  /**
   * 月均结余：按时间正序的月结余数组取最近3个求平均（不足3个按实际数量）
   * @param {Number[]} balances - 各月净结余（分，可负），时间正序
   */
  V.avgMonthlySurplus = function (balances) {
    if (!balances || !balances.length) return 0;
    var last3 = balances.slice(-3);
    var sum = last3.reduce(function (a, b) { return a + b; }, 0);
    return Math.round(sum / last3.length);
  };

  /**
   * 攒钱测算（纯函数）
   * @param {Object} p - required 每月需存, avg 月均结余, monthsLeft 剩余月数
   * @returns {{level:'good'|'warn'|'behind', earlyMonths?:Number, extra?:Number, required:Number, avg:Number}}
   */
  V.assessPlan = function (p) {
    var required = p.required;
    var avg = p.avg;
    if (required <= 0) return { level: 'good', earlyMonths: 0, required: 0, avg: avg };
    if (avg >= required) {
      // 提前月数 ≈ 剩余月数 - 按当前结余存够所需月数
      var needMonths = Math.ceil(p.totalRemain / avg);
      var early = Math.max(0, p.monthsLeft - needMonths);
      return { level: 'good', earlyMonths: early, required: required, avg: avg };
    }
    var gap = required - avg;
    var gapPct = gap / required;
    return {
      level: gapPct <= 0.2 ? 'warn' : 'behind',
      extra: gap,
      required: required,
      avg: avg
    };
  };

  /**
   * 里程碑达成判定（纯函数）
   * @returns {{list:Array, newly:Array}} list=更新后的里程碑，newly=本次新达成的索引
   */
  V.checkMilestones = function (milestones, savedCents, nowTs) {
    var newly = [];
    var list = (milestones || []).map(function (ms, i) {
      if (!ms.reachedAt && savedCents >= ms.amount) {
        newly.push(i);
        return { amount: ms.amount, reachedAt: nowTs };
      }
      return { amount: ms.amount, reachedAt: ms.reachedAt || null };
    });
    return { list: list, newly: newly };
  };

  /**
   * 按月计算净结余（纯函数；调用方须先经 privacy 过滤并排除 vault）
   * @param {Array} visibleTx - 可见且非 vault 的交易
   * @param {String[]} monthKeys - 月份 'YYYY-MM'（时间正序）
   * @returns {Number[]} 与 monthKeys 对齐的月净结余（分）
   */
  V.balancesByMonths = function (visibleTx, monthKeys) {
    return monthKeys.map(function (mk) {
      var net = 0;
      visibleTx.forEach(function (t) {
        if (t.date.slice(0, 7) !== mk) return;
        net += t.type === 'income' ? t.amount : -t.amount;
      });
      return net;
    });
  };

  /** 起始日（含）之后净结余（纯函数；输入须已过滤 vault） */
  V.netSince = function (visibleTx, sinceDate) {
    var net = 0;
    visibleTx.forEach(function (t) {
      if (t.date < sinceDate) return;
      net += t.type === 'income' ? t.amount : -t.amount;
    });
    return net;
  };

  /* ---------- 旧数据兼容：补齐批次③增强字段 ---------- */
  V.normalizeGoal = function (goal) {
    if (!goal) return goal;
    var g = {
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate,
      startAmount: goal.startAmount,
      startDate: goal.startDate,
      milestones: goal.milestones || V.defaultMilestones()
    };
    g.idleThreshold = goal.idleThreshold != null ? goal.idleThreshold : IDLE_THRESHOLD_DEFAULT;
    g.selectedPlan = PLANS.indexOf(goal.selectedPlan) >= 0 ? goal.selectedPlan : 'target';
    g.idleDismissed = goal.idleDismissed || null; // {month:'YYYY-MM', closes:Number}
    return g;
  };

  /** 在 YYYY-MM-DD 上加/减整月（日号超过目标月天数→月末） */
  V.shiftMonths = function (dateStr, n) {
    var p = dateStr.split('-').map(Number);
    var total = (p[0] * 12 + (p[1] - 1)) + n;
    var y = Math.floor(total / 12);
    var m = total % 12;
    var lastDay = new Date(y, m + 1, 0).getDate();
    var d = Math.min(p[2], lastDay);
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };

  /** 各月收入合计（分；输入须已排除 vault） */
  V.incomeByMonths = function (visibleTx, monthKeys) {
    return monthKeys.map(function (mk) {
      var sum = 0;
      visibleTx.forEach(function (t) {
        if (t.date.slice(0, 7) === mk && t.type === 'income') sum += t.amount;
      });
      return sum;
    });
  };

  /** 月均收入：窗口内各月收入求平均（固定窗口口径，与 avgMonthlySurplus 对齐） */
  V.avgMonthlyIncome = function (incomes) {
    if (!incomes || !incomes.length) return 0;
    var sum = incomes.reduce(function (a, b) { return a + b; }, 0);
    return Math.round(sum / incomes.length);
  };

  /**
   * 三种攒钱方案的"每月存多少"（分）
   * stable=月均结余×80%；target=按期所需；aggressive=月均结余100%
   */
  V.planMonthly = function (plan, avg, required) {
    if (plan === 'stable') return Math.round(avg * 0.8);
    if (plan === 'aggressive') return avg;
    return required;
  };

  /**
   * 方案预计达成日期：从今天起按月存，ceil(剩余存款/月存) 个月后
   * 已存够→today；月存≤0→null（无法预计）
   */
  V.planEtaDate = function (today, savedCents, targetCents, monthlyCents) {
    var remain = targetCents - savedCents;
    if (remain <= 0) return today;
    if (!monthlyCents || monthlyCents <= 0) return null;
    var months = Math.ceil(remain / monthlyCents);
    return V.shiftMonths(today, months);
  };

  /** 储蓄率 0~1（月存/月均收入；收入≤0→null） */
  V.savingRate = function (monthlyCents, avgIncome) {
    if (!avgIncome || avgIncome <= 0) return null;
    var r = monthlyCents / avgIncome;
    if (r < 0) return 0;
    if (r > 1) return 1;
    return r;
  };

  /**
   * 闲置资金判定
   * @param {Object} p - balance 共同账户余额(分), threshold 阈值(分), dismissedMonth 本月已关闭, today
   * @returns {{show:Boolean, idleAmount:Number}} idleAmount=超出阈值部分（分）
   */
  V.idleInfo = function (p) {
    var idle = p.balance - p.threshold;
    var month = p.today.slice(0, 7);
    var show = idle > 0 && p.dismissedMonth !== month;
    return { show: show, idleAmount: idle > 0 ? idle : 0 };
  };

  /** 关闭闲置提示 → 记录本月（本月不再出现） */
  V.dismissIdle = function (month) {
    return { month: month, closes: 1 };
  };

  /**
   * 一键纳入：startAmount 增加 amount；并关闭本月闲置提示
   * @returns {Object} 新 goal（未持久化）
   */
  V.includeIdle = function (goal, amountCents, month) {
    var g = {};
    Object.keys(goal).forEach(function (k) { g[k] = goal[k]; });
    g.startAmount = goal.startAmount + amountCents;
    g.idleDismissed = { month: month, closes: 1 };
    return g;
  };

  /**
   * 储蓄健康度等级（按储蓄率）
   * rate=null→'unknown'（数据不足/无收入）
   */
  V.healthLevel = function (rate) {
    if (rate == null) return 'unknown';
    if (rate >= 0.3) return 'excellent';
    if (rate >= 0.2) return 'good';
    if (rate >= 0.1) return 'normal';
    return 'poor';
  };

  /**
   * 健康度详细拆解（纯函数；categories 用于 id→名称）
   * @returns {{activeMonths:Number, monthBalances:Number[], incomeTotal, expenseTotal,
   *           incomeParts:{name,amount}[], top3:{name,amount,pct}[]}}
   */
  V.healthBreakdown = function (visibleTx, monthKeys, categories) {
    var catMap = {};
    (categories || []).forEach(function (c) { catMap[c.id] = c.name; });
    var catName = function (id) { return id ? (catMap[id] || '未分类') : '其他'; };

    var monthBalances = V.balancesByMonths(visibleTx, monthKeys);
    var activeMonths = monthKeys.filter(function (mk) {
      return visibleTx.some(function (t) { return t.date.slice(0, 7) === mk; });
    }).length;

    var incomeByCat = {};
    var expenseByCat = {};
    var incomeTotal = 0;
    var expenseTotal = 0;
    visibleTx.forEach(function (t) {
      var key = t.categoryId || '__none';
      if (t.type === 'income') {
        incomeByCat[key] = (incomeByCat[key] || 0) + t.amount;
        incomeTotal += t.amount;
      } else {
        expenseByCat[key] = (expenseByCat[key] || 0) + t.amount;
        expenseTotal += t.amount;
      }
    });

    var toParts = function (map) {
      return Object.keys(map).map(function (k) {
        return { name: k === '__none' ? '其他' : catName(k), amount: map[k] };
      }).sort(function (a, b) { return b.amount - a.amount; });
    };

    var top3 = toParts(expenseByCat).slice(0, 3).map(function (p) {
      return { name: p.name, amount: p.amount, pct: expenseTotal ? p.amount / expenseTotal : 0 };
    });

    return {
      activeMonths: activeMonths,
      monthBalances: monthBalances,
      incomeTotal: incomeTotal,
      expenseTotal: expenseTotal,
      incomeParts: toParts(incomeByCat),
      top3: top3
    };
  };

  /* ================= UI ================= */

  function $(id) { return document.getElementById(id); }

  function fmtYuan(cents) {
    return (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtInt(cents) {
    return Math.round(Math.abs(cents) / 100).toLocaleString('zh-CN');
  }

  /** 当前视角可见、且排除小金库的交易（隐私红线：只经 fcPrivacy 取数） */
  function visibleNonVault() {
    var viewer = fcDb.getCurrentViewer();
    var all = fcDb.tx.list();
    var out = [];
    // 逐月喂给 privacy（monthView 是现有隐私口径），覆盖全部账涉及的月份+当前月
    var months = {};
    var thisMonth = new Date().toISOString().slice(0, 7);
    months[thisMonth] = 1;
    all.forEach(function (t) { months[t.date.slice(0, 7)] = 1; });
    Object.keys(months).forEach(function (mk) {
      var mv = fcPrivacy.monthView(all, viewer, mk);
      mv.visible.forEach(function (t) {
        if (t.privacy !== 'vault') out.push(t);
      });
    });
    return out;
  }

  /** 近3个月 monthKeys（含当月，时间正序）
   * 注意 Date 月份 0 基：当月 0 基 = p[1]-1，再往前推2 → p[1]-3 */
  V.last3MonthKeys = function (today) {
    var p = today.slice(0, 7).split('-').map(Number);
    var keys = [];
    var d = new Date(p[0], p[1] - 3, 1);
    for (var i = 0; i < 3; i++) {
      keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      d.setMonth(d.getMonth() + 1);
    }
    return keys;
  };

  /** 看板渲染 */
  V.render = function () {
    var wrap = $('savings-card');
    if (!wrap) return;
    var goal = V.normalizeGoal(fcDb.getSavingsGoal());
    if (!goal) {
      wrap.innerHTML =
        '<div class="bg-white rounded-2xl border border-slate-200 border-dashed p-5 text-center">' +
        '<p class="text-2xl mb-1">🎯</p>' +
        '<p class="font-medium text-slate-700 text-sm">设定家庭储蓄目标</p>' +
        '<p class="text-xs text-slate-400 mt-1 mb-3 leading-relaxed">比如"3年内存下20万"，看板会追踪进度、<br>测算每月该存多少</p>' +
        '<button onclick="fcSavings.openGoalSheet()" class="bg-indigo-600 text-white text-sm font-medium rounded-xl px-5 py-2.5 min-h-[44px] active:opacity-80">设置储蓄目标</button>' +
        '</div>';
      return;
    }

    var today = new Date().toISOString().slice(0, 10);
    var txs = visibleNonVault();
    var netStart = V.netSince(txs, goal.startDate);
    var saved = V.savedAmount(goal, netStart);

    // 里程碑：先判定 → 持久化新达成（本次渲染给庆祝块）
    var anyReachedBefore = (goal.milestones || []).some(function (m) { return !!m.reachedAt; });
    var chk = V.checkMilestones(goal.milestones, saved, Date.now());
    var celebrate = '';
    if (chk.newly.length) {
      goal.milestones = chk.list;
      fcDb.saveSavingsGoal(goal);
      var idx = chk.newly[chk.newly.length - 1];
      var wan = chk.list[idx].amount / 1000000; // 分→万元（1万元=1,000,000分）
      var amountLabel = wan % 1 === 0
        ? wan + '万'
        : fmtInt(chk.list[idx].amount);
      celebrate =
        '<div class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-center gap-2 text-sm text-amber-700">' +
        '<span class="text-lg animate-bounce inline-block">🎉</span>' +
        '<span>恭喜达成 <b>' + amountLabel + '</b> 里程碑！</span>' +
        '</div>';
    }
    // 首次达成（此前无任何里程碑记录）→ 全屏庆祝
    var full = $('ms-full-celebrate');
    if (full) {
      if (chk.newly.length && !anyReachedBefore) {
        $('msfc-amount').textContent = '¥' + fmtInt(chk.list[chk.newly[chk.newly.length - 1]].amount);
        full.classList.remove('hidden');
      } else {
        full.classList.add('hidden');
      }
    }

    var pct = V.progressPct(goal, saved);
    var monthsLeft = V.monthsCeil(today, goal.targetDate);
    var required = V.requiredMonthly(goal, saved, today);

    // 近3月窗口：结余 / 收入 / 活跃月
    var keys3 = V.last3MonthKeys(today);
    var balances = V.balancesByMonths(txs, keys3);
    var incomes = V.incomeByMonths(txs, keys3);
    var activeMonths = keys3.filter(function (mk) {
      return txs.some(function (t) { return t.date.slice(0, 7) === mk; });
    }).length;
    var avg = V.avgMonthlySurplus(balances);
    var avgIncome = V.avgMonthlyIncome(incomes);

    var assess = V.assessPlan({
      required: required,
      avg: avg,
      monthsLeft: monthsLeft,
      totalRemain: Math.max(0, goal.targetAmount - saved)
    });

    /* ---------- 三种攒钱方案 ---------- */
    var planVal = V.planMonthly(goal.selectedPlan, avg, required);
    var eta = V.planEtaDate(today, saved, goal.targetAmount, planVal);
    var srate = V.savingRate(planVal, avgIncome);
    var planBtns = PLANS.map(function (p) {
      var on = p === goal.selectedPlan;
      return '<button onclick="fcSavings.selectPlan(\'' + p + '\')" class="rounded-xl border px-1 py-2 text-center min-h-[44px] transition ' +
        (on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 active:bg-slate-50') + '">' +
        '<span class="block text-sm leading-tight">' + PLAN_META[p].icon + ' ' + PLAN_META[p].name + '</span>' +
        '<span class="block text-[9px] mt-0.5 leading-tight">' + PLAN_META[p].desc + '</span></button>';
    }).join('');
    var planDetail =
      '<p class="text-slate-500">每月存 <b class="text-indigo-600 text-sm">¥' + fmtInt(planVal) + '</b></p>' +
      '<p class="text-slate-500">预计 ' + (eta ? '<b class="text-slate-700">' + eta + '</b>' : '<span class="text-rose-500">按当前节奏无法预计</span>') + ' 达成</p>' +
      '<p class="text-slate-500">储蓄率 ' + (srate != null ? '<b class="text-slate-700">' + (srate * 100).toFixed(0) + '%</b>' : '<span class="text-slate-400">—</span>') + '</p>';

    /* ---------- 储蓄健康度 ---------- */
    var rate = activeMonths < 3 ? null : (avgIncome > 0 ? avg / avgIncome : null);
    var hlevel = V.healthLevel(rate);
    // F1↔F4 联动：检查是否有分类连续2个月超支（docs/14 §4.1.6）
    var overCatNote = '';
    if (global.fcBudget) {
      var bgt = fcBudget.normalizeBudget(fcDb.getBudget(), fcDb.categoriesList());
      var catsAll = fcDb.categoriesList();
      var catNameMap = {};
      catsAll.forEach(function (c) { catNameMap[c.id] = c.name; });
      var overKeys = [];
      fcBudget.expenseCategories(catsAll).forEach(function (c) {
        if ((bgt.budgets[c.id] || 0) > 0 &&
          fcBudget.consecutiveOverMonths(bgt, txs, c.id, V.last3MonthKeys(today)) >= 2) {
          overKeys.push(c.name);
        }
      });
      if (overKeys.length) {
        overCatNote = '<p class="text-[10px] text-rose-600 mt-1">最近' + overKeys.join('、') + '连续超支，注意控制</p>';
      }
    }
    var hCfg = {
      excellent: ['bg-emerald-50', 'border-emerald-200', 'text-emerald-700', '💪 优秀', '攒钱能力很强，继续保持'],
      good: ['bg-sky-50', 'border-sky-200', 'text-sky-700', '🙂 良好', '处于健康区间'],
      normal: ['bg-orange-50', 'border-orange-200', 'text-orange-700', '😐 一般', '还有提升空间，试试减少非必要支出'],
      poor: ['bg-rose-50', 'border-rose-200', 'text-rose-700', '⚠️ 需改进', '偏低，建议设定月度储蓄目标'],
      unknown: ['bg-slate-50', 'border-slate-200', 'text-slate-500', '📊 待评估', '记账数据不足，继续记账后可评估']
    }[hlevel];
    var healthCard =
      '<button onclick="fcSavings.openHealthSheet()" class="w-full mt-2 rounded-xl border px-3 py-2.5 flex items-center justify-between text-xs min-h-[44px] ' +
      hCfg[0] + ' ' + hCfg[1] + ' ' + hCfg[2] + '">' +
      '<span class="font-medium">' + hCfg[3] + (rate != null ? ' · 储蓄率 ' + (rate * 100).toFixed(0) + '%' : '') + '</span>' +
      '<span class="opacity-80 text-[10px]">' + hCfg[4] + ' ›</span></button>' + overCatNote;

    /* ---------- 闲置资金 ---------- */
    var balanceAll = V.netSince(txs, '0000');
    var idle = V.idleInfo({
      balance: balanceAll,
      threshold: goal.idleThreshold,
      dismissedMonth: goal.idleDismissed ? goal.idleDismissed.month : null,
      today: today
    });
    var idleBar = idle.show
      ? '<div class="mt-2 bg-amber-50 border border-amber-200 rounded-2xl px-3.5 py-3 flex items-center gap-2.5">' +
        '<span class="text-xl shrink-0">💵</span>' +
        '<p class="flex-1 text-xs text-amber-800 leading-snug">共同账户有 <b>¥' + fmtInt(idle.idleAmount) +
        '</b> 闲置资金，纳入储蓄计划可加速进度</p>' +
        '<button onclick="fcSavings.openIdleSheet()" class="shrink-0 bg-amber-500 text-white text-xs font-medium rounded-xl px-3 py-2 min-h-[44px] active:opacity-80">一键纳入</button>' +
        '<button onclick="fcSavings.dismissIdleTip()" class="shrink-0 w-9 h-9 text-amber-400 text-base active:opacity-60" aria-label="关闭">×</button>' +
        '</div>'
      : '';

    // 进度环
    var R = 52;
    var C = 2 * Math.PI * R;
    var offset = C * (1 - pct);

    // 按期测算文案
    var tip = '';
    if (assess.level === 'good') {
      tip = required <= 0
        ? '<span>目标已经达成，太棒了！🎉</span>'
        : '<span>按当前节奏，预计可提前 <b>' + assess.earlyMonths + '</b> 个月达成目标 🎉</span>';
    } else if (assess.level === 'warn') {
      tip = '<span>按当前节奏还差一点，每月多存 <b>¥' + fmtInt(assess.extra) + '</b> 即可按期达成</span>';
    } else {
      tip = '<span>按当前节奏可能无法按期达成，建议每月存 <b>¥' + fmtInt(required) +
        '</b>（当前月均结余 ¥' + fmtInt(avg) + '）</span>';
    }
    var tipCls = assess.level === 'good' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : assess.level === 'warn' ? 'bg-orange-50 text-orange-700 border-orange-200'
        : 'bg-rose-50 text-rose-700 border-rose-200';

    wrap.innerHTML =
      '<div class="bg-white rounded-2xl border border-slate-200 p-4">' +
      '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="font-semibold text-slate-800 text-sm">🎯 储蓄目标</h3>' +
      '<button onclick="fcSavings.openGoalSheet()" class="text-xs text-indigo-600 min-w-[44px] min-h-[44px] flex items-center justify-end">编辑目标</button>' +
      '</div>' +
      '<div class="flex items-center gap-4">' +
      '<div class="relative w-32 h-32 shrink-0">' +
      '<svg viewBox="0 0 120 120" class="w-32 h-32 -rotate-90">' +
      '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="#e2e8f0" stroke-width="10"/>' +
      '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="#6366f1" stroke-width="10" stroke-linecap="round"' +
      ' stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"/>' +
      '</svg>' +
      '<div class="absolute inset-0 flex flex-col items-center justify-center">' +
      '<span class="text-lg font-bold text-slate-800">' + (pct * 100).toFixed(1) + '%</span>' +
      '</div></div>' +
      '<div class="flex-1 min-w-0 space-y-1.5 text-xs">' +
      '<p class="text-slate-400">已存 <span class="text-slate-800 font-semibold text-sm">¥' + fmtYuan(saved) + '</span></p>' +
      '<p class="text-slate-400">目标 <span class="text-slate-700 font-medium">¥' + fmtYuan(goal.targetAmount) + '</span></p>' +
      '<p class="text-slate-400">剩余 <span class="text-slate-700">' + V.humanRemain(today, goal.targetDate) + '</span></p>' +
      '<p class="text-slate-400">每月需存 <span class="text-indigo-600 font-semibold">¥' + fmtInt(required) + '</span></p>' +
      '</div></div>' +
      '<div class="mt-3">' +
      '<div class="grid grid-cols-3 gap-2">' + planBtns + '</div>' +
      '<div class="mt-2 grid grid-cols-3 gap-1 text-[10px] text-center">' + planDetail + '</div>' +
      '</div>' +
      '<div class="mt-3 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ' + tipCls + '">' + tip + '</div>' +
      healthCard +
      celebrate +
      '<p class="text-[10px] text-slate-400 mt-2.5">口径：家庭共同储蓄，不含双方小金库；月均取近3个月（数据不足按实际月份）</p>' +
      '</div>' +
      idleBar;
  };

  /* ---------------- 编辑目标弹层 ---------------- */

  var editingGoal = null;

  V.openGoalSheet = function () {
    var today = new Date().toISOString().slice(0, 10);
    var goal = V.normalizeGoal(fcDb.getSavingsGoal());
    if (!goal) {
      // 首次：起始金额默认=当前家庭共同结余（当前可见口径，不含小金库）
      var netNow = V.netSince(visibleNonVault(), '0000');
      goal = V.normalizeGoal(V.createGoal(today, Math.max(0, netNow)));
    }
    editingGoal = goal;
    $('sg-amount').value = (goal.targetAmount / 100).toString();
    $('sg-date').value = goal.targetDate;
    $('sg-start').value = (goal.startAmount / 100).toString();
    $('sg-startdate').value = goal.startDate;
    $('sg-idle').value = (goal.idleThreshold / 100).toString();
    $('sg-err').textContent = '';
    renderMilestoneEditor(goal.milestones);
    $('goal-sheet').classList.remove('hidden');
  };

  V.closeGoalSheet = function () {
    $('goal-sheet').classList.add('hidden');
    editingGoal = null;
  };

  function renderMilestoneEditor(milestones) {
    var box = $('sg-milestones');
    box.innerHTML = '';
    milestones.slice().sort(function (a, b) { return a.amount - b.amount; }).forEach(function (ms) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      row.innerHTML =
        '<span class="flex-1 text-xs text-slate-700 bg-slate-50 rounded-lg px-3 py-2.5 min-h-[44px] flex items-center">' +
        '¥' + fmtInt(ms.amount) + (ms.reachedAt ? ' <span class="ml-2 text-[10px] text-emerald-600">✅ ' + new Date(ms.reachedAt).toISOString().slice(0, 10) + '</span>' : '') + '</span>' +
        '<button class="w-11 h-11 text-slate-400 text-sm shrink-0" data-del="' + ms.amount + '">删除</button>';
      box.appendChild(row);
    });
    Array.from(box.querySelectorAll('[data-del]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var amt = Number(btn.getAttribute('data-del'));
        editingGoal.milestones = editingGoal.milestones.filter(function (m) { return m.amount !== amt; });
        renderMilestoneEditor(editingGoal.milestones);
      });
    });
  }

  V.addMilestoneRow = function () {
    var input = $('sg-new-ms');
    var yuan = Number(input.value);
    if (!yuan || yuan <= 0) { global.toast('请输入大于0的里程碑金额'); return; }
    var amount = Math.round(yuan * 100);
    if (editingGoal.milestones.some(function (m) { return m.amount === amount; })) {
      global.toast('该里程碑已存在'); return;
    }
    // 沿用旧达成记录（极端情况下手改重复金额时）
    editingGoal.milestones.push({ amount: amount, reachedAt: null });
    input.value = '';
    renderMilestoneEditor(editingGoal.milestones);
  };

  V.saveGoal = function () {
    var err = $('sg-err');
    var amountYuan = Number($('sg-amount').value);
    var startYuan = Number($('sg-start').value);
    var idleYuan = Number($('sg-idle').value);
    var date = $('sg-date').value;
    var startDate = $('sg-startdate').value;
    if (!amountYuan || amountYuan <= 0) { err.textContent = '请输入有效的目标金额'; return; }
    if (startYuan < 0) { err.textContent = '起始金额不能为负'; return; }
    if (idleYuan < 0) { err.textContent = '闲置阈值不能为负'; return; }
    if (!date) { err.textContent = '请选择目标日期'; return; }
    if (!startDate) { err.textContent = '请选择起始日期'; return; }
    var goal = {
      targetAmount: Math.round(amountYuan * 100),
      targetDate: date,
      startAmount: Math.round(startYuan * 100),
      startDate: startDate,
      milestones: editingGoal.milestones,
      idleThreshold: Math.round((idleYuan || 0) * 100),
      selectedPlan: editingGoal.selectedPlan,
      idleDismissed: editingGoal.idleDismissed
    };
    var r = fcDb.saveSavingsGoal(goal);
    if (!r.ok) { err.textContent = r.errors[0]; return; }
    V.closeGoalSheet();
    global.toast('储蓄目标已保存', 'success');
    global.renderAll();
  };

  /* ---------------- 方案切换 ---------------- */

  V.selectPlan = function (plan) {
    var g = V.normalizeGoal(fcDb.getSavingsGoal());
    if (!g || PLANS.indexOf(plan) < 0) return;
    g.selectedPlan = plan;
    fcDb.saveSavingsGoal(g);
    V.render();
  };

  /* ---------------- 闲置资金：一键纳入 ---------------- */

  function currentIdle() {
    var g = V.normalizeGoal(fcDb.getSavingsGoal());
    var today = new Date().toISOString().slice(0, 10);
    var balance = V.netSince(visibleNonVault(), '0000');
    var idle = V.idleInfo({
      balance: balance,
      threshold: g.idleThreshold,
      dismissedMonth: g.idleDismissed ? g.idleDismissed.month : null,
      today: today
    });
    return { g: g, today: today, idle: idle };
  }

  V.openIdleSheet = function () {
    var c = currentIdle();
    if (!c.idle.idleAmount) return;
    $('il-amount').value = (c.idle.idleAmount / 100).toString();
    $('il-err').textContent = '';
    $('idle-sheet').classList.remove('hidden');
  };

  V.closeIdleSheet = function () { $('idle-sheet').classList.add('hidden'); };

  V.confirmInclude = function () {
    var err = $('il-err');
    var yuan = Number($('il-amount').value);
    if (!yuan || yuan <= 0) { err.textContent = '请输入大于0的金额'; return; }
    var amount = Math.round(yuan * 100);
    var c = currentIdle();
    if (amount > c.idle.idleAmount) {
      err.textContent = '不能超过闲置资金 ¥' + fmtInt(c.idle.idleAmount);
      return;
    }
    var ng = V.includeIdle(c.g, amount, c.today.slice(0, 7));
    var r = fcDb.saveSavingsGoal(ng);
    if (!r.ok) { err.textContent = r.errors[0]; return; }
    V.closeIdleSheet();
    global.toast('已纳入 ¥' + fmtInt(amount) + '，继续加油', 'success');
    global.renderAll();
  };

  V.dismissIdleTip = function () {
    var g = V.normalizeGoal(fcDb.getSavingsGoal());
    var month = new Date().toISOString().slice(0, 7);
    g.idleDismissed = V.dismissIdle(month);
    fcDb.saveSavingsGoal(g);
    V.render();
  };

  /* ---------------- 健康度拆解弹层 ---------------- */

  V.openHealthSheet = function () {
    var today = new Date().toISOString().slice(0, 10);
    var keys3 = V.last3MonthKeys(today);
    var bd = V.healthBreakdown(visibleNonVault(), keys3, fcDb.categoriesList());

    function barRows(parts, total, color) {
      if (!parts.length) return '<p class="text-xs text-slate-400 py-2">暂无数据</p>';
      return parts.map(function (p) {
        var pctW = total ? Math.round(p.amount / total * 100) : 0;
        return '<div class="mb-2">' +
          '<div class="flex justify-between text-xs text-slate-600 mb-1"><span>' + p.name + '</span>' +
          '<span class="text-slate-400">¥' + fmtInt(p.amount) + ' · ' + pctW + '%</span></div>' +
          '<div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full ' + color +
          '" style="width:' + pctW + '%"></div></div></div>';
      }).join('');
    }

    var maxAbs = Math.max.apply(null, bd.monthBalances.map(Math.abs).concat([1]));
    var trend = bd.monthBalances.map(function (b, i) {
      var h = Math.round(Math.abs(b) / maxAbs * 40) + 2;
      var col = b >= 0 ? 'bg-emerald-400' : 'bg-rose-400';
      return '<div class="flex-1 flex flex-col items-center justify-end gap-1">' +
        '<span class="text-[9px] text-slate-500">' + (b >= 0 ? '' : '-') + Math.round(Math.abs(b) / 100) + '</span>' +
        '<div class="' + col + ' rounded-t w-7" style="height:' + h + 'px"></div>' +
        '<span class="text-[9px] text-slate-400">' + keys3[i].slice(5) + '月</span></div>';
    }).join('');

    $('health-sheet-body').innerHTML =
      '<p class="text-[11px] text-slate-400 mb-3">近3个月口径：已记账 ' + bd.activeMonths + ' 个月' +
      '（不足3个月时等级为"待评估"）</p>' +
      '<h4 class="text-xs font-semibold text-slate-700 mb-2">💰 收入构成</h4>' +
      barRows(bd.incomeParts, bd.incomeTotal, 'bg-emerald-400') +
      '<h4 class="text-xs font-semibold text-slate-700 mb-2 mt-4">💸 支出 Top3</h4>' +
      barRows(bd.top3, bd.expenseTotal, 'bg-rose-400') +
      '<h4 class="text-xs font-semibold text-slate-700 mb-2 mt-4">📈 近3个月结余（元）</h4>' +
      '<div class="flex items-end gap-2 h-20 border-b border-slate-100">' + trend + '</div>' +
      '<p class="text-[10px] text-slate-400 mt-3">口径不含双方小金库；金额单位元</p>';

    $('health-sheet').classList.remove('hidden');
  };

  V.closeHealthSheet = function () { $('health-sheet').classList.add('hidden'); };

  /* ---------------- 全屏庆祝关闭 ---------------- */

  V.closeFullCelebrate = function () {
    var el = $('ms-full-celebrate');
    if (el) el.classList.add('hidden');
  };

  /* ---------------- 装配 ---------------- */

  V.bind = function () {
    $('goal-sheet-mask').addEventListener('click', V.closeGoalSheet);
    $('sg-cancel').addEventListener('click', V.closeGoalSheet);
    $('sg-save').addEventListener('click', V.saveGoal);
    $('sg-add-ms').addEventListener('click', V.addMilestoneRow);
    $('idle-sheet-mask').addEventListener('click', V.closeIdleSheet);
    $('il-cancel').addEventListener('click', V.closeIdleSheet);
    $('il-confirm').addEventListener('click', V.confirmInclude);
    $('health-sheet-mask').addEventListener('click', V.closeHealthSheet);
    $('hs-close').addEventListener('click', V.closeHealthSheet);
    $('msfc-close').addEventListener('click', V.closeFullCelebrate);
  };

  global.fcSavings = V;
})(window);

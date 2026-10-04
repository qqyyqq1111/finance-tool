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
        if (t.privacyLevel !== 'vault') out.push(t);
      });
    });
    return out;
  }

  /** 近3个月 monthKeys（含当月，时间正序） */
  function last3MonthKeys(today) {
    var p = today.slice(0, 7).split('-').map(Number);
    var keys = [];
    var d = new Date(p[0], p[1] - 2, 1);
    for (var i = 0; i < 3; i++) {
      keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      d.setMonth(d.getMonth() + 1);
    }
    return keys;
  }

  /** 看板渲染 */
  V.render = function () {
    var wrap = $('savings-card');
    if (!wrap) return;
    var goal = fcDb.getSavingsGoal();
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
    var chk = V.checkMilestones(goal.milestones, saved, Date.now());
    var celebrate = '';
    if (chk.newly.length) {
      goal.milestones = chk.list;
      fcDb.saveSavingsGoal(goal);
      var idx = chk.newly[chk.newly.length - 1];
      var amountLabel = (chk.list[idx].amount / 10000) % 1 === 0
        ? (chk.list[idx].amount / 10000) + '万'
        : fmtInt(chk.list[idx].amount);
      celebrate =
        '<div class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-center gap-2 text-sm text-amber-700">' +
        '<span class="text-lg animate-bounce inline-block">🎉</span>' +
        '<span>恭喜达成第一个 <b>' + amountLabel + '</b>！</span>' +
        '</div>';
    }

    var pct = V.progressPct(goal, saved);
    var monthsLeft = V.monthsCeil(today, goal.targetDate);
    var required = V.requiredMonthly(goal, saved, today);
    var balances = V.balancesByMonths(txs, last3MonthKeys(today));
    var avg = V.avgMonthlySurplus(balances);
    var assess = V.assessPlan({
      required: required,
      avg: avg,
      monthsLeft: monthsLeft,
      totalRemain: Math.max(0, goal.targetAmount - saved)
    });

    // 进度环
    var R = 52;
    var C = 2 * Math.PI * R;
    var offset = C * (1 - pct);

    // 测算文案
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
      '<div class="mt-3 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ' + tipCls + '">' + tip + '</div>' +
      celebrate +
      '<p class="text-[10px] text-slate-400 mt-2.5">口径：家庭共同储蓄，不含双方小金库；月均结余取近3个月（数据不足按实际月份）</p>' +
      '</div>';
  };

  /* ---------------- 编辑目标弹层 ---------------- */

  var editingGoal = null;

  V.openGoalSheet = function () {
    var today = new Date().toISOString().slice(0, 10);
    var goal = fcDb.getSavingsGoal();
    if (!goal) {
      // 首次：起始金额默认=当前家庭共同结余（当前可见口径，不含小金库）
      var netNow = V.netSince(visibleNonVault(), '0000');
      goal = V.createGoal(today, Math.max(0, netNow));
    }
    editingGoal = goal;
    $('sg-amount').value = (goal.targetAmount / 100).toString();
    $('sg-date').value = goal.targetDate;
    $('sg-start').value = (goal.startAmount / 100).toString();
    $('sg-startdate').value = goal.startDate;
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
    var date = $('sg-date').value;
    var startDate = $('sg-startdate').value;
    if (!amountYuan || amountYuan <= 0) { err.textContent = '请输入有效的目标金额'; return; }
    if (startYuan < 0) { err.textContent = '起始金额不能为负'; return; }
    if (!date) { err.textContent = '请选择目标日期'; return; }
    if (!startDate) { err.textContent = '请选择起始日期'; return; }
    var goal = {
      targetAmount: Math.round(amountYuan * 100),
      targetDate: date,
      startAmount: Math.round(startYuan * 100),
      startDate: startDate,
      milestones: editingGoal.milestones
    };
    var r = fcDb.saveSavingsGoal(goal);
    if (!r.ok) { err.textContent = r.errors[0]; return; }
    V.closeGoalSheet();
    global.toast('储蓄目标已保存', 'success');
    global.renderAll();
  };

  /* ---------------- 装配 ---------------- */

  V.bind = function () {
    $('goal-sheet-mask').addEventListener('click', V.closeGoalSheet);
    $('sg-cancel').addEventListener('click', V.closeGoalSheet);
    $('sg-save').addEventListener('click', V.saveGoal);
    $('sg-add-ms').addEventListener('click', V.addMilestoneRow);
  };

  global.fcSavings = V;
})(window);

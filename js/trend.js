/**
 * js/trend.js — v1.2 批次⑤ F8 月度收支趋势
 * 纯函数 + SVG 手绘折线图（零依赖）
 * 取数口径：经 fcPrivacy 过滤，小金库不计入；私密账金额计入（真实花了，趋势只看金额不看明细）
 */
(function (global) {
  var T = {};
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 纯函数 ---------------- */

  /**
   * 生成最近 n 个月的 YYYY-MM 数组（含 endDate 所在月），最旧在前
   * @param {string} endDate - YYYY-MM-DD
   * @param {number} n
   * @returns {string[]}
   */
  T.lastNMonthKeys = function (endDate, n) {
    var d = new Date(endDate + 'T00:00:00');
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
      var m = dt.getMonth() + 1;
      out.push(dt.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m));
    }
    return out;
  };

  /**
   * 单月收入/支出汇总（分）
   * @param {Array} txs - 已经 privacy 过滤的可见交易（调用方负责排除 vault）
   * @param {string} monthKey - YYYY-MM
   */
  T.monthTotals = function (txs, monthKey) {
    var income = 0, expense = 0;
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i];
      if (t.date.slice(0, 7) !== monthKey) continue;
      if (t.type === 'income') income += t.amount || 0;
      else if (t.type === 'expense') expense += t.amount || 0;
    }
    return { income: income, expense: expense, balance: income - expense };
  };

  /** 构造近 n 月序列 [{monthKey, income, expense, balance}] */
  T.buildSeries = function (txs, monthKeys) {
    return monthKeys.map(function (mk) {
      var r = T.monthTotals(txs, mk);
      return { monthKey: mk, income: r.income, expense: r.expense, balance: r.balance };
    });
  };

  /** 有数据的月份数（收入或支出>0） */
  T.nonZeroMonths = function (series) {
    return series.filter(function (s) { return s.income > 0 || s.expense > 0; }).length;
  };

  /**
   * 趋势总结文案
   * @returns {{text:string, level:'good'|'warn'|'info'|'empty'}}
   */
  T.trendSummary = function (series) {
    if (T.nonZeroMonths(series) < 2) {
      return { text: '记账数据不足，继续记账后可查看趋势', level: 'empty' };
    }
    // 取最近 3 个有数据的月份
    var withData = series.filter(function (s) { return s.income > 0 || s.expense > 0; });
    var last3 = withData.slice(-3);
    if (last3.length < 2) return { text: '记账数据不足，继续记账后可查看趋势', level: 'empty' };

    // 结余是否持续增长
    var balUp = last3.every(function (s, i) {
      if (i === 0) return true;
      return s.balance > last3[i - 1].balance;
    });
    if (balUp && last3.length >= 2) {
      return { text: '近几个月结余持续增长，攒钱趋势不错 📈', level: 'good' };
    }
    // 支出是否持续增长
    var expUp = last3.every(function (s, i) {
      if (i === 0) return true;
      return s.expense > last3[i - 1].expense;
    });
    if (expUp && last3.length >= 2) {
      return { text: '近几个月支出持续增长，注意控制 📉', level: 'warn' };
    }
    return { text: '近几个月收支基本平稳', level: 'info' };
  };

  /* ---------------- UI ---------------- */

  // 图例开关状态
  var showIncome = true;
  var showExpense = true;

  /** 取可见非小金库交易（与储蓄/预算同口径） */
  function visibleNonVault() {
    var viewer = fcDb.getCurrentViewer();
    var all = fcDb.tx.list();
    var out = [];
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

  function fmtYuan(cents) {
    if (cents == null) return '0';
    return (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  function monthLabel(mk) {
    // '2026-05' → '5月'
    var m = parseInt(mk.slice(5, 7), 10);
    return m + '月';
  }

  /**
   * 渲染看板收支趋势卡
   */
  T.render = function () {
    var wrap = $('trend-card');
    if (!wrap) return;
    var today = new Date().toISOString().slice(0, 10);
    var monthKeys = T.lastNMonthKeys(today, 6);
    var series = T.buildSeries(visibleNonVault(), monthKeys);
    var summary = T.trendSummary(series);

    // 计算 Y 轴最大值（只计当前显示的线）
    var maxVal = 0;
    series.forEach(function (s) {
      if (showIncome && s.income > maxVal) maxVal = s.income;
      if (showExpense && s.expense > maxVal) maxVal = s.expense;
    });
    if (maxVal === 0) maxVal = 1; // 避免除零

    var W = 320, H = 180;
    var padL = 36, padR = 12, padT = 16, padB = 28;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;
    var n = series.length;
    var stepX = n > 1 ? chartW / (n - 1) : 0;

    function x(i) { return padL + i * stepX; }
    function y(v) { return padT + chartH - (v / maxVal) * chartH; }

    function points(fn) {
      return series.map(function (s, i) { return x(i) + ',' + y(fn(s)); }).join(' ');
    }

    var incomePoly = showIncome ? '<polyline points="' + points(function (s) { return s.income; }) + '" fill="none" stroke="#10b981" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' : '';
    var expensePoly = showExpense ? '<polyline points="' + points(function (s) { return s.expense; }) + '" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' : '';

    var dots = '';
    var labels = '';
    var clickZones = '';
    series.forEach(function (s, i) {
      var cx = x(i);
      // 收入点
      if (showIncome) dots += '<circle cx="' + cx + '" cy="' + y(s.income) + '" r="3" fill="#10b981"/>';
      // 支出点
      if (showExpense) dots += '<circle cx="' + cx + '" cy="' + y(s.expense) + '" r="3" fill="#f43f5e"/>';
      // X 轴标签
      labels += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + monthLabel(s.monthKey) + '</text>';
      // 点击区（跳转该月明细）
      var zx = cx - stepX / 2;
      clickZones += '<rect x="' + zx + '" y="' + padT + '" width="' + stepX + '" height="' + chartH + '" fill="transparent" onclick="fcTrend.jumpMonth(\'' + s.monthKey + '\')" style="cursor:pointer"/>';
    });

    // Y 轴刻度（0 / 半值 / 最大值）
    var yTicks = '';
    [0, Math.round(maxVal / 2), maxVal].forEach(function (v) {
      var yy = y(v);
      var label = v >= 10000 ? (v / 10000) + '万' : Math.round(v / 100) + '';
      yTicks += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="#f1f5f9" stroke-width="1"/>';
      yTicks += '<text x="' + (padL - 4) + '" y="' + (yy + 3) + '" text-anchor="end" font-size="9" fill="#cbd5e1">' + label + '</text>';
    });

    var sumColor = { good: 'text-emerald-600', warn: 'text-rose-500', info: 'text-slate-500', empty: 'text-slate-400' }[summary.level];

    wrap.innerHTML =
      '<div class="bg-white rounded-2xl border border-slate-200 p-4">' +
        '<div class="flex items-center justify-between">' +
          '<h3 class="font-semibold text-slate-800 text-sm">📈 近6个月收支趋势</h3>' +
          '<div class="flex items-center gap-3 text-[11px]">' +
            '<label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" ' + (showIncome ? 'checked' : '') + ' onchange="fcTrend.toggle(\'income\')" class="accent-emerald-500"/><span class="text-emerald-600">收入</span></label>' +
            '<label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" ' + (showExpense ? 'checked' : '') + ' onchange="fcTrend.toggle(\'expense\')" class="accent-rose-500"/><span class="text-rose-500">支出</span></label>' +
          '</div>' +
        '</div>' +
        '<p class="text-xs ' + sumColor + ' mt-1 mb-2">' + summary.text + '</p>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full" style="height:180px" preserveAspectRatio="none">' +
          yTicks +
          incomePoly + expensePoly + dots + labels + clickZones +
        '</svg>' +
        '<p class="text-[10px] text-slate-400 mt-1.5">点击月份可查看该月明细；口径含本人私密账金额，不含小金库</p>' +
      '</div>';
  };

  /** 切换收入/支出显示 */
  T.toggle = function (which) {
    if (which === 'income') showIncome = !showIncome;
    else if (which === 'expense') showExpense = !showExpense;
    T.render();
  };

  /** 跳到明细页并切到指定月 */
  T.jumpMonth = function (monthKey) {
    if (typeof global.ledger !== 'undefined' && ledger.setMonth) {
      ledger.setMonth(monthKey);
    }
    global.showPage('ledger');
  };

  global.fcTrend = T;
})(window);

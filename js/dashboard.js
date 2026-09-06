/* ============================================================
 * dashboard.js — 仪表盘（批次④，07-PRD §7）
 * 口径红线：所有数据经 fcPrivacy / fcSplit 取数，本文件不做隐私判断
 * 图表：纯 CSS/div 宽度实现，不引入图表库
 * ============================================================ */
(function (global) {
  'use strict';

  var D = {};
  var currentMonth = null;

  /* ================= 纯函数（可单测） ================= */

  /** 分类支出占比（仅查看人可见的支出），按金额倒序 */
  D.categoryBreakdown = function (transactions, viewerId, month) {
    var mv = fcPrivacy.monthView(transactions, viewerId, month);
    var map = {};
    var total = 0;
    mv.visible.forEach(function (t) {
      if (t.type !== 'expense') return;
      map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
      total += t.amount;
    });
    var cats = {};
    fcDb.categoriesList().forEach(function (c) { cats[c.id] = c; });
    var arr = Object.keys(map).map(function (cid) {
      var c = cats[cid] || { name: '未知', icon: '📦' };
      return { categoryId: cid, name: c.name, icon: c.icon, amount: map[cid], pct: total ? map[cid] / total : 0 };
    });
    arr.sort(function (a, b) { return b.amount - a.amount; });
    return { items: arr, total: total };
  };

  /** 本月记账天数（可见交易去重日期） */
  D.recordDays = function (transactions, viewerId, month) {
    var mv = fcPrivacy.monthView(transactions, viewerId, month);
    var days = {};
    mv.visible.forEach(function (t) { days[t.date] = true; });
    var p = month.split('-');
    var daysInMonth = new Date(Number(p[0]), Number(p[1]), 0).getDate();
    return { count: Object.keys(days).length, daysInMonth: daysInMonth };
  };

  /** 双人对比（仅 public 共同支出口径，直接复用结算引擎） */
  D.duoCompare = function (transactions, month, settings) {
    return fcSplit.monthSettlement(transactions, month, settings);
  };

  /* ================= UI ================= */

  function $(id) { return document.getElementById(id); }

  function fmt(cents, withSign) {
    var abs = (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!withSign) return '¥' + abs;
    return (cents < 0 ? '-¥' : '+¥') + abs;
  }

  function monthShift(month, delta) {
    var p = month.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    var m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m);
  }

  function monthLabel(month) {
    var p = month.split('-');
    return p[0] + '年' + Number(p[1]) + '月';
  }

  D.render = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var viewer = s.currentViewer;
    if (!currentMonth) currentMonth = new Date().toISOString().slice(0, 7);
    var txs = fcDb.tx.list();

    $('d-month-label').textContent = monthLabel(currentMonth);

    /* --- 本月收支（查看人可见口径，07-PRD §7） --- */
    var totals = fcPrivacy.monthTotals(txs, viewer, currentMonth);
    $('d-income').textContent = fmt(totals.income, true);
    $('d-expense').textContent = fmt(-totals.expense, true);
    $('d-balance').textContent = fmt(totals.income - totals.expense);

    /* --- 分类占比 Top5（纯 CSS 条形） --- */
    var bd = D.categoryBreakdown(txs, viewer, currentMonth);
    var box = $('d-cats');
    box.innerHTML = '';
    var top = bd.items.slice(0, 5);
    var rest = bd.items.slice(5).reduce(function (sum, it) { return sum + it.amount; }, 0);
    if (!bd.items.length) {
      box.innerHTML = '<p class="text-xs text-slate-400 py-3 text-center">本月还没有支出记录</p>';
    }
    top.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 text-xs';
      row.innerHTML =
        '<span class="w-14 shrink-0 text-slate-600 truncate">' + it.icon + ' ' + it.name + '</span>' +
        '<div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">' +
        '<div class="h-full bg-indigo-400 rounded-full" style="width:' + (it.pct * 100).toFixed(1) + '%"></div></div>' +
        '<span class="w-10 shrink-0 text-right text-slate-500">' + (it.pct * 100).toFixed(0) + '%</span>' +
        '<span class="w-16 shrink-0 text-right text-slate-700 font-medium">' + fmt(it.amount) + '</span>';
      box.appendChild(row);
    });
    if (rest > 0) {
      var r = document.createElement('div');
      r.className = 'flex items-center gap-2 text-xs text-slate-400';
      r.innerHTML = '<span class="w-14 shrink-0">📦 其他</span><span class="flex-1"></span><span class="w-16 shrink-0 text-right">' + fmt(rest) + '</span>';
      box.appendChild(r);
    }

    /* --- 双人对比（仅 public 共同支出，会员功能） --- */
    var cmp = D.duoCompare(txs, currentMonth, s);
    var duo = $('d-duo-body');
    var maxVal = Math.max(cmp.paid.m1, cmp.paid.m2, cmp.shares.m1, cmp.shares.m2, 1);
    function bar(label, v, color) {
      return '<div class="flex-1">' +
        '<p class="text-[11px] text-slate-400 mb-1">' + label + ' ' + fmt(v) + '</p>' +
        '<div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">' +
        '<div class="h-full ' + color + ' rounded-full" style="width:' + (v / maxVal * 100).toFixed(1) + '%"></div></div></div>';
    }
    var m1 = s.members[0], m2 = s.members[1];
    duo.innerHTML =
      '<div class="space-y-2.5">' +
      '<div class="flex items-center gap-2 text-xs font-medium text-slate-600"><span class="w-12">' + m1.emoji + m1.name + '</span>' +
      bar('垫付', cmp.paid.m1, 'bg-indigo-400') + '</div>' +
      '<div class="flex items-center gap-2 text-xs text-slate-400"><span class="w-12"></span>' +
      bar('应承担', cmp.shares.m1, 'bg-indigo-200') + '</div>' +
      '<div class="flex items-center gap-2 text-xs font-medium text-slate-600"><span class="w-12">' + m2.emoji + m2.name + '</span>' +
      bar('垫付', cmp.paid.m2, 'bg-violet-400') + '</div>' +
      '<div class="flex items-center gap-2 text-xs text-slate-400"><span class="w-12"></span>' +
      bar('应承担', cmp.shares.m2, 'bg-violet-200') + '</div>' +
      '</div>';

    /* --- 小金库余额（本人，会员功能） --- */
    var vault = fcPrivacy.vaultView(txs, viewer);
    $('d-vault-balance').textContent = fmt(vault.balance);

    /* --- 记账坚持（正向激励雏形） --- */
    var rd = D.recordDays(txs, viewer, currentMonth);
    $('d-days').textContent = rd.count + ' / ' + rd.daysInMonth;
  };

  /* ---------------- 装配 ---------------- */

  D.bind = function () {
    $('d-month-prev').addEventListener('click', function () { currentMonth = monthShift(currentMonth, -1); D.render(); });
    $('d-month-next').addEventListener('click', function () { currentMonth = monthShift(currentMonth, 1); D.render(); });
  };

  global.fcDash = D;
  global.dashUI = D;
})(window);

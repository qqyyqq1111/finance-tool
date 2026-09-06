/* ============================================================
 * split.js — 分摊结算引擎 + 结算页（批次③）
 * 规范来源：docs/07-分模块PRD.md §6；算法对照 spliit(MIT) 双人简化
 *  - 参与范围：public + shared=true + expense（07-PRD §6.1）
 *  - 比例：类别覆盖优先 → 默认比例；尾差按 m1 比例四舍五入、m2 找补（Σ=原额）
 *  - 红线：取数经 privacy 过滤口径，本文件只消费"已过滤"的交易数组
 * ============================================================ */
(function (global) {
  'use strict';

  var S = {};
  var currentMonth = null;

  /* ================= 引擎（纯函数，可单测） ================= */

  /** 某分类适用的比例：类别覆盖优先，否则默认（07-PRD §6.1） */
  S.ratioFor = function (settings, categoryId) {
    var rule = (settings && settings.splitRule) || {};
    var ov = (rule.categoryOverrides || {})[categoryId];
    return ov || rule.defaultRatio || { m1: 50, m2: 50 };
  };

  /** 是否参与共同分摊（07-PRD §6.1：public + shared + expense） */
  S.isShareable = function (t) {
    return t.privacy === 'public' && t.shared === true && t.type === 'expense';
  };

  /**
   * 单笔分摊（整数分，尾差处理，07-PRD §6.2/§6.4）
   * m1 按比例四舍五入，m2 找补 → 保证 Σshares === amount（例：3333分 5:5 → 1667/1666）
   */
  S.splitOne = function (amount, ratio) {
    var s1 = Math.round(amount * ratio.m1 / 100);
    return { m1: s1, m2: amount - s1 };
  };

  /**
   * 月度结算核心（纯函数：传入交易数组+设置，不读存储）
   * @returns {{month, items, paid, shares, balance, transfer, twoClean}}
   *   items: 参与分摊的逐笔构成；transfer: {from,to,amount}；两清时为 null
   */
  S.monthSettlement = function (transactions, month, settings) {
    var paid = { m1: 0, m2: 0 };
    var shares = { m1: 0, m2: 0 };
    var items = [];
    (transactions || []).forEach(function (t) {
      if ((t.date || '').indexOf(month) !== 0) return;
      if (!S.isShareable(t)) return; // private/vault/收入/不参与分摊的支出全部排除
      // 优先用落账时固化的比例（不追溯规则改动，07-PRD §6.1）；旧数据回退当前规则
      var ratio = t.splitRatio || S.ratioFor(settings, t.categoryId);
      var sh = S.splitOne(t.amount, ratio);
      if (t.ownerId === 'm1' || t.ownerId === 'm2') paid[t.ownerId] += t.amount;
      shares.m1 += sh.m1;
      shares.m2 += sh.m2;
      items.push({
        txId: t.id, date: t.date, note: t.note || '', categoryId: t.categoryId,
        amount: t.amount, payerId: t.ownerId, shares: sh
      });
    });
    items.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var balance = { m1: paid.m1 - shares.m1, m2: paid.m2 - shares.m2 };
    var transfer = null;
    if (balance.m1 > 0 && balance.m2 < 0) transfer = { from: 'm2', to: 'm1', amount: balance.m1 };
    else if (balance.m2 > 0 && balance.m1 < 0) transfer = { from: 'm1', to: 'm2', amount: balance.m2 };
    return {
      month: month, items: items, paid: paid, shares: shares,
      balance: balance, transfer: transfer, twoClean: !transfer
    };
  };

  /* ================= 结算页 UI（07-PRD §6.3） ================= */

  function $(id) { return document.getElementById(id); }

  function fmt(cents) {
    return '¥' + (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  function nameOf(settings, id) {
    var m = settings.members.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : '?';
  }

  S.render = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    if (!currentMonth) {
      var now = new Date();
      currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }
    var result = fcSplit.monthSettlement(fcDb.tx.list(), currentMonth, s);
    var settled = fcDb.settlements.findByMonth(currentMonth);

    $('s-month-label').textContent = monthLabel(currentMonth);
    $('s-month-prev').textContent = '‹';
    $('s-status').textContent = settled
      ? (settled.status === 'settled' ? '已结清 ✓' : '已确认结算')
      : '未结算（草稿）';

    /* --- 大字卡片 --- */
    var card = $('s-result-body');
    if (settled) {
      var statusBadge = settled.status === 'settled'
        ? '<span class="text-[11px] bg-emerald-400/20 rounded-full px-2 py-0.5">已结清</span>'
        : '<span class="text-[11px] bg-white/20 rounded-full px-2 py-0.5">待转账</span>';
      card.innerHTML =
        '<div class="flex items-center justify-between">' +
        '<p class="text-xs opacity-80">' + monthLabel(currentMonth) + ' · 已确认结算 ' + statusBadge + '</p></div>' +
        (settled.amount > 0
          ? '<p class="text-2xl font-bold mt-2">' + nameOf(s, settled.from) + ' → ' + nameOf(s, settled.to) +
            '：<span class="text-3xl">' + fmt(settled.amount) + '</span></p>' +
            '<p class="text-xs opacity-80 mt-1">可在各自记账App中转账，转完回来点"标记已结清"</p>'
          : '<p class="text-2xl font-bold mt-2">本月两清 🎉</p>');
    } else if (result.twoClean) {
      card.innerHTML =
        '<p class="text-xs opacity-80">' + monthLabel(currentMonth) + ' · 未结算</p>' +
        '<p class="text-2xl font-bold mt-2">本月两清 🎉</p>' +
        '<p class="text-xs opacity-80 mt-1">共同支出 ' + fmt(result.shares.m1 + result.shares.m2) +
        '，双方垫付与应承担完全一致</p>';
    } else {
      card.innerHTML =
        '<p class="text-xs opacity-80">' + monthLabel(currentMonth) + ' · 未结算</p>' +
        '<p class="text-2xl font-bold mt-2">' + nameOf(s, result.transfer.from) + ' 应付 ' +
        nameOf(s, result.transfer.to) + '：<span class="text-3xl">' + fmt(result.transfer.amount) + '</span></p>' +
        '<p class="text-xs opacity-80 mt-1">共同支出 ' + fmt(result.shares.m1 + result.shares.m2) +
        ' · 确认后锁定本月账目</p>';
    }

    /* --- 构成明细 --- */
    var list = $('s-detail-list');
    list.innerHTML = '';
    if (!result.items.length) {
      list.innerHTML = '<p class="text-xs text-slate-400 bg-slate-50 rounded-xl p-3">本月没有参与分摊的共同支出（仅公开且参与分摊的支出计入）</p>';
    }
    result.items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'bg-white border border-slate-200 rounded-xl p-3 text-xs';
      row.innerHTML =
        '<div class="flex justify-between"><span class="text-slate-700 font-medium truncate">' +
        (it.note || '共同支出') + '</span><span class="font-semibold text-slate-800">' + fmt(it.amount) + '</span></div>' +
        '<p class="text-slate-400 mt-1">' + it.date.slice(5) + ' · ' + nameOf(s, it.payerId) + ' 实付 ' + fmt(it.amount) +
        ' · 分摊 ' + nameOf(s, 'm1') + ' ' + fmt(it.shares.m1) + ' / ' + nameOf(s, 'm2') + ' ' + fmt(it.shares.m2) + '</p>';
      list.appendChild(row);
    });

    /* --- 操作按钮 --- */
    $('s-confirm').classList.toggle('hidden', !!settled);
    $('s-confirmed-actions').classList.toggle('hidden', !settled);
    $('s-settled-btn').classList.toggle('hidden', !!(settled && settled.status === 'settled'));

    /* --- 分摊规则 --- */
    renderRules(s);

    /* --- 历史结算 --- */
    var hist = $('s-history');
    hist.innerHTML = '';
    var all = fcDb.settlements.list().slice().sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    if (!all.length) {
      hist.innerHTML = '<p class="text-xs text-slate-400">还没有结算记录，月末在这里确认结算</p>';
    }
    all.forEach(function (r) {
      var badge = r.status === 'settled' ? '<span class="text-emerald-500">已结清</span>'
        : r.status === 'void' ? '<span class="text-slate-300 line-through">已作废</span>'
        : '<span class="text-indigo-500">待转账</span>';
      var btn = document.createElement('button');
      btn.className = 'w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs active:bg-slate-50';
      btn.innerHTML =
        '<span class="font-medium text-slate-700">' + monthLabel(r.month) + '</span>' +
        '<span class="text-slate-500">' + (r.amount > 0 ? nameOf(s, r.from) + '→' + nameOf(s, r.to) + ' ' + fmt(r.amount) : '两清') + ' ' + badge + '</span>';
      btn.addEventListener('click', function () { currentMonth = r.month; S.render(); });
      hist.appendChild(btn);
    });
  };

  /* ---------------- 分摊规则（改动只对新账目生效） ---------------- */

  function renderRules(s) {
    var rule = s.splitRule || { defaultRatio: { m1: 50, m2: 50 }, categoryOverrides: {} };
    var d = rule.defaultRatio;
    $('s-ratio').value = d.m1;
    $('s-ratio-text').textContent = nameOf(s, 'm1') + ' ' + d.m1 + '% : ' + nameOf(s, 'm2') + ' ' + d.m2 + '%';

    var box = $('s-overrides');
    box.innerHTML = '';
    fcDb.categoriesList().filter(function (c) { return c.type === 'expense'; }).forEach(function (c) {
      var ov = (rule.categoryOverrides || {})[c.id];
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 py-1.5';
      row.innerHTML =
        '<span class="w-16 shrink-0 text-xs text-slate-600 truncate">' + c.icon + ' ' + c.name + '</span>' +
        '<input type="range" min="10" max="90" step="5" value="' + (ov ? ov.m1 : d.m1) + '" class="flex-1 accent-indigo-500 h-1.5">' +
        '<span class="w-20 shrink-0 text-[11px] text-slate-500 text-right" data-txt></span>' +
        (ov ? '<button class="text-[11px] text-slate-400 underline shrink-0" data-reset>默认</button>' : '');
      var range = row.querySelector('input');
      var txt = row.querySelector('[data-txt]');
      function show() {
        var v = Number(range.value);
        txt.textContent = v + '% : ' + (100 - v) + '%' + (ov ? '' : '（默认）');
      }
      show();
      range.addEventListener('input', function () { show(); });
      range.addEventListener('change', function () {
        var v = Number(range.value);
        var patch = {};
        patch[c.id] = (ov && ov.m1 === v) ? null : { m1: v, m2: 100 - v }; // 拉回原覆盖值=取消覆盖
        var r = fcDb.setSplitRule({ categoryOverrides: patch });
        if (!r.ok) { global.toast(r.errors[0]); return; }
        global.toast('已保存（仅对新账目生效）');
        S.render();
      });
      var reset = row.querySelector('[data-reset]');
      if (reset) reset.addEventListener('click', function () {
        var r = fcDb.setSplitRule({ categoryOverrides: (function () { var p = {}; p[c.id] = null; return p; })() });
        if (!r.ok) { global.toast(r.errors[0]); return; }
        global.toast('已恢复默认比例');
        S.render();
      });
      box.appendChild(row);
    });
  }

  /* ---------------- 操作与装配 ---------------- */

  function confirmSettlement() {
    var s = fcDb.getSettings();
    if (!s) return;
    var result = fcSplit.monthSettlement(fcDb.tx.list(), currentMonth, s);
    var msg = result.twoClean
      ? '确认结算 ' + monthLabel(currentMonth) + '？确认后本月账目将锁定（可作废解锁）。'
      : '确认结算 ' + monthLabel(currentMonth) + '？\n' +
        nameOf(s, result.transfer.from) + ' 应付 ' + nameOf(s, result.transfer.to) + ' ' + fmt(result.transfer.amount) + '\n' +
        '确认后本月账目将锁定，请在各自记账App完成转账后回来标记已结清。';
    if (!global.confirm(msg)) return;
    var r = fcDb.settlements.add(currentMonth, result);
    if (!r.ok) { global.toast(r.errors[0]); return; }
    global.toast('已确认结算，转完账记得回来标记已结清');
    S.render();
  }

  function markSettled() {
    var rec = fcDb.settlements.findByMonth(currentMonth);
    if (!rec) return;
    var r = fcDb.settlements.setStatus(rec.id, 'settled');
    if (!r.ok) { global.toast(r.errors[0]); return; }
    global.toast('已标记结清 ✓');
    S.render();
  }

  function voidSettlement() {
    var rec = fcDb.settlements.findByMonth(currentMonth);
    if (!rec) return;
    if (!global.confirm('作废 ' + monthLabel(currentMonth) + ' 的结算记录？作废后本月账目解锁，可继续修改。')) return;
    var r = fcDb.settlements.setStatus(rec.id, 'void');
    if (!r.ok) { global.toast(r.errors[0]); return; }
    global.toast('已作废，本月账目解锁');
    S.render();
  }

  S.bind = function () {
    $('s-month-prev').addEventListener('click', function () { currentMonth = monthShift(currentMonth, -1); S.render(); });
    $('s-month-next').addEventListener('click', function () { currentMonth = monthShift(currentMonth, 1); S.render(); });
    $('s-detail-toggle').addEventListener('click', function () {
      var hidden = $('s-detail-list').classList.toggle('hidden');
      $('s-detail-arrow').textContent = hidden ? '▾' : '▴';
    });
    $('s-confirm').addEventListener('click', confirmSettlement);
    $('s-settled-btn').addEventListener('click', markSettled);
    $('s-void-btn').addEventListener('click', voidSettlement);
    $('s-ratio').addEventListener('change', function (e) {
      var v = Number(e.target.value);
      var r = fcDb.setSplitRule({ defaultRatio: { m1: v, m2: 100 - v } });
      if (!r.ok) { global.toast(r.errors[0]); return; }
      global.toast('默认比例已保存（仅对新账目生效）');
      S.render();
    });
  };

  global.fcSplit = S;      // 引擎（纯函数）
  global.splitUI = S;      // 结算页（与引擎同对象：render/bind 为 UI，其余为纯函数）
})(window);

/* ============================================================
 * ledger.js — 记账业务：明细列表 / 记一笔表单 / 编辑删除 / 小金库视图
 * 批次② 范围（06-路线图批次②；规范见 07-PRD §4、§5）
 * 取数红线：一切列表/统计经 fcPrivacy 过滤，本文件不做隐私判断
 * ============================================================ */
(function (global) {
  'use strict';

  var L = {};
  var form = {
    type: 'expense',      // expense | income
    privacy: 'public',    // public | private | vault
    shared: true,
    ownerId: null,        // 默认当前查看人
    categoryId: null,
    editingId: null       // null=新增；否则为编辑模式
  };
  var currentMonth = null; // YYYY-MM
  var detailId = null;     // 详情弹层当前交易
  var highlightId = null;  // v1.0.1：保存/编辑成功后新行高亮

  /* ---------------- 工具 ---------------- */

  function $(id) { return document.getElementById(id); }

  function fmt(cents, withSign) {
    var abs = (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!withSign) return '¥' + abs;
    return (cents < 0 ? '-¥' : '+¥') + abs;
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  function catMap() {
    var map = {};
    fcDb.categoriesList().forEach(function (c) { map[c.id] = c; });
    return map;
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

  /** R13：月份是否已被"确认结算"锁定（禁增改删） */
  function isMonthLocked(month) {
    return (fcDb.settlements.list() || []).some(function (s) {
      return s.month === month && s.status === 'confirmed';
    });
  }

  /* ================= 明细列表（07-PRD §4.2） ================= */

  L.renderLedger = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var viewer = s.currentViewer;
    var cats = catMap();
    var txs = fcDb.tx.list();
    if (!currentMonth) currentMonth = today().slice(0, 7);

    /* --- 我的小金库卡片（仅本人视角，对方无此卡 07-PRD §5.2） --- */
    var vault = fcPrivacy.vaultView(txs, viewer);
    $('vault-card').classList.remove('hidden');
    $('vault-balance').textContent = fmt(vault.balance);
    var vlist = $('vault-list');
    vlist.innerHTML = '';
    vault.list.forEach(function (t) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 text-sm';
      row.innerHTML =
        '<span class="opacity-70 text-xs shrink-0">' + t.date.slice(5) + '</span>' +
        '<span class="flex-1 truncate opacity-95">' + (t.note || (cats[t.categoryId] || {}).name || '小金库') + '</span>' +
        '<span class="font-medium">' + fmt(t.type === 'income' ? t.amount : -t.amount, true) + '</span>';
      vlist.appendChild(row);
    });
    if (!vault.list.length) {
      var empty = document.createElement('p');
      empty.className = 'text-xs opacity-70';
      empty.textContent = '还没有小金库记录，记一笔时选择"💰 小金库"即可';
      vlist.appendChild(empty);
    }

    /* --- 月份汇总（只含可读交易） --- */
    $('month-label').textContent = monthLabel(currentMonth);
    var totals = fcPrivacy.monthTotals(txs, viewer, currentMonth);
    $('month-income').textContent = fmt(totals.income, true);
    $('month-expense').textContent = fmt(-totals.expense, true);

    /* --- R13：锁定月份提示条 --- */
    var oldBanner = document.getElementById('month-lock-banner');
    if (oldBanner) oldBanner.remove();
    if (isMonthLocked(currentMonth)) {
      var banner = document.createElement('div');
      banner.id = 'month-lock-banner';
      banner.className = 'flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl px-3 py-2.5 text-xs';
      banner.innerHTML = '<span class="text-base leading-none">🔒</span><span>本月已确认结算、账目已锁定；如需补充修改，请到"结算"页作废本月结算</span>';
      $('tx-list').parentNode.insertBefore(banner, $('tx-list'));
    }

    /* --- 列表：可读交易 + 私密占位行合并按日期倒序 --- */
    var mv = fcPrivacy.monthView(txs, viewer, currentMonth);
    var rows = [];
    mv.visible.forEach(function (t) { rows.push({ date: t.date, tx: t }); });
    mv.placeholders.forEach(function (t) { rows.push({ date: t.date, ph: t }); });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    var box = $('tx-list');
    box.innerHTML = '';
    if (!rows.length) {
      box.innerHTML =
        '<div class="flex flex-col items-center justify-center text-center py-16">' +
        '<span class="text-4xl mb-3">🍃</span>' +
        '<p class="text-slate-500 text-sm">本月还没有可见账目</p>' +
        '<p class="text-xs text-slate-400 mt-1">点底部 ＋ 记一笔</p></div>';
      return;
    }
    rows.forEach(function (r) {
      if (r.ph) {
        // 私密占位行：无金额/分类/备注，不参与统计（07-PRD §4.2/§5.3）
        var ph = document.createElement('div');
        ph.className = 'flex items-center gap-3 bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-3 text-slate-400 text-sm';
        ph.innerHTML =
          '<span>🔒</span><span class="flex-1">对方有 1 笔私密记录</span>' +
          '<span class="text-[11px]">' + r.ph.date.slice(5) + '</span>';
        box.appendChild(ph);
        return;
      }
      var t = r.tx;
      var cat = cats[t.categoryId] || { icon: '📦', name: '未知' };
      var isIncome = t.type === 'income';
      var badge = t.privacy === 'private' ? ' 🔒' : (t.privacy === 'vault' ? ' 💰' : '');
      var owner = fcDb.findMember(t.ownerId);
      var btn = document.createElement('button');
      var hl = t.id === highlightId;
      btn.className = 'w-full flex items-center gap-3 rounded-2xl p-3 text-left active:bg-slate-50 transition ' +
        (hl ? 'bg-indigo-50 border-2 border-indigo-300' : 'bg-white border border-slate-200');
      btn.setAttribute('data-id', t.id);
      btn.innerHTML =
        '<span class="text-2xl leading-none">' + cat.icon + '</span>' +
        '<span class="flex-1 min-w-0">' +
        '<p class="text-sm text-slate-800 truncate">' + (t.note || cat.name) + '</p>' +
        '<p class="text-[11px] text-slate-400 mt-0.5">' + t.date.slice(5) + ' · ' + (owner ? owner.name : '?') + badge + '</p>' +
        '</span>' +
        '<span class="font-semibold ' + (isIncome ? 'text-emerald-500' : 'text-slate-800') + '">' + fmt(isIncome ? t.amount : -t.amount, true) + '</span>';
      btn.addEventListener('click', function () { L.openDetail(t.id); });
      box.appendChild(btn);
    });
  };

  /* ---------------- 月份切换 ---------------- */

  function prevMonth() { currentMonth = monthShift(currentMonth, -1); L.renderLedger(); }
  function nextMonth() { currentMonth = monthShift(currentMonth, 1); L.renderLedger(); }

  function toggleVaultList() {
    var list = $('vault-list');
    var hidden = list.classList.toggle('hidden');
    $('vault-arrow').textContent = hidden ? '▾' : '▴';
  }

  /* ================= 详情弹层（07-PRD §4.2 编辑/删除） ================= */

  L.openDetail = function (id) {
    var t = fcDb.tx.list().filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    detailId = id;
    var cat = catMap()[t.categoryId] || { icon: '📦', name: '未知' };
    var owner = fcDb.findMember(t.ownerId);
    var isIncome = t.type === 'income';
    $('tx-sheet-body').innerHTML =
      '<div class="text-center py-2">' +
      '<p class="text-3xl font-bold ' + (isIncome ? 'text-emerald-500' : 'text-slate-800') + '">' + fmt(isIncome ? t.amount : -t.amount, true) + '</p>' +
      '<p class="text-sm text-slate-400 mt-1">' + cat.icon + ' ' + cat.name + ' · ' + fcPrivacy.label[t.privacy] + '</p>' +
      '</div>' +
      '<div class="text-xs text-slate-500 space-y-1.5 bg-slate-50 rounded-xl p-3">' +
      '<p>日期：' + t.date + '</p>' +
      '<p>归属人：' + (owner ? owner.name : '?') + '</p>' +
      '<p>共同分摊：' + (t.shared ? '参与' : '不参与') + '</p>' +
      (t.note ? '<p>备注：' + t.note + '</p>' : '') +
      '</div>';
    $('tx-sheet').classList.remove('hidden');
  };

  L.closeDetail = function () {
    $('tx-sheet').classList.add('hidden');
    detailId = null;
  };

  function deleteDetail() {
    if (!detailId) return;
    var t = fcDb.tx.list().filter(function (x) { return x.id === detailId; })[0];
    if (t && isMonthLocked(t.date.slice(0, 7))) { global.toast('该月已确认结算锁定，请先到结算页作废'); return; }
    if (!global.confirm('确定删除这笔账目吗？删除后不可恢复。')) return;
    var r = fcDb.tx.remove(detailId);
    L.closeDetail();
    if (!r.ok) { global.toast(r.errors[0]); return; }
    global.toast('已删除', 'success');
    L.renderLedger();
  }

  function editDetail() {
    if (!detailId) return;
    var t = fcDb.tx.list().filter(function (x) { return x.id === detailId; })[0];
    if (t && isMonthLocked(t.date.slice(0, 7))) { global.toast('该月已确认结算锁定，请先到结算页作废'); return; }
    L.loadForEdit(detailId);
    L.closeDetail();
  }

  /* ================= 记一笔表单（07-PRD §4.1） ================= */

  function segStyle(btn, active) {
    btn.className = btn.className.replace(/ (border-indigo-500|bg-indigo-50|text-indigo-600|border-slate-200|text-slate-600|bg-white)/g, '');
    if (active) btn.className += ' border-indigo-500 bg-indigo-50 text-indigo-600';
    else btn.className += ' border-slate-200 text-slate-600 bg-white';
  }

  function renderTypeSeg() {
    document.querySelectorAll('.f-type-btn').forEach(function (b) {
      segStyle(b, b.getAttribute('data-v') === form.type);
    });
    renderCats();
    renderSharedRow();
  }

  function renderPrivacySeg() {
    // R4：私密 vs 小金库用具体生活场景讲清楚——核心区别是"对方知不知道你花了这笔钱"
    var hints = {
      public: '🌐 公开账：双方都看得到金额和内容，参与共同分摊（如：一起吃火锅、交房租）',
      private: '🔒 私密账：对方知道你花了钱（会看到一条"有1笔私密记录"占位行），但看不到金额和买了什么（如：给妈妈买礼物、和朋友的聚餐）',
      vault: '💰 小金库：完全独立的私人账户，对方不知道它存在、看不到任何痕迹，也不进任何统计（如：私房钱、秘密储蓄计划）'
    };
    document.querySelectorAll('.f-privacy-btn').forEach(function (b) {
      segStyle(b, b.getAttribute('data-v') === form.privacy);
    });
    var hintBox = $('f-privacy-hint');
    hintBox.textContent = hints[form.privacy];
    hintBox.className = form.privacy === 'public'
      ? 'text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2 leading-relaxed'
      : 'text-xs text-indigo-600 bg-indigo-50 rounded-xl px-3 py-2 leading-relaxed';
    renderSharedRow();
  }

  function renderSharedRow() {
    var show = form.privacy === 'public' && form.type === 'expense';
    $('f-shared-row').classList.toggle('hidden', !show);
    var btn = $('f-shared');
    btn.textContent = form.shared ? '开启' : '关闭';
    btn.className = 'text-sm font-medium rounded-full px-3 py-1.5 transition ' +
      (form.shared ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400');
  }

  function renderCats() {
    var box = $('f-cats');
    box.innerHTML = '';
    fcDb.categoriesList().filter(function (c) { return c.type === form.type && !c.hidden; }).forEach(function (c) {
      var btn = document.createElement('button');
      btn.className = 'rounded-xl border py-2.5 text-center transition ' +
        (form.categoryId === c.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white');
      btn.innerHTML = '<span class="text-xl block leading-none mb-1">' + c.icon + '</span><span class="text-[11px] text-slate-600">' + c.name + '</span>';
      btn.addEventListener('click', function () {
        form.categoryId = c.id;
        renderCats();
      });
      box.appendChild(btn);
    });
  }

  function renderOwnerSeg() {
    var s = fcDb.getSettings();
    if (!s) return;
    if (!form.editingId) form.ownerId = s.currentViewer; // 新账默认当前查看人
    var box = $('f-owner');
    box.innerHTML = '';
    s.members.forEach(function (m) {
      var btn = document.createElement('button');
      btn.className = 'rounded-xl py-2.5 text-sm font-medium border transition ' +
        (form.ownerId === m.id ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-slate-200 bg-white text-slate-600');
      btn.innerHTML = m.emoji + ' ' + m.name;
      btn.addEventListener('click', function () {
        form.ownerId = m.id;
        renderOwnerSeg();
      });
      box.appendChild(btn);
    });
  }

  /** 新账模式：清空表单（07-PRD §4.1 默认值） */
  L.newEntry = function () {
    var isFamily = fcDb.getSettings() && fcDb.getSettings().tier !== 'free';
    form = {
      type: 'expense', privacy: 'public', shared: true,
      ownerId: fcDb.getCurrentViewer(), categoryId: null, editingId: null
    };
    if (!isFamily) form.privacy = 'public'; // 免费版锁定 public（07-PRD §9）
    $('f-title').textContent = '记一笔';
    $('f-save').textContent = '保存';
    $('f-amount').value = '';
    $('f-note').value = '';
    $('f-date').value = today();
    renderTypeSeg();
    renderPrivacySeg();
    renderOwnerSeg();
  };

  /** 免费版门控：隐私强制 public（07-PRD §9） */
  L.forcePublicPrivacy = function () {
    if (form.privacy !== 'public') {
      form.privacy = 'public';
      renderPrivacySeg();
    }
  };

  /** 编辑模式：回填表单 */
  L.loadForEdit = function (id) {
    var t = fcDb.tx.list().filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    form = {
      type: t.type, privacy: t.privacy, shared: !!t.shared,
      ownerId: t.ownerId, categoryId: t.categoryId, editingId: t.id
    };
    $('f-title').textContent = '编辑账目';
    $('f-save').textContent = '保存修改';
    $('f-amount').value = (t.amount / 100).toFixed(2);
    $('f-note').value = t.note || '';
    $('f-date').value = t.date;
    renderTypeSeg();
    renderPrivacySeg();
    renderOwnerSeg();
    global.showPage('add');
  };

  function saveFromForm() {
    var amountYuan = parseFloat($('f-amount').value);
    if (!(amountYuan > 0)) { global.toast('请输入正确的金额'); return; }
    if (!form.categoryId) { global.toast('请选择分类'); return; }
    var dateVal = $('f-date').value || today();
    // R13：账目所属月已确认结算 → 友好提示（数据层也会兜底拦截）
    var txMonth = dateVal.slice(0, 7);
    var editing = null;
    if (form.editingId) editing = fcDb.tx.list().filter(function (x) { return x.id === form.editingId; })[0];
    var lockMonth = editing ? editing.date.slice(0, 7) : txMonth;
    if (isMonthLocked(lockMonth)) { global.toast('' + monthLabel(lockMonth) + '已确认结算锁定；请到"结算"页作废后再修改'); return; }
    var data = {
      date: dateVal,
      type: form.type,
      amount: Math.round(amountYuan * 100), // 元 → 分（07-PRD §2.2）
      categoryId: form.categoryId,
      ownerId: form.ownerId,
      privacy: form.privacy,
      shared: form.privacy === 'public' && form.type === 'expense' ? form.shared : false,
      note: $('f-note').value.trim()
    };
    if (form.privacy === 'vault') data.vaultId = fcDb.getVaultOf(form.ownerId).id;
    var r = form.editingId ? fcDb.tx.update(form.editingId, data) : fcDb.tx.add(data);
    if (!r.ok) { global.toast(r.errors[0]); return; }
    highlightId = form.editingId || r.record.id;
    global.toast(form.editingId ? '✓ 修改已保存' : '✓ 记好啦，已在明细列表中', 'success');
    var wasEdit = !!form.editingId;
    global.showPage('ledger');
    if (wasEdit) L.renderLedger();
    else { currentMonth = data.date.slice(0, 7); L.renderLedger(); }
    setTimeout(function () { highlightId = null; }, 2600);
  }

  /* ---------------- 装配 ---------------- */

  L.bind = function () {
    $('month-prev').addEventListener('click', prevMonth);
    $('month-next').addEventListener('click', nextMonth);
    $('vault-toggle').addEventListener('click', toggleVaultList);
    $('tx-sheet-mask').addEventListener('click', L.closeDetail);
    $('tx-edit').addEventListener('click', editDetail);
    $('tx-delete').addEventListener('click', deleteDetail);

    document.querySelectorAll('.f-type-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        form.type = b.getAttribute('data-v');
        form.categoryId = null; // 类型切换后需重选分类
        renderTypeSeg();
      });
    });
    document.querySelectorAll('.f-privacy-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        form.privacy = b.getAttribute('data-v');
        renderPrivacySeg();
      });
    });
    $('f-shared').addEventListener('click', function () {
      form.shared = !form.shared;
      renderSharedRow();
    });
    $('f-save').addEventListener('click', saveFromForm);
  };

  global.ledger = L;
})(window);

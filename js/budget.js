/* ============================================================
 * budget.js — F4 支出预算与超支提醒（v1.2 批次④，docs/14 §4.1）
 * 口径红线：
 *  - 预算为家庭共同预算，存 settings.budgets，随家庭设置云同步
 *  - 小金库（privacy=vault）不计入预算执行；私密账（private）支出计入金额（真实花了）
 *  - 本文件所有判定走纯函数；取数经 fcPrivacy，不做越权判断
 * ============================================================ */
(function (global) {
  'use strict';

  var B = {};

  /* ================= 常量 ================= */

  var FACTOR_LAST_MONTH = 0.9; // 基于上月支出一键填充的系数

  /* ================= 纯函数（单测覆盖） ================= */

  /** 所有支出分类 */
  B.expenseCategories = function (categories) {
    return (categories || []).filter(function (c) { return c.type === 'expense'; });
  };

  /**
   * 规范化预算：为所有支出分类补默认预算 0，补 enableSuggestions/suggestionsDismissed
   * @param {Object|null} b - 预算对象（可能为旧数据/缺字段）
   * @param {Array} categories - 全部分类
   */
  B.normalizeBudget = function (b, categories) {
    var out = { budgets: {}, totalBudget: 0, suggestionsDismissed: {}, enableSuggestions: true };
    if (b) {
      out.budgets = b.budgets ? Object.assign({}, b.budgets) : {};
      out.totalBudget = typeof b.totalBudget === 'number' ? b.totalBudget : 0;
      out.suggestionsDismissed = b.suggestionsDismissed ? Object.assign({}, b.suggestionsDismissed) : {};
      out.enableSuggestions = b.enableSuggestions !== false;
    }
    // 给每个支出分类兜底 0
    B.expenseCategories(categories).forEach(function (c) {
      if (typeof out.budgets[c.id] !== 'number') out.budgets[c.id] = 0;
    });
    return out;
  };

  /** 上一月 monthKey：YYYY-MM 向前推1月 */
  B.prevMonthKey = function (monthKey) {
    var p = monthKey.split('-').map(Number);
    var d = new Date(p[0], p[1] - 2, 1); // 当月=p[1]-1，再减1
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };

  /** 某月份各支出分类花费（分；输入须已排除 vault） */
  B.monthExpenseByCat = function (visibleTx, monthKey) {
    var out = {};
    visibleTx.forEach(function (t) {
      if (t.type !== 'expense') return;
      if (t.date.slice(0, 7) !== monthKey) return;
      var k = t.categoryId || 'c_other';
      out[k] = (out[k] || 0) + t.amount;
    });
    return out;
  };

  /**
   * 进度等级（看板进度条颜色）
   * <60% ok(绿) / 60-80% watch(蓝) / 80-100% near(橙) / >=100% over(红)
   */
  B.progressLevel = function (pct) {
    if (pct >= 1) return 'over';
    if (pct >= 0.8) return 'near';
    if (pct >= 0.6) return 'watch';
    return 'ok';
  };

  /**
   * 预警等级（记账提醒/严重标红）
   * >=150% severe / >=100% over / >=80% warn / 否则 null
   */
  B.warnLevel = function (pct) {
    if (pct >= 1.5) return 'severe';
    if (pct >= 1) return 'over';
    if (pct >= 0.8) return 'warn';
    return null;
  };

  /**
   * 预算执行明细
   * @param {Object} budget - 已规范化
   * @param {Object} spentByCat - {catId: 分}
   * @param {Array} categories
   * @returns {{rows:Array, total:Object}} rows 按已花降序；只列设了预算或有支出的分类
   */
  B.budgetProgress = function (budget, spentByCat, categories) {
    var expCats = B.expenseCategories(categories);
    var catMap = {};
    expCats.forEach(function (c) { catMap[c.id] = c; });
    var catIds = Object.keys(Object.assign({}, budget.budgets, spentByCat));
    var rows = catIds.map(function (id) {
      var c = catMap[id] || { id: id, name: '其他', icon: '📦' };
      var budgetAmt = budget.budgets[id] || 0;
      var spent = spentByCat[id] || 0;
      var pct = budgetAmt > 0 ? spent / budgetAmt : (spent > 0 ? 1 : 0);
      return {
        id: id, name: c.name, icon: c.icon,
        budget: budgetAmt, spent: spent, pct: pct,
        level: B.progressLevel(pct)
      };
    }).filter(function (r) { return r.budget > 0 || r.spent > 0; })
      .sort(function (a, b) { return b.spent - a.spent; });

    var totalBudget = 0, totalSpent = 0;
    rows.forEach(function (r) { totalBudget += r.budget; totalSpent += r.spent; });
    var totalPct = totalBudget > 0 ? totalSpent / totalBudget : 0;
    return {
      rows: rows,
      total: {
        budget: totalBudget, spent: totalSpent,
        remain: totalBudget - totalSpent,
        pct: totalPct,
        level: B.progressLevel(totalPct)
      }
    };
  };

  /**
   * 记账时实时计算：若加上这笔，该分类预算执行情况
   * @returns {{spentAfter, pctAfter, warnLevel, overAmount}} overAmount=超出预算的部分（分）
   */
  B.ifAddOver = function (budget, spentByCat, catId, addCents) {
    var spent = (spentByCat[catId] || 0) + addCents;
    var bgt = budget.budgets[catId] || 0;
    var pct = bgt > 0 ? spent / bgt : (spent > 0 ? 1 : 0);
    return {
      spentAfter: spent,
      pctAfter: pct,
      warnLevel: B.warnLevel(pct),
      overAmount: bgt > 0 ? Math.max(0, spent - bgt) : 0
    };
  };

  /** 上月各分类支出（分） */
  B.lastMonthExpenseByCat = function (visibleTx, monthKey) {
    return B.monthExpenseByCat(visibleTx, B.prevMonthKey(monthKey));
  };

  /**
   * 基于上月支出一键填充预算（各分类 = 上月支出 × factor，0分类保持0）
   * @returns {Object} {budgets, totalBudget}
   */
  B.fillFromLastMonth = function (expenseCats, lastMonthByCat, factor) {
    var f = factor != null ? factor : FACTOR_LAST_MONTH;
    var budgets = {};
    var total = 0;
    expenseCats.forEach(function (c) {
      var last = lastMonthByCat[c.id] || 0;
      var amt = last > 0 ? Math.round(last * f) : 0;
      budgets[c.id] = amt;
      total += amt;
    });
    return { budgets: budgets, totalBudget: total };
  };

  /**
   * 按上月支出比例分配总预算到各分类
   * @returns {Object} {budgets, totalBudget}
   */
  B.distributeTotal = function (expenseCats, lastMonthByCat, totalCents) {
    var last = 0;
    expenseCats.forEach(function (c) { last += lastMonthByCat[c.id] || 0; });
    var budgets = {};
    var assigned = 0;
    expenseCats.forEach(function (c, i) {
      var amt = last > 0 ? Math.round((lastMonthByCat[c.id] || 0) / last * totalCents) : 0;
      // 最后一个分类吸收尾差
      if (i === expenseCats.length - 1) amt = totalCents - assigned;
      budgets[c.id] = Math.max(0, amt);
      assigned += budgets[c.id];
    });
    return { budgets: budgets, totalBudget: totalCents };
  };

  /**
   * 某分类连续超支月数（从最近月向前数，直到某月不超支为止）
   * @param {Array} monthKeys - 时间正序
   */
  B.consecutiveOverMonths = function (budget, visibleTx, catId, monthKeys) {
    var count = 0;
    for (var i = monthKeys.length - 1; i >= 0; i--) {
      var spent = (B.monthExpenseByCat(visibleTx, monthKeys[i])[catId]) || 0;
      var bgt = budget.budgets[catId] || 0;
      if (bgt > 0 && spent > bgt) count++;
      else break;
    }
    return count;
  };

  /**
   * 优化建议（基于规则，返回含数据支撑的文案；无建议返回 null）
   * @param {Object} cat - 分类对象 {id,name,icon}
   * @param {Array} visibleTx - 本月可见非vault支出
   * @param {String} monthKey
   * @param {Number} spent - 本月该分类已花（分）
   * @param {Number} budget - 该分类预算（分）
   */
  B.optimizeSuggestion = function (cat, visibleTx, monthKey, spent, budget) {
    if (spent <= budget) return null;
    var over = spent - budget;
    var thisCatTx = visibleTx.filter(function (t) {
      return t.type === 'expense' && t.date.slice(0, 7) === monthKey &&
        (t.categoryId || 'c_other') === cat.id;
    });
    var note = cat.note || cat.name;

    // 通用：与上月对比
    var last = (B.lastMonthExpenseByCat(visibleTx, monthKey)[cat.id]) || 0;
    if (last > 0 && spent > last * 1.2) {
      return '本月' + cat.name + '比上月多花 ¥' + Math.round((spent - last) / 100) +
        '（超预算 ¥' + Math.round(over / 100) + '），关注一下';
    }

    // 餐饮：外卖 vs 堂食（备注含"外卖"）
    if (cat.id === 'c_food') {
      var wm = thisCatTx.filter(function (t) { return (t.note || '').indexOf('外卖') >= 0; });
      if (wm.length >= 2) {
        var wmAmt = wm.reduce(function (a, b) { return a + b.amount; }, 0);
        var pct = Math.round(wmAmt / spent * 100);
        return '本月' + cat.name + '超支 ¥' + Math.round(over / 100) +
          '，其中外卖占' + pct + '%（' + wm.length + '笔），建议下月减少外卖次数';
      }
    }
    // 购物：冲动消费（单笔<100元且非必要分类）
    if (cat.id === 'c_shopping') {
      var impulse = thisCatTx.filter(function (t) { return t.amount < 10000; });
      if (impulse.length >= 3) {
        return '本月' + cat.name + '超支 ¥' + Math.round(over / 100) +
          '，其中小额冲动消费（<¥100）' + impulse.length + '笔，建议下月设冷静期';
      }
    }
    // 娱乐：频次
    if (cat.id === 'c_fun' && thisCatTx.length >= 4) {
      return '本月' + cat.name + '共' + thisCatTx.length + '次外出，建议下月减少到' +
        Math.ceil(thisCatTx.length / 2) + '次以内';
    }
    // 交通：打车（备注含"打车"）
    if (cat.id === 'c_transport') {
      var taxi = thisCatTx.filter(function (t) { return (t.note || '').indexOf('打车') >= 0; });
      if (taxi.length >= 2) {
        var taxiAmt = taxi.reduce(function (a, b) { return a + b.amount; }, 0);
        return '本月' + cat.name + '中超支部分打车占 ¥' + Math.round(taxiAmt / 100) +
          '，建议非紧急情况选公共交通';
      }
    }
    // 通用兜底
    return '本月' + cat.name + '超支 ¥' + Math.round(over / 100) +
      '，下月可适当控制该分类支出';
  };

  /* ================= UI ================= */

  function $(id) { return document.getElementById(id); }

  function fmtYuan(c) {
    return (Math.abs(c) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtInt(c) {
    return Math.round(Math.abs(c) / 100).toLocaleString('zh-CN');
  }

  /** 当前视角可见、且排除小金库的交易（与 savings 同口径） */
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

  var LEVEL_COLOR = {
    ok: 'bg-emerald-400', watch: 'bg-sky-400', near: 'bg-orange-400', over: 'bg-rose-500'
  };
  var LEVEL_TEXT = {
    ok: 'text-emerald-600', watch: 'text-sky-600', near: 'text-orange-600', over: 'text-rose-600'
  };

  /** 看板预算卡片渲染 */
  B.render = function () {
    var wrap = $('budget-card');
    if (!wrap) return;
    var today = new Date().toISOString().slice(0, 10);
    var monthKey = today.slice(0, 7);
    var budget = B.normalizeBudget(fcDb.getBudget(), fcDb.categoriesList());
    var hasBudget = Object.keys(budget.budgets).some(function (id) { return budget.budgets[id] > 0; });
    if (!hasBudget) {
      wrap.innerHTML =
        '<div class="bg-white rounded-2xl border border-slate-200 border-dashed p-4">' +
        '<div class="flex items-center justify-between">' +
        '<h3 class="font-semibold text-slate-800 text-sm">📊 本月预算</h3>' +
        '<button onclick="fcBudget.openSheet()" class="text-xs text-indigo-600 min-h-[44px] px-2">设置预算</button>' +
        '</div>' +
        '<p class="text-xs text-slate-400 mt-2">设置每月各分类预算，超支时自动提醒</p>' +
        '</div>';
      return;
    }

    var txs = visibleNonVault();
    var spent = B.monthExpenseByCat(txs, monthKey);
    var prog = B.budgetProgress(budget, spent, fcDb.categoriesList());

    var rows = prog.rows.map(function (r) {
      var w = Math.min(100, Math.round(r.pct * 100));
      var overCls = r.level === 'over' ? 'text-rose-600 font-semibold' : 'text-slate-500';
      return '<button onclick="fcBudget.jumpTo(\'' + r.id + '\')" class="block w-full text-left mb-2.5 active:opacity-70">' +
        '<div class="flex justify-between items-center text-xs mb-1">' +
        '<span class="text-slate-700">' + r.icon + ' ' + r.name + '</span>' +
        '<span class="' + overCls + '">¥' + fmtInt(r.spent) + '/¥' + fmtInt(r.budget) + ' ' + Math.round(r.pct * 100) + '%</span>' +
        '</div>' +
        '<div class="h-2 bg-slate-100 rounded-full overflow-hidden">' +
        '<div class="' + LEVEL_COLOR[r.level] + ' h-full rounded-full" style="width:' + w + '%"></div>' +
        '</div></button>';
    }).join('');

    var t = prog.total;
    var tW = Math.min(100, Math.round(t.pct * 100));
    var remainCls = t.remain < 0 ? 'text-rose-600' : 'text-slate-500';

    wrap.innerHTML =
      '<div class="bg-white rounded-2xl border border-slate-200 p-4">' +
      '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="font-semibold text-slate-800 text-sm">📊 本月预算</h3>' +
      '<button onclick="fcBudget.openSheet()" class="text-xs text-indigo-600 min-h-[44px] px-2">管理预算</button>' +
      '</div>' +
      '<div class="rounded-xl bg-slate-50 px-3 py-2.5 mb-3 text-xs">' +
      '<div class="flex justify-between text-slate-600 mb-1">' +
      '<span>总预算 ¥' + fmtInt(t.budget) + '</span>' +
      '<span class="' + LEVEL_TEXT[t.level] + '">' + Math.round(t.pct * 100) + '%</span></div>' +
      '<div class="h-2 bg-slate-200 rounded-full overflow-hidden">' +
      '<div class="' + LEVEL_COLOR[t.level] + ' h-full rounded-full" style="width:' + tW + '%"></div></div>' +
      '<div class="flex justify-between mt-1.5 ' + remainCls + '">' +
      '<span>已花 ¥' + fmtInt(t.spent) + '</span>' +
      '<span>剩余 ¥' + fmtInt(t.remain) + '</span></div>' +
      '</div>' +
      rows +
      '</div>';
  };

  /** 跳转到明细页并筛选该分类 */
  B.jumpTo = function (catId) {
    if (typeof global.ledger !== 'undefined' && ledger.filterByCategory) {
      ledger.filterByCategory(catId);
    }
    global.showPage('ledger');
  };

  /* ---------------- 预算管理弹层 ---------------- */

  var editingBudget = null;

  B.openSheet = function () {
    var cats = fcDb.categoriesList();
    editingBudget = B.normalizeBudget(fcDb.getBudget(), cats);
    $('bud-enable').checked = editingBudget.enableSuggestions;
    renderBudgetEditor(editingBudget, cats);
    $('budget-sheet').classList.remove('hidden');
  };

  B.closeSheet = function () {
    $('budget-sheet').classList.add('hidden');
    editingBudget = null;
  };

  function renderBudgetEditor(b, cats) {
    var box = $('bud-rows');
    box.innerHTML = '';
    var expCats = B.expenseCategories(cats);
    expCats.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      row.innerHTML =
        '<span class="w-7 text-center">' + c.icon + '</span>' +
        '<span class="flex-1 text-sm text-slate-700">' + c.name + '</span>' +
        '<span class="text-xs text-slate-400">¥</span>' +
        '<input type="number" inputmode="numeric" min="0" data-cat="' + c.id + '"' +
        ' class="w-24 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-indigo-400"' +
        ' value="' + ((b.budgets[c.id] || 0) / 100) + '">';
      box.appendChild(row);
    });
  }

  /** 基于上月一键填充 */
  B.fillLastMonth = function () {
    var cats = fcDb.categoriesList();
    var monthKey = new Date().toISOString().slice(0, 7);
    var last = B.lastMonthExpenseByCat(visibleNonVault(), monthKey);
    var filled = B.fillFromLastMonth(B.expenseCategories(cats), last);
    editingBudget.budgets = filled.budgets;
    editingBudget.totalBudget = filled.totalBudget;
    renderBudgetEditor(editingBudget, cats);
    global.toast('已按上月支出×0.9 填充', 'success');
  };

  /** 按总预算比例分配（UI：弹prompt取总预算） */
  B.distributeByTotal = function () {
    var totalYuan = Number(prompt('输入本月总预算（元）：'));
    if (!totalYuan || totalYuan <= 0) return;
    var cats = fcDb.categoriesList();
    var monthKey = new Date().toISOString().slice(0, 7);
    var last = B.lastMonthExpenseByCat(visibleNonVault(), monthKey);
    var dist = B.distributeTotal(B.expenseCategories(cats), last, Math.round(totalYuan * 100));
    editingBudget.budgets = dist.budgets;
    editingBudget.totalBudget = dist.totalBudget;
    renderBudgetEditor(editingBudget, cats);
    global.toast('已按上月支出比例分配', 'success');
  };

  B.save = function () {
    if (!editingBudget) return;
    var inputs = $('bud-rows').querySelectorAll('input[data-cat]');
    inputs.forEach(function (inp) {
      var yuan = Number(inp.value) || 0;
      editingBudget.budgets[inp.getAttribute('data-cat')] = Math.max(0, Math.round(yuan * 100));
    });
    editingBudget.enableSuggestions = $('bud-enable').checked;
    var total = 0;
    Object.keys(editingBudget.budgets).forEach(function (id) { total += editingBudget.budgets[id]; });
    editingBudget.totalBudget = total;
    var r = fcDb.saveBudget(editingBudget);
    if (!r.ok) { global.toast(r.errors[0]); return; }
    B.closeSheet();
    global.toast('预算已保存', 'success');
    global.renderAll();
  };

  /* ---------------- 记账时实时预警 ---------------- */

  /** 在记一笔表单显示该分类预算提醒；amountYuan=null 时清空 */
  B.renderFormWarn = function (catId, amountYuan) {
    var el = $('f-budget-warn');
    if (!el) return;
    if (!catId || amountYuan == null || !(amountYuan > 0)) {
      el.innerHTML = '';
      el.className = 'hidden';
      return;
    }
    var budget = B.normalizeBudget(fcDb.getBudget(), fcDb.categoriesList());
    if (!budget.budgets[catId]) {
      el.innerHTML = '';
      el.className = 'hidden';
      return;
    }
    var monthKey = new Date().toISOString().slice(0, 7);
    var spent = B.monthExpenseByCat(visibleNonVault(), monthKey);
    var info = B.ifAddOver(budget, spent, catId, Math.round(amountYuan * 100));
    if (!info.warnLevel) {
      el.innerHTML = '';
      el.className = 'hidden';
      return;
    }
    var cfg = {
      warn: ['bg-amber-50 border-amber-200 text-amber-700', '⚠️ 接近超支'],
      over: ['bg-rose-50 border-rose-200 text-rose-700', '🔴 已超支'],
      severe: ['bg-rose-100 border-rose-300 text-rose-700 font-semibold', '🚨 严重超支']
    }[info.warnLevel];
    var msg = info.warnLevel === 'warn'
      ? '记这笔后本分类已花 ' + Math.round(info.pctAfter * 100) + '%，还剩 ¥' + fmtInt((budget.budgets[catId] || 0) - info.spentAfter)
      : '记这笔后将超支 ¥' + fmtInt(info.overAmount) + '，确认要记吗？';
    el.innerHTML = '<span>' + cfg[1] + '：' + msg + '</span>';
    el.className = 'rounded-xl border px-3 py-2 text-xs ' + cfg[0];
  };

  /* ---------------- 装配 ---------------- */

  B.bind = function () {
    $('budget-sheet-mask').addEventListener('click', B.closeSheet);
    $('bud-cancel').addEventListener('click', B.closeSheet);
    $('bud-save').addEventListener('click', B.save);
    $('bud-fill-last').addEventListener('click', B.fillLastMonth);
    $('bud-distribute').addEventListener('click', B.distributeByTotal);
  };

  global.fcBudget = B;
})(window);

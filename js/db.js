/* ============================================================
 * db.js — 数据层：LocalStorage 封装
 * 规范来源：docs/07-分模块PRD.md §2
 *  - 所有 key 统一前缀 fc_（finance-couple）
 *  - fc_schema_version 记录结构版本，启动时执行迁移
 *  - 金额一律以"分"（整数）存储，展示层负责格式化
 *  - 隐私过滤不在本层做（批次② privacy.js 纯函数统一取数）
 * ============================================================ */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;

  var KEYS = {
    version:      'fc_schema_version',
    settings:     'fc_settings',
    categories:   'fc_categories',
    accounts:     'fc_accounts',
    transactions: 'fc_transactions',
    settlements:  'fc_settlements'
  };

  var PRIVACY_LEVELS = ['public', 'private', 'vault'];
  var TX_TYPES = ['expense', 'income'];
  var MAX_AMOUNT_CENTS = 9999999900; // 99,999,999.99 元

  /* ---------------- 基础读写 ---------------- */

  function read(key) {
    try {
      var raw = localStorage.getItem(KEYS[key] || key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      console.error('[db] 读取失败:', key, e);
      return null;
    }
  }

  function write(key, value) {
    localStorage.setItem(KEYS[key] || key, JSON.stringify(value));
  }

  function removeKey(key) {
    localStorage.removeItem(KEYS[key] || key);
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- schema 迁移 ---------------- */

  function migrate() {
    var v = read('version');
    if (v === null) {
      write('version', SCHEMA_VERSION);
      return;
    }
    // 迁移链（后续版本在此追加）：v<2 时执行 xx 迁移……
    if (v < SCHEMA_VERSION) {
      write('version', SCHEMA_VERSION);
    }
  }

  /* ---------------- 预置数据 ---------------- */

  var PRESET_CATEGORIES = [
    { id: 'c_food',      name: '餐饮',     icon: '🍜', type: 'expense', builtin: true },
    { id: 'c_rent',      name: '房租水电', icon: '🏠', type: 'expense', builtin: true },
    { id: 'c_transport', name: '交通',     icon: '🚌', type: 'expense', builtin: true },
    { id: 'c_shopping',  name: '购物',     icon: '🛍️', type: 'expense', builtin: true },
    { id: 'c_fun',       name: '娱乐',     icon: '🎮', type: 'expense', builtin: true },
    { id: 'c_medical',   name: '医疗',     icon: '💊', type: 'expense', builtin: true },
    { id: 'c_gift',      name: '人情',     icon: '🎁', type: 'expense', builtin: true },
    { id: 'c_other',     name: '其他',     icon: '📦', type: 'expense', builtin: true },
    { id: 'c_salary',    name: '工资',     icon: '💼', type: 'income',  builtin: true },
    { id: 'c_invest',    name: '理财收益', icon: '📈', type: 'income',  builtin: true },
    { id: 'c_income_o',  name: '其他收入', icon: '💵', type: 'income',  builtin: true }
  ];

  /* ---------------- 初始化（07-PRD §2.4 三步向导落库） ---------------- */

  function isInitialized() {
    return read('settings') !== null;
  }

  /**
   * @param {Object} opts { familyName, members:[{name,emoji},{name,emoji}], ratio:{m1,m2} }
   */
  function init(opts) {
    if (isInitialized()) return { ok: false, errors: ['已初始化过，请勿重复初始化'] };
    var now = Date.now();
    var members = [
      { id: 'm1', name: (opts.members[0] && opts.members[0].name) || '成员A', emoji: (opts.members[0] && opts.members[0].emoji) || '🧑' },
      { id: 'm2', name: (opts.members[1] && opts.members[1].name) || '成员B', emoji: (opts.members[1] && opts.members[1].emoji) || '👩' }
    ];
    var r1 = (opts.ratio && typeof opts.ratio.m1 === 'number') ? opts.ratio.m1 : 50;
    write('settings', {
      familyName: opts.familyName || '我们的家',
      members: members,
      currentViewer: 'm1',
      splitRule: {
        defaultRatio: { m1: r1, m2: 100 - r1 },
        categoryOverrides: {}
      },
      tier: 'family',           // 商业化模拟：默认家庭会员版（07-PRD §9）
      encryptionEnabled: false, // 批次⑤：WebCrypto 加密开关
      createdAt: now,
      updatedAt: now
    });
    write('categories', PRESET_CATEGORIES);
    write('accounts', [
      { id: 'acc_common',   name: '共同账户', type: 'shared', ownerId: null },
      { id: 'acc_vault_m1', name: members[0].name + '的小金库', type: 'vault', ownerId: 'm1' },
      { id: 'acc_vault_m2', name: members[1].name + '的小金库', type: 'vault', ownerId: 'm2' }
    ]);
    write('transactions', []);
    write('settlements', []);
    return { ok: true };
  }

  /* ---------------- 设置 / 成员 / 身份 ---------------- */

  function getSettings() {
    return read('settings');
  }

  function patchSettings(patch) {
    var s = read('settings');
    if (!s) return { ok: false, errors: ['尚未初始化'] };
    Object.keys(patch).forEach(function (k) {
      if (k === 'members' || k === 'currentViewer' || k === 'splitRule' || k === 'createdAt') return; // 关键字段走专用接口
      s[k] = patch[k];
    });
    s.updatedAt = Date.now();
    write('settings', s);
    return { ok: true };
  }

  function findMember(id) {
    var s = read('settings');
    if (!s) return null;
    return s.members.filter(function (m) { return m.id === id; })[0] || null;
  }

  function getVaultOf(memberId) {
    var accs = read('accounts') || [];
    return accs.filter(function (a) { return a.type === 'vault' && a.ownerId === memberId; })[0] || null;
  }

  /** 切换查看人（07-PRD §3：所有页面数据按新查看人过滤重算） */
  function switchViewer(memberId) {
    var s = read('settings');
    if (!s) return { ok: false, errors: ['尚未初始化'] };
    if (!findMember(memberId)) return { ok: false, errors: ['成员不存在'] };
    s.currentViewer = memberId;
    s.updatedAt = Date.now();
    write('settings', s);
    return { ok: true };
  }

  function getCurrentViewer() {
    var s = read('settings');
    return s ? s.currentViewer : null;
  }

  /* ---------------- 交易（07-PRD §2.2 字段约束） ---------------- */

  /**
   * 单笔交易校验，返回 null 表示合法，否则返回错误文案
   * @param ctx 可选：导入备份时传入 { members, accounts }（此时备份尚未写入，校验须用备份数据而非当前存储）
   */
  function validateTx(tx, ctx) {
    if (typeof tx.amount !== 'number' || !isFinite(tx.amount) || tx.amount <= 0 || tx.amount > MAX_AMOUNT_CENTS) {
      return '金额必须是大于0且不超过9999万元的整数（分）';
    }
    if (TX_TYPES.indexOf(tx.type) < 0) return '收支类型非法';
    if (PRIVACY_LEVELS.indexOf(tx.privacy) < 0) return '隐私层级非法';
    var members = (ctx && ctx.members) || null;
    var ownerOk = members
      ? members.some(function (m) { return m.id === tx.ownerId; })
      : !!findMember(tx.ownerId);
    if (!tx.ownerId || !ownerOk) return '归属人不存在';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date || '')) return '日期格式应为 YYYY-MM-DD';
    if (tx.privacy === 'vault') {
      var accs = (ctx && ctx.accounts) || read('accounts') || [];
      var acc = accs.filter(function (a) { return a.id === tx.vaultId; })[0];
      if (!acc || acc.type !== 'vault') return '小金库账户不存在';
      if (acc.ownerId !== tx.ownerId) return '小金库账目必须归属本人';
      if (tx.shared) return '小金库账目不参与共同分摊';
    }
    if (tx.privacy === 'private' && tx.shared) return '单笔私密账目不参与共同分摊';
    return null;
  }

  /* ---------------- 分摊规则（07-PRD §6.1，专用接口） ---------------- */

  /** 校验 {m1,m2} 比例：整数、和为100 */
  function validRatio(r) {
    return !!r &&
      Number.isInteger(r.m1) && Number.isInteger(r.m2) &&
      r.m1 >= 0 && r.m2 >= 0 && r.m1 + r.m2 === 100;
  }

  /**
   * 更新分摊规则（改动只对新账目生效，不追溯历史）
   * @param rule { defaultRatio?: {m1,m2}, categoryOverrides?: { [categoryId]: {m1,m2}|null } } null=删除覆盖
   */
  function setSplitRule(rule) {
    var s = read('settings');
    if (!s) return { ok: false, errors: ['尚未初始化'] };
    s.splitRule = s.splitRule || { defaultRatio: { m1: 50, m2: 50 }, categoryOverrides: {} };
    if (rule.defaultRatio !== undefined) {
      if (!validRatio(rule.defaultRatio)) return { ok: false, errors: ['默认比例之和必须为100%'] };
      s.splitRule.defaultRatio = rule.defaultRatio;
    }
    if (rule.categoryOverrides) {
      s.splitRule.categoryOverrides = s.splitRule.categoryOverrides || {};
      var cats = read('categories') || [];
      for (var cid in rule.categoryOverrides) {
        if (!rule.categoryOverrides.hasOwnProperty(cid)) continue;
        if (rule.categoryOverrides[cid] === null) {
          delete s.splitRule.categoryOverrides[cid];
          continue;
        }
        if (!cats.some(function (c) { return c.id === cid; })) return { ok: false, errors: ['分类不存在：' + cid] };
        if (!validRatio(rule.categoryOverrides[cid])) return { ok: false, errors: ['覆盖比例之和必须为100%'] };
        s.splitRule.categoryOverrides[cid] = rule.categoryOverrides[cid];
      }
    }
    s.updatedAt = Date.now();
    write('settings', s);
    return { ok: true };
  }

  /* ---------------- 结算记录（07-PRD §6.2/6.3） ---------------- */

  var settlements = {
    list: function () { return read('settlements') || []; },

    /** 某月的有效结算（void 作废记录不算） */
    findByMonth: function (month) {
      return (read('settlements') || []).filter(function (s) {
        return s.month === month && s.status !== 'void';
      })[0] || null;
    },

    /**
     * 确认结算（锁定当月账目）
     * @param result fcSplit.monthSettlement 的返回值
     */
    add: function (month, result) {
      if (settlements.findByMonth(month)) return { ok: false, errors: ['该月已存在有效结算记录，请先作废'] };
      var rec = {
        id: uid('s'),
        month: month,
        status: 'confirmed',           // confirmed → settled | void
        from: result.transfer ? result.transfer.from : null,
        to: result.transfer ? result.transfer.to : null,
        amount: result.transfer ? result.transfer.amount : 0,
        itemsCount: result.items.length,
        totalShare: result.shares,
        createdAt: Date.now(),
        confirmedAt: Date.now(),
        settledAt: null,
        voidedAt: null
      };
      var list = read('settlements') || [];
      list.push(rec);
      write('settlements', list);
      return { ok: true, record: rec };
    },

    setStatus: function (id, status) {
      var list = read('settlements') || [];
      var rec = list.filter(function (s) { return s.id === id; })[0];
      if (!rec) return { ok: false, errors: ['结算记录不存在'] };
      if (status !== 'settled' && status !== 'void') return { ok: false, errors: ['非法状态'] };
      if (rec.status === 'void') return { ok: false, errors: ['该记录已作废'] };
      if (status === 'settled' && rec.status === 'settled') return { ok: false, errors: ['该月已标记结清'] };
      rec.status = status;
      if (status === 'settled') rec.settledAt = Date.now();
      if (status === 'void') rec.voidedAt = Date.now();
      write('settlements', list);
      return { ok: true, record: rec };
    }
  };

  /** 已确认结算月份的账目写操作拦截（07-PRD §6.3.5） */
  function settlementLockError(date) {
    var s = date ? settlements.findByMonth(String(date).slice(0, 7)) : null;
    return s ? '该月（' + s.month + '）已确认结算，如需修改请先在结算页作废本月结算' : null;
  }

  /** 落账时刻生效的分摊比例（类别覆盖优先→默认）。固化到交易上，规则后续改动不追溯（07-PRD §6.1） */
  function effectiveRatio(categoryId) {
    var s = read('settings');
    var rule = (s && s.splitRule) || {};
    var ov = (rule.categoryOverrides || {})[categoryId];
    var r = ov || rule.defaultRatio || { m1: 50, m2: 50 };
    return { m1: r.m1, m2: r.m2 };
  }

  var tx = {
    /** 返回全量交易（原始数据，不做隐私过滤——过滤统一在 privacy.js） */
    list: function () {
      return read('transactions') || [];
    },

    /**
     * 新增交易
     * @param {Object} data { date, type, amount(分), categoryId, ownerId, privacy, vaultId?, shared?, note? }
     */
    add: function (data) {
      var rec = {
        id: uid('t'),
        date: data.date,
        type: data.type,
        amount: data.amount,
        categoryId: data.categoryId,
        ownerId: data.ownerId,
        privacy: data.privacy || 'public',
        vaultId: data.vaultId || null,
        splitRatio: effectiveRatio(data.categoryId), // 固化落账时比例（结算不追溯规则改动）
        // 默认分摊规则：仅 public 支出参与；private/vault 强制不参与（07-PRD §2.2）
        shared: data.privacy === 'public' && data.type === 'expense'
          ? (data.shared !== false)
          : false,
        note: (data.note || '').slice(0, 50),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      var err = validateTx(rec);
      if (err) return { ok: false, errors: [err] };
      var lock = settlementLockError(rec.date); // 已结算月份禁止补录（保证结算完整性）
      if (lock) return { ok: false, errors: [lock] };
      var list = read('transactions') || [];
      list.push(rec);
      write('transactions', list);
      return { ok: true, record: rec };
    },

    /** 更新交易（patch 合并后重新校验） */
    update: function (id, patch) {
      var list = read('transactions') || [];
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (list[i].id === id) { idx = i; break; } }
      if (idx < 0) return { ok: false, errors: ['交易不存在'] };
      var rec = list[idx];
      Object.keys(patch).forEach(function (k) {
        if (k === 'id' || k === 'createdAt') return;
        rec[k] = patch[k];
      });
      rec.updatedAt = Date.now();
      // 换分类时按当前规则重解析比例（本笔视为"新账"）
      if (patch.categoryId !== undefined) rec.splitRatio = effectiveRatio(rec.categoryId);
      // shared 与 privacy/type 的强制约束随更新重算
      if (rec.privacy !== 'public' || rec.type !== 'expense') rec.shared = false;
      var err = validateTx(rec);
      if (err) return { ok: false, errors: [err] };
      // 原所属月与调整后月份任一已结算都需拦截（07-PRD §6.3.5）
      var lock = settlementLockError(list[idx].date) || settlementLockError(rec.date);
      if (lock) return { ok: false, errors: [lock] };
      list[idx] = rec;
      write('transactions', list);
      return { ok: true, record: rec };
    },

    remove: function (id) {
      var list = read('transactions') || [];
      var t = list.filter(function (x) { return x.id === id; })[0];
      if (!t) return { ok: false, errors: ['交易不存在'] };
      var lock = settlementLockError(t.date);
      if (lock) return { ok: false, errors: [lock] };
      write('transactions', list.filter(function (x) { return x.id !== id; }));
      return { ok: true };
    }
  };

  /* ---------------- 分类 / 账户 ---------------- */

  function categoriesList() { return read('categories') || []; }
  function accountsList() { return read('accounts') || []; }

  /* ---------------- 备份 / 导入 / 重置（07-PRD §8） ---------------- */

  function exportAll() {
    return JSON.stringify({
      app: 'finance-couple-assistant',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        settings: read('settings'),
        categories: read('categories'),
        accounts: read('accounts'),
        transactions: read('transactions'),
        settlements: read('settlements')
      }
    }, null, 2);
  }

  function importAll(jsonText) {
    var obj = null;
    try { obj = JSON.parse(jsonText); } catch (e) { return { ok: false, errors: ['JSON 解析失败，文件已损坏'] }; }
    if (!obj || obj.app !== 'finance-couple-assistant' || !obj.data) {
      return { ok: false, errors: ['不是本应用的备份文件'] };
    }
    if (obj.schemaVersion !== SCHEMA_VERSION) {
      return { ok: false, errors: ['备份版本(' + obj.schemaVersion + ')与当前版本(' + SCHEMA_VERSION + ')不一致，暂不支持导入'] };
    }
    var errors = [];
    ['settings', 'categories', 'accounts', 'transactions', 'settlements'].forEach(function (k) {
      if (!obj.data[k]) errors.push('备份缺少 ' + k + ' 数据');
    });
    if (errors.length) return { ok: false, errors: errors };
    (obj.data.transactions || []).forEach(function (t, i) {
      // 用备份自带数据校验（此时备份尚未写入，当前存储不可依赖）
      var err = validateTx(t, { accounts: obj.data.accounts, members: obj.data.settings.members });
      if (err) errors.push('第' + (i + 1) + '笔账目非法：' + err);
    });
    if (errors.length) return { ok: false, errors: errors };
    write('settings', obj.data.settings);
    write('categories', obj.data.categories);
    write('accounts', obj.data.accounts);
    write('transactions', obj.data.transactions);
    write('settlements', obj.data.settlements);
    return { ok: true };
  }

  /** 清空本应用全部数据（设置页需输入 DELETE 确认后调用） */
  function resetAll() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('fc_') === 0) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
    return { ok: true, removed: keys.length };
  }

  /* ---------------- 数据体检（批次①自测用） ---------------- */

  function healthCheck() {
    var list = read('transactions') || [];
    var bad = 0;
    list.forEach(function (t) { if (validateTx(t)) bad++; });
    return {
      transactions: list.length,
      invalid: bad,
      members: (read('settings') || { members: [] }).members.length,
      categories: (read('categories') || []).length,
      accounts: (read('accounts') || []).length,
      storageKB: Math.round((JSON.stringify(localStorage).length) / 1024 * 10) / 10
    };
  }

  /* ---------------- 导出 API ---------------- */

  global.fcDb = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    migrate: migrate,
    isInitialized: isInitialized,
    init: init,
    getSettings: getSettings,
    patchSettings: patchSettings,
    findMember: findMember,
    getVaultOf: getVaultOf,
    switchViewer: switchViewer,
    getCurrentViewer: getCurrentViewer,
    setSplitRule: setSplitRule,
    settlements: settlements,
    tx: tx,
    categoriesList: categoriesList,
    accountsList: accountsList,
    exportAll: exportAll,
    importAll: importAll,
    resetAll: resetAll,
    healthCheck: healthCheck
  };
})(window);

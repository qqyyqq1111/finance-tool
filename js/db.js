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

  var SCHEMA_VERSION = 2;

  var KEYS = {
    version:      'fc_schema_version',
    device:       'fc_device_id',
    settings:     'fc_settings',
    categories:   'fc_categories',
    accounts:     'fc_accounts',
    transactions: 'fc_transactions',
    settlements:  'fc_settlements',
    cryptoMeta:   'fc_crypto_meta'
  };

  var PRIVACY_LEVELS = ['public', 'private', 'vault'];
  var TX_TYPES = ['expense', 'income'];
  var MAX_AMOUNT_CENTS = 9999999900; // 99,999,999.99 元

  /* ---------------- 加密会话（批次⑤，07-PRD §2.1） ----------------
   * 交易/结算在加密开启后以密文存 LocalStorage；明文只存在于解锁后的内存会话。
   * 设置/分类/账户不加密（PRD：设置元数据不加密）。 */
  var CRYPTO_KEYS = ['transactions', 'settlements'];
  var sessionCache = null; // { transactions:[], settlements:[] }，仅解锁后存在

  function encryptionOn() {
    var s = rawRead('settings');
    return !!(s && s.encryptionEnabled === true);
  }

  /* ---------------- 基础读写 ---------------- */

  function rawRead(key) {
    try {
      var raw = localStorage.getItem(KEYS[key] || key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      console.error('[db] 读取失败:', key, e);
      return null;
    }
  }

  function rawWrite(key, value) {
    localStorage.setItem(KEYS[key] || key, JSON.stringify(value));
  }

  function rawRemove(key) {
    localStorage.removeItem(KEYS[key] || key);
  }

  function read(key) {
    // 加密键：开启加密后只从内存会话读（未解锁返回空，密文绝不反序列化为业务数据）
    if (CRYPTO_KEYS.indexOf(key) >= 0 && encryptionOn()) {
      if (!sessionCache) return key === 'transactions' ? [] : [];
      return sessionCache[key] === undefined ? null : sessionCache[key];
    }
    return rawRead(key);
  }

  function write(key, value) {
    if (CRYPTO_KEYS.indexOf(key) >= 0 && encryptionOn()) {
      if (!sessionCache) { console.warn('[db] 加密未解锁，写入被忽略:', key); return; }
      sessionCache[key] = value;
      if (global.fcCrypto && global.fcCrypto.persistSoon) global.fcCrypto.persistSoon();
    } else {
      rawWrite(key, value);
    }
    // v1.1 同步调度：本地写入后 debounce 3s 触发 push
    if (global.fcSync && typeof global.fcSync.scheduleSync === 'function') {
      global.fcSync.scheduleSync();
    }
  }

  function removeKey(key) { rawRemove(key); }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- v1.1 同步字段（schema v2，09-PRD §5.1） ----------------
   * 每条可同步记录带：updatedAt(LWW时间戳) / deviceId(写入设备) / deleted(墓碑) / _sync(dirty|clean)
   * deviceId 标识"本安装实例"，迁移/写入时自动补齐；同步引擎 sync.js 按 _sync 推云端。 */

  function getDeviceId() {
    var d = rawRead('device');
    if (d && typeof d === 'string') return d;
    d = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    rawWrite('device', d);
    return d;
  }

  /** 纯函数：给单条记录补同步字段（幂等，已存在不覆盖） */
  function stampSyncV2(rec, deviceId, now) {
    if (!rec || typeof rec !== 'object') return rec;
    if (typeof rec.updatedAt !== 'number') rec.updatedAt = typeof rec.createdAt === 'number' ? rec.createdAt : now;
    if (!rec.deviceId) rec.deviceId = deviceId;
    if (typeof rec.deleted !== 'boolean') rec.deleted = false;
    if (rec._sync !== 'clean') rec._sync = 'dirty'; // 存量/新记录首次联网全量上传
    return rec;
  }

  /** 纯函数：迁移一个集合（返回新数组，仅补字段不改业务数据） */
  function migrateCollectionV2(list, deviceId, now) {
    if (!Array.isArray(list)) return list;
    list.forEach(function (rec) { stampSyncV2(rec, deviceId, now); });
    return list;
  }

  /* ---------------- schema 迁移 ---------------- */

  function migrate() {
    var v = read('version');
    if (v === null) {
      write('version', SCHEMA_VERSION);
      return;
    }
    // 迁移链：v1 → v2（同步字段补齐）
    if (v < 2) {
      var deviceId = getDeviceId();
      var now = Date.now();
      // 加密态未解锁时 read 返回空——迁移改在解锁 setSession 后补做（见 _cryptoBridge.setSession）
      if (!encryptionOn() || sessionCache) {
        // 注意：read() 每次都重新反序列化，必须先取引用、补齐、再写回同一数组
        var txs = read('transactions') || [];
        var sts = read('settlements') || [];
        var cats = read('categories') || [];
        migrateCollectionV2(txs, deviceId, now);
        migrateCollectionV2(sts, deviceId, now);
        migrateCollectionV2(cats, deviceId, now);
        write('transactions', txs);
        write('settlements', sts);
        write('categories', cats);
      }
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
    // 预置分类打同步字段（内容固定双方自带、不推送；hidden 状态变更置 dirty 后同步）
    var presetCats = PRESET_CATEGORIES.map(function (c) {
      return { id: c.id, name: c.name, icon: c.icon, type: c.type, builtin: true,
               hidden: false, createdAt: now, updatedAt: now, deviceId: getDeviceId(),
               deleted: false, _sync: 'clean' };
    });
    write('categories', presetCats);
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
        voidedAt: null,
        deviceId: getDeviceId(),
        deleted: false,
        _sync: 'dirty'
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
      rec.updatedAt = Date.now();
      rec.deviceId = getDeviceId();
      rec._sync = 'dirty';
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
        updatedAt: Date.now(),
        deviceId: getDeviceId(),
        deleted: false,
        _sync: 'dirty'
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

  /* ---------------- 成员管理（07-PRD §8：可改名/emoji；不可增删） ---------------- */

  function updateMember(memberId, patch) {
    var s = read('settings');
    if (!s) return { ok: false, errors: ['尚未初始化'] };
    var m = s.members.filter(function (x) { return x.id === memberId; })[0];
    if (!m) return { ok: false, errors: ['成员不存在'] };
    if (patch.name !== undefined) {
      var name = String(patch.name || '').trim();
      if (!name) return { ok: false, errors: ['昵称不能为空'] };
      if (name.length > 6) return { ok: false, errors: ['昵称不超过6个字'] };
      m.name = name;
    }
    if (patch.emoji !== undefined) {
      if (String(patch.emoji).length === 0) return { ok: false, errors: ['表情不能为空'] };
      m.emoji = String(patch.emoji).slice(0, 4);
    }
    s.updatedAt = Date.now();
    write('settings', s);
    return { ok: true };
  }

  /* ---------------- 分类管理（07-PRD §8：预置可隐藏不可删；自定义≤12） ---------------- */

  var CUSTOM_ICONS = ['📦', '🧾', '💳', '☕', '🎬', '✈️', '📚', '💄', '🐱', '🎁'];

  var categories = {
    add: function (data) {
      var cats = read('categories') || [];
      var customCount = cats.filter(function (c) { return !c.builtin; }).length;
      if (customCount >= 12) return { ok: false, errors: ['自定义分类最多12个'] };
      var name = String(data.name || '').trim();
      if (!name) return { ok: false, errors: ['分类名称不能为空'] };
      if (name.length > 5) return { ok: false, errors: ['分类名不超过5个字'] };
      if (TX_TYPES.indexOf(data.type) < 0) return { ok: false, errors: ['类型非法'] };
      if (cats.some(function (c) { return c.name === name && c.type === data.type; })) {
        return { ok: false, errors: ['已存在同名分类'] };
      }
      var rec = {
        id: uid('c'),
        name: name,
        icon: data.icon || CUSTOM_ICONS[customCount % CUSTOM_ICONS.length],
        type: data.type,
        builtin: false,
        hidden: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deviceId: getDeviceId(),
        deleted: false,
        _sync: 'dirty'
      };
      cats.push(rec);
      write('categories', cats);
      return { ok: true, record: rec };
    },

    /** 隐藏/恢复（预置与自定义均可；隐藏后不出现在记账选择，历史账目仍正常显示） */
    setHidden: function (id, hidden) {
      var cats = read('categories') || [];
      var c = cats.filter(function (x) { return x.id === id; })[0];
      if (!c) return { ok: false, errors: ['分类不存在'] };
      c.hidden = !!hidden;
      c.updatedAt = Date.now();
      c.deviceId = getDeviceId();
      c._sync = 'dirty';
      write('categories', cats);
      return { ok: true };
    },

    /** 删除：仅自定义且无交易引用（预置分类禁止删除） */
    remove: function (id) {
      var cats = read('categories') || [];
      var c = cats.filter(function (x) { return x.id === id; })[0];
      if (!c) return { ok: false, errors: ['分类不存在'] };
      if (c.builtin) return { ok: false, errors: ['预置分类不可删除，可隐藏'] };
      var used = (read('transactions') || []).some(function (t) { return t.categoryId === id; });
      if (used) return { ok: false, errors: ['该分类已有账目，不可删除（可隐藏）'] };
      write('categories', cats.filter(function (x) { return x.id !== id; }));
      return { ok: true };
    }
  };

  /* ---------------- 版本模式（07-PRD §9 商业化分层模拟） ---------------- */

  function setTier(tier) {
    if (tier !== 'free' && tier !== 'family') return { ok: false, errors: ['非法版本'] };
    var r = patchSettings({ tier: tier });
    return r;
  }

  /* ---------------- 备份 / 导入 / 重置（07-PRD §8） ---------------- */

  function exportAll() {
    var enc = encryptionOn();
    return JSON.stringify({
      app: 'finance-couple-assistant',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      encryptionNote: enc ? '导出时处于加密状态：本文件内账目为明文JSON，请妥善保管；导入后加密为关闭状态，可重新开启' : undefined,
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
    // 加密态导入：备份统一为明文落地，导入后加密重置为关闭（需重新开启）
    if (encryptionOn() && !sessionCache) {
      return { ok: false, errors: ['数据已加密，请先解锁后再导入'] };
    }
    obj.data.settings.encryptionEnabled = false;
    sessionCache = null;
    rawRemove('cryptoMeta');
    // 导入数据补 v2 同步字段并强制标 dirty（恢复到本设备后需重新推送云端合并，09-PRD §6）
    var importDevice = getDeviceId(), importNow = Date.now();
    [obj.data.transactions || [], obj.data.settlements || [], obj.data.categories || []].forEach(function (list) {
      migrateCollectionV2(list, importDevice, importNow);
      list.forEach(function (rec) { rec._sync = 'dirty'; });
    });
    rawWrite('settings', obj.data.settings);
    rawWrite('categories', obj.data.categories);
    rawWrite('accounts', obj.data.accounts);
    rawWrite('transactions', obj.data.transactions);
    rawWrite('settlements', obj.data.settlements);
    rawWrite('version', SCHEMA_VERSION);
    return { ok: true, reload: true };
  }

  /** 清空本应用全部数据（设置页需输入 DELETE 确认后调用） */
  function resetAll() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('fc_') === 0) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
    sessionCache = null;
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
    updateMember: updateMember,
    categories: categories,
    setTier: setTier,
    tx: tx,
    categoriesList: categoriesList,
    accountsList: accountsList,
    exportAll: exportAll,
    importAll: importAll,
    resetAll: resetAll,
    healthCheck: healthCheck,
    /* v1.1 同步基础设施（09-PRD §5.1；sync.js 批次⑧使用） */
    getDeviceId: getDeviceId,
    stampSyncV2: stampSyncV2,
    migrateCollectionV2: migrateCollectionV2,
    /* 加密桥接原语（供 crypto.js 使用，业务代码勿直接调用） */
    _cryptoBridge: {
      isOn: encryptionOn,
      setSession: function (cache) {
        sessionCache = cache;
        // 解锁后补做 v1→v2 迁移（加密态 migrate() 时明文尚在密文里，读不到）
        var v = rawRead('version');
        if (v !== null && v < 2) {
          var deviceId = getDeviceId(), now = Date.now();
          migrateCollectionV2(sessionCache.transactions || [], deviceId, now);
          migrateCollectionV2(sessionCache.settlements || [], deviceId, now);
          var cats = rawRead('categories') || [];
          migrateCollectionV2(cats, deviceId, now);
          rawWrite('categories', cats);
          if (global.fcCrypto && global.fcCrypto.persistSoon) global.fcCrypto.persistSoon();
          rawWrite('version', SCHEMA_VERSION);
        }
      },
      clearSession: function () { sessionCache = null; },
      getSession: function () { return sessionCache; },
      rawRead: rawRead,
      rawWrite: rawWrite,
      rawRemove: rawRemove
    }
  };
})(window);

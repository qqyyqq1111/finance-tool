/* ============================================================
 * privacy.js — 三层隐私过滤（纯函数，可单测）
 * 规范来源：docs/07-分模块PRD.md §5
 *  - Layer 1 public  公开：所有人完整可见，参与共同分摊
 *  - Layer 2 private 单笔私密：非本人仅见"存在私密记录"占位，不进统计不分摊
 *  - Layer 3 vault   小金库：对非本人完全无痕（无记录/无占位/无余额/无卡片）
 *
 * ⚠️ 红线（07-PRD §5.4）：所有页面取数必须经本文件，禁止页面自行过滤
 * ============================================================ */
(function (global) {
  'use strict';

  var P = {};

  /** 该交易对 viewer 是否"存在"（vault 对非本人 = 不存在） */
  P.exists = function (tx, viewerId) {
    return !(tx.privacy === 'vault' && tx.ownerId !== viewerId);
  };

  /** 该交易对 viewer 是否完整可读（含金额/分类/备注） */
  P.isReadable = function (tx, viewerId) {
    if (!P.exists(tx, viewerId)) return false;
    if (tx.privacy === 'private' && tx.ownerId !== viewerId) return false;
    return true;
  };

  /**
   * 核心视图：把全量交易拆成「可读」与「私密占位」两组（按日期倒序）
   * @returns {{ visible: Array, placeholders: Array }}
   */
  P.view = function (transactions, viewerId) {
    var visible = [];
    var placeholders = [];
    (transactions || []).forEach(function (t) {
      if (!P.exists(t, viewerId)) return;
      if (P.isReadable(t, viewerId)) visible.push(t);
      else placeholders.push(t);
    });
    var cmp = function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.createdAt || 0) < (b.createdAt || 0) ? 1 : -1;
    };
    visible.sort(cmp);
    placeholders.sort(cmp);
    return { visible: visible, placeholders: placeholders };
  };

  /** 指定月份（YYYY-MM）的视图 */
  P.monthView = function (transactions, viewerId, month) {
    var v = P.view(transactions, viewerId);
    var inMonth = function (t) { return (t.date || '').indexOf(month) === 0; };
    return {
      visible: v.visible.filter(inMonth),
      placeholders: v.placeholders.filter(inMonth)
    };
  };

  /** 月份汇总（只含可读交易——07-PRD §5.3 统计口径，防数据泄露） */
  P.monthTotals = function (transactions, viewerId, month) {
    var mv = P.monthView(transactions, viewerId, month);
    var income = 0;
    var expense = 0;
    mv.visible.forEach(function (t) {
      if (t.type === 'income') income += t.amount;
      else expense += t.amount;
    });
    return { income: income, expense: expense, balance: income - expense };
  };

  /** 我的小金库视图（仅本人调用）：独立余额 = 存入(收入) - 支出 */
  P.vaultView = function (transactions, viewerId) {
    var list = [];
    var balance = 0;
    (transactions || []).forEach(function (t) {
      if (t.privacy !== 'vault' || t.ownerId !== viewerId) return;
      list.push(t);
      balance += t.type === 'income' ? t.amount : -t.amount;
    });
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { list: list, balance: balance };
  };

  /** 隐私层级展示名 */
  P.label = {
    public: '公开',
    private: '单笔私密',
    vault: '小金库'
  };

  global.fcPrivacy = P;
})(window);

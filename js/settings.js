/* ============================================================
 * settings.js — 设置页 / 身份切换 / 数据备份 / 开发者自测
 * 批次① 范围（06-路线图批次①）：身份切换 + 数据层自测
 * ============================================================ */
(function (global) {
  'use strict';

  var S = {};

  /* ---------------- 身份切换（07-PRD §3） ---------------- */

  /** 顶部头像 chip */
  S.renderViewerChip = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var me = fcDb.findMember(s.currentViewer);
    if (!me) return;
    document.getElementById('viewer-emoji').textContent = me.emoji;
    document.getElementById('viewer-name').textContent = me.name;
  };

  /** 设置页「双人身份」卡片 */
  S.renderMemberCards = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var box = document.getElementById('settings-members');
    box.innerHTML = '';
    s.members.forEach(function (m) {
      var active = m.id === s.currentViewer;
      var btn = document.createElement('button');
      btn.className = 'rounded-2xl border p-4 text-left transition ' +
        (active ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50');
      btn.innerHTML =
        '<span class="text-3xl">' + m.emoji + '</span>' +
        '<p class="mt-1 font-medium text-slate-800">' + m.name + (active ? ' <span class="text-[10px] text-indigo-500">当前查看</span>' : '') + '</p>';
      btn.addEventListener('click', function () { S.switchViewer(m.id); });
      box.appendChild(btn);
    });
  };

  /** 底部弹层选项 */
  S.renderViewerSheet = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var box = document.getElementById('viewer-options');
    box.innerHTML = '';
    s.members.forEach(function (m) {
      var active = m.id === s.currentViewer;
      var btn = document.createElement('button');
      btn.className = 'w-full flex items-center gap-3 rounded-2xl border p-3.5 text-left transition ' +
        (active ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50');
      btn.innerHTML =
        '<span class="text-2xl">' + m.emoji + '</span>' +
        '<span class="flex-1 font-medium text-slate-800">' + m.name + '</span>' +
        (active ? '<span class="text-xs text-indigo-500">✓ 当前</span>' : '<span class="text-xs text-slate-300">切换</span>');
      btn.addEventListener('click', function () { S.switchViewer(m.id); });
      box.appendChild(btn);
    });
  };

  S.openViewerSheet = function () {
    S.renderViewerSheet();
    document.getElementById('viewer-sheet').classList.remove('hidden');
  };

  S.closeViewerSheet = function () {
    document.getElementById('viewer-sheet').classList.add('hidden');
  };

  /** 切换查看人：写库 → 全页面重算渲染（07-PRD §3 验收） */
  S.switchViewer = function (memberId) {
    var r = fcDb.switchViewer(memberId);
    if (!r.ok) { global.toast(r.errors[0]); return; }
    S.closeViewerSheet();
    var me = fcDb.findMember(memberId);
    global.toast('已切换为 ' + me.name + ' 的视角');
    global.renderAll();
  };

  /* ---------------- 数据备份（07-PRD §8） ---------------- */

  S.exportJson = function () {
    var text = fcDb.exportAll();
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'finance-couple-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    global.toast('备份已导出，请妥善保存');
  };

  S.importJson = function (file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var r = fcDb.importAll(String(reader.result));
      if (!r.ok) { global.toast('导入失败：' + r.errors[0]); return; }
      global.toast('导入成功');
      setTimeout(function () { location.reload(); }, 600);
    };
    reader.readAsText(file, 'utf-8');
  };

  /* ---------------- 开发者自测（批次①验收工具） ---------------- */

  var DEMO_TX = [
    { type: 'expense', privacy: 'public',  note: '示例：一起吃火锅（公开·参与分摊）' },
    { type: 'expense', privacy: 'private', note: '示例：给对方买礼物（单笔私密）' },
    { type: 'expense', privacy: 'vault',   note: '示例：偷偷存小金库（完全隐藏）' },
    { type: 'income',  privacy: 'public',  note: '示例：发工资啦' }
  ];

  S.seedDemo = function () {
    var s = fcDb.getSettings();
    var today = new Date().toISOString().slice(0, 10);
    var results = DEMO_TX.map(function (d, i) {
      var ownerId = s.members[i % 2].id;
      var data = {
        date: today,
        type: d.type,
        amount: 12800 + i * 1000, // 128元 起
        categoryId: d.type === 'income' ? 'c_salary' : 'c_food',
        ownerId: ownerId,
        privacy: d.privacy,
        note: d.note
      };
      if (d.privacy === 'vault') data.vaultId = fcDb.getVaultOf(ownerId).id;
      return fcDb.tx.add(data);
    });
    var okCount = results.filter(function (r) { return r.ok; }).length;
    global.toast('示例账目写入 ' + okCount + '/' + DEMO_TX.length + ' 笔（明细列表批次②上线）');
  };

  S.healthCheck = function () {
    var h = fcDb.healthCheck();
    var box = document.getElementById('check-result');
    box.textContent = '账目 ' + h.transactions + ' 笔（非法 ' + h.invalid + ' 笔）｜成员 ' + h.members +
      '｜分类 ' + h.categories + '｜账户 ' + h.accounts + '｜存储占用 ' + h.storageKB + ' KB';
    box.classList.remove('hidden');
    global.toast(h.invalid === 0 ? '体检通过 ✓' : '发现非法数据！');
  };

  S.resetAll = function () {
    var input = global.prompt('此操作将清空本设备全部账本数据且无法恢复。\n输入 DELETE 确认：');
    if (input !== 'DELETE') { global.toast('已取消'); return; }
    fcDb.resetAll();
    location.reload();
  };

  /* ---------------- 装配 ---------------- */

  S.bind = function () {
    document.getElementById('viewer-chip').addEventListener('click', S.openViewerSheet);
    document.getElementById('viewer-sheet-mask').addEventListener('click', S.closeViewerSheet);
    document.getElementById('btn-export').addEventListener('click', S.exportJson);
    document.getElementById('file-import').addEventListener('change', function (e) {
      S.importJson(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('btn-seed').addEventListener('click', S.seedDemo);
    document.getElementById('btn-check').addEventListener('click', S.healthCheck);
    document.getElementById('btn-reset').addEventListener('click', S.resetAll);
  };

  global.settingsUI = S;
})(window);

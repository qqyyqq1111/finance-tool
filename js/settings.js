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

  /** 设置页「双人身份」卡片（点击切换身份；铅笔编辑资料） */
  S.renderMemberCards = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var box = document.getElementById('settings-members');
    box.innerHTML = '';
    s.members.forEach(function (m) {
      var active = m.id === s.currentViewer;
      var btn = document.createElement('div');
      btn.className = 'rounded-2xl border p-4 text-left transition relative cursor-pointer ' +
        (active ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50');
      btn.innerHTML =
        '<span class="text-3xl">' + m.emoji + '</span>' +
        '<p class="mt-1 font-medium text-slate-800">' + m.name + (active ? ' <span class="text-[10px] text-indigo-500">当前查看</span>' : '') + '</p>' +
        '<button class="absolute top-2 right-2 text-xs text-slate-400 hover:text-indigo-500" data-edit="' + m.id + '">✏️ 编辑</button>';
      btn.addEventListener('click', function () { S.switchViewer(m.id); });
      var edit = btn.querySelector('[data-edit]');
      edit.addEventListener('click', function (e) {
        e.stopPropagation();
        S.openMemberSheet(m.id);
      });
      box.appendChild(btn);
    });
  };

  /* ---------------- 成员编辑（07-PRD §8：可改名/emoji，不可增删） ---------------- */

  var EDIT_EMOJIS = ['🧑', '👩', '👨', '👱‍♀️', '🧔', '👩‍🦱', '🦰', '🐰', '🐱', '🐶'];
  var editingMemberId = null;
  var editingEmoji = null;

  S.openMemberSheet = function (memberId) {
    var m = fcDb.findMember(memberId);
    if (!m) return;
    editingMemberId = memberId;
    editingEmoji = m.emoji;
    document.getElementById('m-name').value = m.name;
    var row = document.getElementById('m-emoji-row');
    row.innerHTML = '';
    EDIT_EMOJIS.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'w-9 h-9 rounded-xl border text-xl flex items-center justify-center ' +
        (e === editingEmoji ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200');
      b.textContent = e;
      b.addEventListener('click', function () { editingEmoji = e; S.openMemberSheet(editingMemberId); });
      row.appendChild(b);
    });
    document.getElementById('member-sheet').classList.remove('hidden');
  };

  S.closeMemberSheet = function () {
    document.getElementById('member-sheet').classList.add('hidden');
    editingMemberId = null;
  };

  S.saveMember = function () {
    if (!editingMemberId) return;
    var name = document.getElementById('m-name').value.trim();
    var r = fcDb.updateMember(editingMemberId, { name: name, emoji: editingEmoji });
    if (!r.ok) { global.toast(r.errors[0]); return; }
    global.toast('已保存');
    S.closeMemberSheet();
    global.renderAll();
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

  /* ---------------- 分类管理（07-PRD §8：预置可隐藏不可删；自定义≤12） ---------------- */

  S.renderCategories = function () {
    var box = document.getElementById('cat-list');
    if (!box) return;
    box.innerHTML = '';
    fcDb.categoriesList().forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 py-1.5 text-sm ' + (c.hidden ? 'opacity-40' : '');
      row.innerHTML =
        '<span class="text-lg w-6 text-center">' + c.icon + '</span>' +
        '<span class="flex-1 text-slate-700">' + c.name +
        '<span class="text-[10px] text-slate-400 ml-1">' + (c.type === 'expense' ? '支出' : '收入') + (c.builtin ? ' · 预置' : ' · 自定义') + '</span></span>' +
        (c.builtin
          ? '<button class="text-[11px] text-slate-500 underline" data-hide>' + (c.hidden ? '恢复' : '隐藏') + '</button>'
          : '<button class="text-[11px] text-slate-500 underline" data-hide>' + (c.hidden ? '恢复' : '隐藏') + '</button>' +
            '<button class="text-[11px] text-rose-400 underline" data-del>删除</button>');
      row.querySelector('[data-hide]').addEventListener('click', function () {
        var r = fcDb.categories.setHidden(c.id, !c.hidden);
        if (!r.ok) { global.toast(r.errors[0]); return; }
        global.toast(c.hidden ? '已恢复' : '已隐藏（不影响历史账目）');
        global.renderAll();
      });
      var del = row.querySelector('[data-del]');
      if (del) del.addEventListener('click', function () {
        var r = fcDb.categories.remove(c.id);
        if (!r.ok) { global.toast(r.errors[0]); return; }
        global.toast('已删除');
        global.renderAll();
      });
      box.appendChild(row);
    });
  };

  S.addCategory = function () {
    var name = document.getElementById('cat-name').value.trim();
    var type = document.querySelector('.cat-type-btn.active') ? document.querySelector('.cat-type-btn.active').getAttribute('data-v') : 'expense';
    var r = fcDb.categories.add({ name: name, type: type });
    if (!r.ok) { global.toast(r.errors[0]); return; }
    document.getElementById('cat-name').value = '';
    global.toast('分类已添加');
    global.renderAll();
  };

  /* ---------------- CSV 导出（仅当前查看人可见交易，07-PRD §5.3/§8） ---------------- */

  function csvCell(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  S.exportCsv = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var viewer = s.currentViewer;
    var visible = fcPrivacy.view(fcDb.tx.list(), viewer).visible; // 本人可见（含自己的私密/小金库），对方私密/小金库自动排除
    var cats = {};
    fcDb.categoriesList().forEach(function (c) { cats[c.id] = c; });
    var lines = ['日期,类型,分类,金额(元),归属人,隐私层级,参与分摊,备注'];
    visible.forEach(function (t) {
      var m = fcDb.findMember(t.ownerId);
      var c = cats[t.categoryId] || { name: '未知' };
      lines.push([
        csvCell(t.date),
        csvCell(t.type === 'income' ? '收入' : '支出'),
        csvCell(c.name),
        (t.amount / 100).toFixed(2),
        csvCell(m ? m.name : '?'),
        csvCell(fcPrivacy.label[t.privacy] || t.privacy),
        csvCell(t.shared ? '是' : '否'),
        csvCell(t.note || '')
      ].join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); // BOM 防 Excel 中文乱码
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'finance-couple-' + (fcDb.findMember(viewer) || { name: '' }).name + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    global.toast('已导出 ' + visible.length + ' 笔可见账目（CSV）');
  };

  /* ---------------- 版本模式（07-PRD §9 商业化分层模拟） ---------------- */

  S.renderTier = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var isFamily = s.tier !== 'free';
    document.getElementById('tier-family').className =
      'flex-1 rounded-xl py-2.5 text-sm font-medium transition ' +
      (isFamily ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500');
    document.getElementById('tier-free').className =
      'flex-1 rounded-xl py-2.5 text-sm font-medium transition ' +
      (!isFamily ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500');
    global.applyTier && global.applyTier();
  };

  S.setTier = function (tier) {
    var r = fcDb.setTier(tier);
    if (!r.ok) { global.toast(r.errors[0]); return; }
    global.toast(tier === 'family' ? '已切换为家庭会员版（全功能）' : '已切换为免费版（双人功能已锁定）');
    global.renderAll();
  };

  S.openUpgrade = function () {
    document.getElementById('upgrade-sheet').classList.remove('hidden');
  };
  S.closeUpgrade = function () {
    document.getElementById('upgrade-sheet').classList.add('hidden');
  };

  /* ---------------- 数据加密（批次⑤，Web Crypto） ---------------- */

  S.renderCrypto = function () {
    if (!window.fcCrypto || !fcCrypto.available()) {
      var card = document.getElementById('btn-crypto-enable');
      if (card) card.closest('.bg-white').classList.add('hidden');
      return;
    }
    var on = fcCrypto.isEnabled();
    var unlocked = fcCrypto.isUnlocked();
    document.getElementById('crypto-off').classList.toggle('hidden', on);
    document.getElementById('crypto-on').classList.toggle('hidden', !on);
    var badge = document.getElementById('crypto-status');
    badge.textContent = on ? (unlocked ? '已开启 · 解锁中' : '已锁定') : '未开启';
    badge.className = 'text-[10px] font-normal ml-1 ' + (on ? 'text-indigo-500' : 'text-slate-400');
  };

  var cryptoSheetMode = 'enable';
  S.openCryptoSheet = function (mode) {
    cryptoSheetMode = mode || 'enable';
    document.getElementById('crypto-sheet-title').textContent = mode === 'disable' ? '关闭数据加密' : '开启数据加密';
    document.getElementById('crypto-confirm').textContent = mode === 'disable' ? '验证并关闭' : '确认开启';
    document.getElementById('crypto-pin').value = '';
    document.getElementById('crypto-pin2').value = '';
    document.getElementById('crypto-pin2').classList.toggle('hidden', mode === 'disable');
    document.getElementById('crypto-err').textContent = '';
    document.getElementById('crypto-sheet').classList.remove('hidden');
  };
  S.closeCryptoSheet = function () {
    document.getElementById('crypto-sheet').classList.add('hidden');
  };

  S.confirmCryptoSheet = function () {
    var pin = document.getElementById('crypto-pin').value.trim();
    var err = document.getElementById('crypto-err');
    var btn = document.getElementById('crypto-confirm');
    if (!/^\d{6}$/.test(pin)) { err.textContent = '口令需为 6 位数字'; return; }
    if (cryptoSheetMode === 'enable') {
      var pin2 = document.getElementById('crypto-pin2').value.trim();
      if (pin !== pin2) { err.textContent = '两次输入不一致'; return; }
      btn.disabled = true; btn.textContent = '加密中…';
      fcCrypto.enable(pin).then(function (r) {
        btn.disabled = false; btn.textContent = '确认开启';
        if (!r.ok) { err.textContent = r.errors[0]; return; }
        S.closeCryptoSheet();
        global.toast('加密已开启');
        global.renderAll();
      });
    } else {
      btn.disabled = true; btn.textContent = '验证中…';
      fcCrypto.disable(pin).then(function (r) {
        btn.disabled = false; btn.textContent = '验证并关闭';
        if (!r.ok) { err.textContent = r.errors[0]; return; }
        S.closeCryptoSheet();
        global.toast('加密已关闭，数据恢复明文存储');
        location.reload();
      });
    }
  };

  S.lockNow = function () {
    fcCrypto.lock();
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

    // 成员编辑弹层
    document.getElementById('member-sheet-mask').addEventListener('click', S.closeMemberSheet);
    document.getElementById('m-cancel').addEventListener('click', S.closeMemberSheet);
    document.getElementById('m-save').addEventListener('click', S.saveMember);

    // 分类管理
    document.getElementById('cat-add').addEventListener('click', S.addCategory);
    document.querySelectorAll('.cat-type-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.cat-type-btn').forEach(function (x) {
          x.classList.remove('active', 'border-indigo-500', 'bg-indigo-50', 'text-indigo-600');
          x.classList.add('border-slate-200', 'text-slate-600');
        });
        b.classList.add('active', 'border-indigo-500', 'bg-indigo-50', 'text-indigo-600');
        b.classList.remove('border-slate-200', 'text-slate-600');
      });
    });

    // CSV 导出
    document.getElementById('btn-csv').addEventListener('click', S.exportCsv);

    // 版本模式
    document.getElementById('tier-family').addEventListener('click', function () { S.setTier('family'); });
    document.getElementById('tier-free').addEventListener('click', function () { S.setTier('free'); });
    document.getElementById('upgrade-sheet-mask').addEventListener('click', S.closeUpgrade);
    document.getElementById('upgrade-unlock').addEventListener('click', function () {
      S.setTier('family');
      S.closeUpgrade();
    });

    // 数据加密（批次⑤）
    document.getElementById('btn-crypto-enable').addEventListener('click', function () { S.openCryptoSheet('enable'); });
    document.getElementById('btn-crypto-disable').addEventListener('click', function () { S.openCryptoSheet('disable'); });
    document.getElementById('btn-crypto-lock').addEventListener('click', S.lockNow);
    document.getElementById('crypto-sheet-mask').addEventListener('click', S.closeCryptoSheet);
    document.getElementById('crypto-cancel').addEventListener('click', S.closeCryptoSheet);
    document.getElementById('crypto-confirm').addEventListener('click', S.confirmCryptoSheet);
  };

  global.settingsUI = S;
})(window);

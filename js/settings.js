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
      btn.addEventListener('click', function () { S.requestSwitch(m.id); });
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
      btn.addEventListener('click', function () { S.requestSwitch(m.id); });
      box.appendChild(btn);
    });
  };

  S.openViewerSheet = function () {
    S.renderViewerSheet();
    // R17：身份锁开启时在弹层内提示
    var hint = document.getElementById('viewer-lock-hint');
    if (hint) hint.classList.toggle('hidden', !identityLock());
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
    // R17：切换身份时若在记一笔页且非编辑态，重置表单（避免用旧身份的金额/归属人误提交）
    if (window.ledger && typeof ledger.newEntry === 'function') {
      var addPage = document.getElementById('page-add');
      var isEditing = document.getElementById('f-title') && document.getElementById('f-title').textContent === '编辑账目';
      if (addPage && !addPage.classList.contains('hidden') && !isEditing) {
        ledger.newEntry();
      }
    }
    var me = fcDb.findMember(memberId);
    global.toast('已切换为 ' + me.name + ' 的视角');
    global.renderAll();
  };

  /* ---------------- 身份切换锁（v1.0.1，R9：切换身份需 PIN） ---------------- */

  var pinVerified = false;      // 本次会话已验证（刷新后需重新输入）
  var pinPendingMember = null;  // 待切换目标
  var pinMode = 'verify';       // verify | set | disable | change-old

  function identityLock() {
    var s = fcDb.getSettings();
    return s && s.identityLock && s.identityLock.enabled ? s.identityLock : null;
  }

  /** 所有"切换身份"入口统一走这里：免费版拦截；开锁未验证 → 要 PIN */
  S.requestSwitch = function (memberId) {
    var cur = fcDb.getCurrentViewer();
    if (memberId === cur) { S.closeViewerSheet(); return; } // 点自己=关弹层
    var s = fcDb.getSettings();
    if (s.tier === 'free') { global.toast('切换身份是家庭会员功能（版本模式中可切换演示）'); return; }
    var lock = identityLock();
    if (lock && !pinVerified) {
      pinPendingMember = memberId;
      S.openPinSheet('verify');
      return;
    }
    S.switchViewer(memberId);
  };

  S.renderIdentityLock = function () {
    var lock = identityLock();
    var badge = document.getElementById('idlock-status');
    var off = document.getElementById('idlock-off');
    var on = document.getElementById('idlock-on');
    if (!badge) return;
    badge.textContent = lock ? '已开启' : '未开启';
    badge.className = 'text-[10px] font-normal ml-1 ' + (lock ? 'text-indigo-500' : 'text-slate-400');
    off.classList.toggle('hidden', !!lock);
    on.classList.toggle('hidden', !lock);
  };

  S.openPinSheet = function (mode) {
    pinMode = mode || 'verify';
    var titles = {
      verify: '验证身份锁',
      set: '设置切换口令',
      'change-old': '修改口令 · 先验证旧口令',
      disable: '关闭身份锁'
    };
    document.getElementById('pin-title').textContent = titles[pinMode];
    document.getElementById('pin-hint').textContent =
      pinMode === 'verify' ? '切换到其他成员视角需要输入切换口令' :
      pinMode === 'set' ? '6 位数字；之后任何人在本机切换身份都需输入（请双方共同保管）' :
      pinMode === 'change-old' ? '输入当前口令，验证后设置新口令' :
      '输入口令确认关闭（关闭后可自由切换身份）';
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-input2').value = '';
    document.getElementById('pin-err').textContent = '';
    // set 模式（含修改口令第二阶段）需显示"再输一次"框；其余模式只有一个输入框
    document.getElementById('pin2-row').classList.toggle('hidden', pinMode !== 'set');
    document.getElementById('pin-sheet').classList.remove('hidden');
    setTimeout(function () { document.getElementById('pin-input').focus(); }, 80);
  };

  S.closePinSheet = function () {
    document.getElementById('pin-sheet').classList.add('hidden');
    pinPendingMember = null;
  };

  S.confirmPin = function () {
    var err = document.getElementById('pin-err');
    var pin = document.getElementById('pin-input').value.trim();
    if (!/^\d{6}$/.test(pin)) { err.textContent = '请输入 6 位数字'; return; }
    var s = fcDb.getSettings();
    var lock = identityLock();

    if (pinMode === 'set') {
      var pin2 = document.getElementById('pin-input2').value.trim();
      if (pin !== pin2) { err.textContent = '两次输入不一致'; return; }
      var salt = fcCrypto.randomSalt();
      fcCrypto.deriveHash(pin, salt).then(function (hash) {
        s.identityLock = { enabled: true, salt: salt, hash: hash, iterations: 150000 };
        s.updatedAt = Date.now();
        fcDb._cryptoBridge.rawWrite('settings', s);
        pinVerified = false; // 开启后不预验证，切换身份立即要求口令（R16：设置后未刷新窗口免密漏洞）
        S.closePinSheet();
        global.toast('身份锁已开启，切换视角需口令', 'success');
        global.renderAll();
      });
      return;
    }
    if (!lock) { err.textContent = '尚未开启身份锁'; return; }
    fcCrypto.deriveHash(pin, lock.salt, lock.iterations).then(function (hash) {
      if (hash !== lock.hash) { err.textContent = '口令错误'; return; }
      if (pinMode === 'verify') {
        pinVerified = true;
        var target = pinPendingMember;
        S.closePinSheet();
        if (target) S.switchViewer(target);
        return;
      }
      if (pinMode === 'disable') {
        s.identityLock = { enabled: false, salt: null, hash: null, iterations: 150000 };
        s.updatedAt = Date.now();
        fcDb._cryptoBridge.rawWrite('settings', s);
        pinVerified = false;
        S.closePinSheet();
        global.toast('身份锁已关闭');
        global.renderAll();
        return;
      }
      if (pinMode === 'change-old') {
        pinVerified = true;
        S.openPinSheet('set');
        return;
      }
    });
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
    global.toast('备份已保存到浏览器下载文件夹（文件名带日期），请妥善保管');
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

  /** 退出当前家庭：清空本机全部数据 → 回到初始化向导（v1.0.1，R8 / R17 自定义弹层） */
  S.resetAll = function () {
    document.getElementById('reset-input').value = '';
    document.getElementById('reset-err').textContent = '';
    document.getElementById('reset-sheet').classList.remove('hidden');
    setTimeout(function () { document.getElementById('reset-input').focus(); }, 80);
  };

  S.closeResetSheet = function () {
    document.getElementById('reset-sheet').classList.add('hidden');
  };

  S.confirmReset = function () {
    var val = document.getElementById('reset-input').value.trim();
    if (val !== '退出') { document.getElementById('reset-err').textContent = '请输入「退出」二字确认'; return; }
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
    global.toast('已导出 ' + visible.length + ' 笔可见账目，CSV 已保存到浏览器下载文件夹');
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
    // 退出当前家庭（清空重建）
    document.getElementById('btn-reset').addEventListener('click', S.resetAll);
    document.getElementById('reset-sheet-mask').addEventListener('click', S.closeResetSheet);
    document.getElementById('reset-cancel').addEventListener('click', S.closeResetSheet);
    document.getElementById('reset-confirm').addEventListener('click', S.confirmReset);
    document.getElementById('reset-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') S.confirmReset(); });

    // 身份切换锁（v1.0.1）
    document.getElementById('idlock-enable').addEventListener('click', function () { S.openPinSheet('set'); });
    document.getElementById('idlock-change').addEventListener('click', function () { S.openPinSheet('change-old'); });
    document.getElementById('idlock-disable').addEventListener('click', function () { S.openPinSheet('disable'); });
    document.getElementById('pin-sheet-mask').addEventListener('click', S.closePinSheet);
    document.getElementById('pin-cancel').addEventListener('click', S.closePinSheet);
    document.getElementById('pin-confirm').addEventListener('click', S.confirmPin);

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

    bindCloud(); // v1.1 云同步（批次⑥）
  };

  /* ---------------- 云同步（v1.1：账号认证 + 双人配对；同步引擎在批次⑧） ----------------
   * 已登录卡片三种子态：未建家庭(nofamily) / 已建家庭(hasfamily) / 换设备无密钥(nokeys)
   * 单机红线：未登录或未配对时不弹任何强制窗口、不影响 v1.0 任何功能（09-PRD §10）。 */

  var cloudUser = null;
  var membership = null;   // {familyId, memberId, paired}（云端查询结果，null=未加载/未加入）
  var authMode = 'signin'; // signin | signup
  var cloudBound = false;
  var pendingJoinCode = null; // #/join?c= 链接直达，登录后自动弹出加入

  S.setPendingJoin = function (code) { pendingJoinCode = code; };

  S.setCloudUser = function (user) {
    cloudUser = user;
    membership = null;
    S.renderCloud();
    if (user && window.fcE2E && fcE2E.available()) {
      fcE2E.fetchMembership().then(function (m) {
        membership = m;
        S.renderCloud();
        // 链接直达：登录后自动弹加入框
        if (m === null && pendingJoinCode) {
          var code = pendingJoinCode; pendingJoinCode = null;
          openJoinSheet(code);
        }
      });
    } else if (!user && pendingJoinCode) {
      // 链接直达但未登录：先弹登录框
      openAuth('signin', '登录后将自动加入家庭');
    }
  };

  /** 配对操作后刷新云端成员状态 */
  function refreshPairing() {
    if (!cloudUser || !window.fcE2E) return Promise.resolve();
    return fcE2E.fetchMembership().then(function (m) { membership = m; S.renderCloud(); });
  }

  S.renderCloud = function () {
    if (typeof global.cloud === 'undefined') return;
    var avail = global.cloud.available();
    var badge = document.getElementById('cloud-badge');
    document.getElementById('cloud-unavailable').classList.toggle('hidden', avail);
    document.getElementById('cloud-signedout').classList.toggle('hidden', !avail || !!cloudUser);
    document.getElementById('cloud-signedin').classList.toggle('hidden', !avail || !cloudUser);
    if (!avail) { badge.textContent = ''; return; }
    if (!cloudUser) {
      badge.textContent = '未登录';
      badge.className = 'text-[10px] font-normal ml-1 text-slate-400';
      return;
    }
    document.getElementById('cloud-email').textContent = cloudUser.email || '';
    var st = window.fcE2E ? fcE2E.state() : null;
    var nofamily = document.getElementById('cloud-nofamily');
    var hasfamily = document.getElementById('cloud-hasfamily');
    var nokeys = document.getElementById('cloud-nokeys');
    var hasCloudFamily = !!membership;
    var keysReady = !!(st && (!membership || st.familyId === membership.familyId));
    // 只要云端没有家庭就显示操作入口（创建/输入邀请码）；
    // 即使本机残留其他账号的密钥状态（st），redeemInvite/createFamily 会覆盖它
    nofamily.classList.toggle('hidden', hasCloudFamily);
    hasfamily.classList.toggle('hidden', !(hasCloudFamily && keysReady));
    nokeys.classList.toggle('hidden', !(hasCloudFamily && !keysReady));
    var staleWarn = document.getElementById('nofamily-stale-warn');
    if (staleWarn) staleWarn.classList.toggle('hidden', !(st && !hasCloudFamily));
    if (hasCloudFamily && keysReady) {
      badge.textContent = membership.paired ? '已配对' : '待加入';
      badge.className = 'text-[10px] font-normal ml-1 ' + (membership.paired ? 'text-emerald-500' : 'text-amber-500');
      var famName = (fcDb.getSettings() || {}).familyName || '我们的家';
      var statusEl = document.getElementById('pair-status');
      if (membership.paired) {
        statusEl.innerHTML = '🎉 已与伴侣配对成功。家庭「<b class="text-slate-700">' + famName + '</b>」的公开账目自动加密互通；私密账对方仅见占位行；小金库不上传共享区。';
        document.getElementById('btn-pair-invite').classList.add('hidden');
        // 显示同步状态区（批次⑨）
        document.getElementById('sync-status-area').classList.remove('hidden');
        document.getElementById('pair-sync-hint').classList.remove('hidden');
        S.renderSyncStatus();
      } else {
        statusEl.innerHTML = '🏠 家庭「<b class="text-slate-700">' + famName + '</b>」已创建，等待伴侣加入。把邀请链接发给 TA 即可完成配对。';
        document.getElementById('btn-pair-invite').classList.remove('hidden');
        document.getElementById('sync-status-area').classList.add('hidden');
        document.getElementById('pair-sync-hint').classList.add('hidden');
      }
    } else if (st && !membership) {
      // 本机有其他账号的残留配对数据，但当前云账号未加入任何家庭
      badge.textContent = '未配对';
      badge.className = 'text-[10px] font-normal ml-1 text-amber-500';
    } else if (hasCloudFamily && !keysReady) {
      badge.textContent = '待恢复';
      badge.className = 'text-[10px] font-normal ml-1 text-amber-500';
    } else {
      badge.textContent = '未配对';
      badge.className = 'text-[10px] font-normal ml-1 text-slate-400';
    }
  };

  /* ---- 同步状态渲染 + 手动同步（批次⑨） ---- */

  S.renderSyncStatus = function () {
    var area = document.getElementById('sync-status-area');
    if (!area || area.classList.contains('hidden')) return;
    var stateText = document.getElementById('sync-status-text');
    var lastTime = document.getElementById('sync-last-time');
    var errMsg = document.getElementById('sync-error-msg');
    var btn = document.getElementById('btn-manual-sync');
    if (!stateText) return;

    var state = (window.fcSync) ? fcSync.getSyncState() : 'idle';
    var labels = {
      'ok': '✅ 已同步',
      'syncing': '🔄 同步中…',
      'pending': '⏳ 待同步',
      'error': '⚠️ 同步失败',
      'idle': '尚未同步'
    };
    stateText.textContent = labels[state] || '未知';
    stateText.className = 'text-[11px] font-medium ' + (state === 'error' ? 'text-rose-500' : state === 'syncing' ? 'text-indigo-500' : state === 'ok' ? 'text-emerald-500' : 'text-slate-500');

    // 上次同步时间
    var lastPull = parseInt(localStorage.getItem('fc_sync_last_pull') || '0', 10) || 0;
    if (lastPull) {
      var d = new Date(lastPull);
      lastTime.textContent = '上次同步：' + d.getMonth() + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } else {
      lastTime.textContent = '尚未同步';
    }

    // 错误提示
    if (state === 'error') {
      errMsg.classList.remove('hidden');
      errMsg.textContent = '点击"立即同步"重试';
      btn.textContent = '重试同步';
    } else {
      errMsg.classList.add('hidden');
      btn.textContent = state === 'syncing' ? '同步中…' : '立即同步';
    }
    btn.disabled = state === 'syncing';
    btn.classList.toggle('opacity-60', state === 'syncing');
  };

  S.manualSync = function () {
    if (!window.fcSync) return;
    fcSync.syncNow().then(function (r) {
      if (r.ok) {
        toast('同步完成（推送' + (r.pushed || 0) + '条，拉取' + (r.pulled || 0) + '条）', 'success');
      } else {
        toast((r.errors && r.errors[0]) || '同步失败', 'error');
      }
      S.renderSyncStatus();
    });
  };


  /* ---- 登录/注册弹层 ---- */

  function openAuth(mode, hint) {
    authMode = mode || 'signin';
    document.getElementById('auth-title').textContent = authMode === 'signin' ? '登录云同步' : '注册云同步';
    document.getElementById('auth-submit').textContent = authMode === 'signin' ? '登录' : '注册';
    document.getElementById('auth-switch').textContent = authMode === 'signin' ? '没有账号？点此注册' : '已有账号？点此登录';
    document.getElementById('auth-err').textContent = hint || '';
    document.getElementById('auth-mask').classList.remove('hidden');
    setTimeout(function () { document.getElementById('auth-email').focus(); }, 80);
  }
  S.closeAuth = function () { document.getElementById('auth-mask').classList.add('hidden'); };

  S.submitAuth = function () {
    var email = document.getElementById('auth-email').value;
    var pwd = document.getElementById('auth-password').value;
    var errEl = document.getElementById('auth-err');
    var btn = document.getElementById('auth-submit');
    errEl.textContent = '';
    btn.disabled = true;
    btn.classList.add('opacity-60');
    var p = authMode === 'signin' ? global.cloud.signIn(email, pwd) : global.cloud.signUp(email, pwd);
    p.then(function (r) {
      btn.disabled = false;
      btn.classList.remove('opacity-60');
      if (!r.ok) { errEl.textContent = r.errors[0]; return; }
      document.getElementById('auth-password').value = '';
      S.closeAuth();
      toast(authMode === 'signup' ? '注册成功' : '登录成功', 'success');
      // 新设备登录：静默尝试用登录口令恢复密钥备份（失败静默，卡片会显示手动恢复入口）
      if (window.fcE2E && fcE2E.available()) {
        fcE2E.restoreKeys(pwd).then(function (rr) {
          if (rr.ok) { toast('已从云端恢复本家庭密钥', 'success'); refreshPairing(); }
        });
      }
      // 登录态变化由 cloud.onAuthChange 回调驱动 renderCloud
    });
  };

  S.signOutCloud = function () {
    global.cloud.signOut().then(function (r) {
      membership = null;
      toast(r.ok ? '已退出登录，本机数据保留' : (r.errors[0] || '退出失败'));
    });
  };

  /* ---- 配对弹层 ---- */

  function sheet(id, show) { document.getElementById(id).classList.toggle('hidden', !show); }

  function openCreateSheet() {
    var s = fcDb.getSettings();
    document.getElementById('pair-family-name').value = (s && s.familyName) || '我们的家';
    document.getElementById('pair-create-pw').value = '';
    document.getElementById('pair-create-err').textContent = '';
    sheet('pair-create-sheet', true);
  }

  S.confirmCreateFamily = function () {
    var name = document.getElementById('pair-family-name').value.trim();
    var pw = document.getElementById('pair-create-pw').value;
    var errEl = document.getElementById('pair-create-err');
    var btn = document.getElementById('pair-create-confirm');
    var s = fcDb.getSettings();
    var me = s ? fcDb.findMember(s.currentViewer) : null;
    errEl.textContent = '';
    btn.disabled = true; btn.classList.add('opacity-60');
    fcE2E.createFamily({ familyName: name, myName: me ? me.name : '', password: pw }).then(function (r) {
      btn.disabled = false; btn.classList.remove('opacity-60');
      if (!r.ok) { errEl.textContent = r.errors[0]; return; }
      sheet('pair-create-sheet', false);
      toast('家庭创建成功，现在可以邀请伴侣了', 'success');
      refreshPairing();
    });
  };

  S.openInviteSheet = function () {
    if (!fcE2E.state()) { toast('请先创建家庭'); return; }
    var btn = document.getElementById('btn-pair-invite');
    btn.disabled = true; btn.classList.add('opacity-60');
    fcE2E.createInvite().then(function (r) {
      btn.disabled = false; btn.classList.remove('opacity-60');
      if (!r.ok) { toast(r.errors[0]); return; }
      document.getElementById('invite-link').value = r.link;
      document.getElementById('invite-short').textContent = r.short;
      sheet('invite-sheet', true);
    });
  };

  S.copyInvite = function () {
    var link = document.getElementById('invite-link').value;
    var done = function () { toast('邀请链接已复制，发给伴侣吧', 'success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(function () { fallbackCopy(link, done); });
    } else { fallbackCopy(link, done); }
  };
  function fallbackCopy(text, done) {
    var el = document.getElementById('invite-link');
    el.select(); el.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请长按选择链接手动复制'); }
  }

  function openJoinSheet(prefill) {
    document.getElementById('pair-join-code').value = prefill || '';
    document.getElementById('pair-join-pw').value = '';
    document.getElementById('pair-join-err').textContent = '';
    sheet('pair-join-sheet', true);
    setTimeout(function () { document.getElementById('pair-join-code').focus(); }, 80);
  }

  S.confirmJoin = function () {
    var code = document.getElementById('pair-join-code').value;
    var pw = document.getElementById('pair-join-pw').value;
    var errEl = document.getElementById('pair-join-err');
    var btn = document.getElementById('pair-join-confirm');
    errEl.textContent = '';
    btn.disabled = true; btn.classList.add('opacity-60');
    fcE2E.redeemInvite(code, pw).then(function (r) {
      btn.disabled = false; btn.classList.remove('opacity-60');
      if (!r.ok) { errEl.textContent = r.errors[0]; return; }
      sheet('pair-join-sheet', false);
      pendingJoinCode = null;
      toast('已加入家庭，配对成功 🎉', 'success');
      refreshPairing();
    });
  };

  S.confirmRestoreKeys = function () {
    var pw = document.getElementById('restore-pw').value;
    var errEl = document.getElementById('restore-err');
    errEl.textContent = '';
    fcE2E.restoreKeys(pw).then(function (r) {
      if (!r.ok) { errEl.textContent = r.errors[0]; return; }
      document.getElementById('restore-pw').value = '';
      toast('密钥恢复成功', 'success');
      refreshPairing();
    });
  };

  function bindCloud() {
    if (cloudBound) return;
    cloudBound = true;
    document.getElementById('btn-cloud-auth').addEventListener('click', function () { openAuth('signin'); });
    // 免费版点击云同步卡片 → 升级弹层（批次⑨门控）
    var cloudCardEl = document.getElementById('cloud-sync-card');
    if (cloudCardEl) {
      cloudCardEl.addEventListener('click', function () {
        if (cloudCardEl.dataset.gated === '1') { S.openUpgrade(); }
      }, true); // capture：拦截子元素点击
    }
    document.getElementById('btn-cloud-signout').addEventListener('click', S.signOutCloud);
    var syncBtn = document.getElementById('btn-manual-sync');
    if (syncBtn) syncBtn.addEventListener('click', S.manualSync);
    document.getElementById('auth-close').addEventListener('click', S.closeAuth);
    document.getElementById('auth-mask').addEventListener('click', function (e) {
      if (e.target === this) S.closeAuth();
    });
    document.getElementById('auth-switch').addEventListener('click', function () {
      openAuth(authMode === 'signin' ? 'signup' : 'signin');
    });
    document.getElementById('auth-submit').addEventListener('click', S.submitAuth);
    document.getElementById('auth-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') S.submitAuth();
    });

    // 配对
    document.getElementById('btn-pair-create').addEventListener('click', openCreateSheet);
    document.getElementById('pair-create-mask').addEventListener('click', function () { sheet('pair-create-sheet', false); });
    document.getElementById('pair-create-cancel').addEventListener('click', function () { sheet('pair-create-sheet', false); });
    document.getElementById('pair-create-confirm').addEventListener('click', S.confirmCreateFamily);

    document.getElementById('btn-pair-join').addEventListener('click', function () { openJoinSheet(); });
    document.getElementById('pair-join-mask').addEventListener('click', function () { sheet('pair-join-sheet', false); });
    document.getElementById('pair-join-cancel').addEventListener('click', function () { sheet('pair-join-sheet', false); });
    document.getElementById('pair-join-confirm').addEventListener('click', S.confirmJoin);

    document.getElementById('btn-pair-invite').addEventListener('click', S.openInviteSheet);
    document.getElementById('invite-mask').addEventListener('click', function () { sheet('invite-sheet', false); });
    document.getElementById('invite-close').addEventListener('click', function () { sheet('invite-sheet', false); });
    document.getElementById('invite-copy').addEventListener('click', S.copyInvite);

    document.getElementById('btn-restore-keys').addEventListener('click', S.confirmRestoreKeys);
    document.getElementById('restore-pw').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') S.confirmRestoreKeys();
    });
  }

  global.settingsUI = S;
})(window);

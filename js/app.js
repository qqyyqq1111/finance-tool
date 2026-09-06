/* ============================================================
 * app.js — 页面装配 / Tab路由 / 首次初始化向导
 * 批次① 范围（06-路线图批次①）：
 *  - Tailwind CDN 应用骨架 + 底部Tab（明细/结算/＋记一笔/看板/设置）
 *  - 三步初始化向导（07-PRD §2.4）
 *  - 身份切换装配（实现在 settings.js）
 * ============================================================ */
(function (global) {
  'use strict';

  var PAGES = ['ledger', 'add', 'split', 'dashboard', 'settings'];

  /* ---------------- Toast ---------------- */

  var toastTimer = null;
  global.toast = function (msg, type) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden', 'bg-slate-800', 'bg-emerald-500');
    el.classList.add(type === 'success' ? 'bg-emerald-500' : 'bg-slate-800');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600); // v1.0.1：1800→2600ms
  };

  /* ---------------- Tab 路由 ---------------- */

  function showPage(name) {
    PAGES.forEach(function (p) {
      var sec = document.getElementById('page-' + p);
      if (sec) sec.classList.toggle('hidden', p !== name);
    });
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === name;
      btn.classList.toggle('text-indigo-600', active);
      btn.classList.toggle('font-semibold', active);
      btn.classList.toggle('text-slate-400', !active);
    });
    // 明细/结算/看板页每次进入都重渲染（数据可能已变化）
    if (name === 'ledger' && window.ledger) ledger.renderLedger();
    if (name === 'split' && window.splitUI) splitUI.render();
    if (name === 'dashboard' && window.dashUI) dashUI.render();
    if (window.applyTier) applyTier();
  }
  window.showPage = showPage; // v1.0.1 修复：ledger.js 编辑/保存流程依赖全局跳页

  /* ---------------- 版本门控（07-PRD §9 商业化分层模拟） ---------------- */

  /** 免费版隐藏付费功能入口；家庭会员版全功能 */
  window.applyTier = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    var isFamily = s.tier !== 'free';
    var toggle = function (el, familyOnly) {
      if (!el) return;
      el.classList.toggle('hidden', !isFamily && familyOnly);
    };
    toggle(document.getElementById('viewer-chip'), true);          // 身份切换
    toggle(document.getElementById('vault-card'), true);           // 小金库卡（明细页）
    toggle(document.getElementById('f-privacy-block'), true);      // 隐私层级选择（锁public）
    toggle(document.getElementById('d-duo'), true);                // 双人对比卡
    toggle(document.getElementById('d-vault-card'), true);         // 看板小金库卡
    toggle(document.getElementById('btn-csv'), true);              // CSV导出
    toggle(document.getElementById('cat-manage-card'), true);      // 分类管理（会员）
    // v1.1 批次⑨：云同步卡片——免费版置灰+升级弹层（不隐藏，需可见卖点）
    var cloudCard = document.getElementById('cloud-sync-card');
    if (cloudCard) {
      cloudCard.classList.toggle('opacity-50', !isFamily);
      cloudCard.classList.toggle('pointer-events-none', !isFamily);
      cloudCard.dataset.gated = isFamily ? '0' : '1';
    }
    var splitTab = document.querySelector('.nav-btn[data-tab="split"]');
    if (splitTab) splitTab.classList.toggle('hidden', !isFamily);  // 结算Tab
    // v1.0.2：免费版隐藏结算Tab后，剩余4个Tab均分导航栏（5列→4列）
    var navGrid = document.getElementById('nav-grid');
    if (navGrid) {
      navGrid.classList.toggle('grid-cols-5', isFamily);
      navGrid.classList.toggle('grid-cols-4', !isFamily);
    }
    // 免费版强制隐私=public（07-PRD §9：锁定public）
    if (!isFamily && window.ledger) ledger.forcePublicPrivacy && ledger.forcePublicPrivacy();
  };

  /* ---------------- 全局渲染（身份切换后全量重算，07-PRD §3） ---------------- */

  window.renderAll = function () {
    var s = fcDb.getSettings();
    if (!s) return;
    // 保留 sync-badge 子元素：只替换首个文本节点
    var titleEl = document.getElementById('app-title');
    if (titleEl.firstChild && titleEl.firstChild.nodeType === 3) {
      titleEl.firstChild.nodeValue = s.familyName;
    } else {
      titleEl.insertBefore(document.createTextNode(s.familyName), titleEl.firstChild);
    }
    settingsUI.renderViewerChip();
    settingsUI.renderMemberCards();
    settingsUI.renderCategories();
    settingsUI.renderTier();
    if (window.settingsUI && settingsUI.renderCrypto) settingsUI.renderCrypto();
    if (window.settingsUI && settingsUI.renderIdentityLock) settingsUI.renderIdentityLock();
    if (window.settingsUI && settingsUI.renderCloud) settingsUI.renderCloud(); // v1.1 云同步卡片
    if (window.fcSync && fcSync.renderBadge) fcSync.renderBadge(); // v1.1 批次⑨ 顶部同步图标
    if (window.ledger) ledger.renderLedger(); // 按新查看人重算明细/小金库/汇总
    if (window.splitUI) splitUI.render();     // 结算页规则文案/历史按新身份刷新
    if (window.dashUI) dashUI.render();       // 看板按新身份刷新
    if (window.applyTier) applyTier();
  };

  /* ---------------- 初始化向导（07-PRD §2.4） ---------------- */

  var wizardState = {
    step: 1,
    familyName: '我们的家',
    members: [
      { name: '', emoji: '🧑' },
      { name: '', emoji: '👩' }
    ],
    ratio: 50
  };

  var EMOJIS = ['🧑', '👩', '👨', '👱‍♀️', '🧔', '👩‍🦱', '🦰', '🐰'];

  function goStep(n) {
    wizardState.step = n;
    [1, 2, 3].forEach(function (i) {
      document.getElementById('wstep-' + i).classList.toggle('hidden', i !== n);
      document.getElementById('wstep-' + i).classList.toggle('flex', i === n);
    });
    document.querySelectorAll('.wstep').forEach(function (dot, idx) {
      dot.classList.toggle('bg-indigo-600', idx < n);
      dot.classList.toggle('bg-slate-200', idx >= n);
    });
  }

  function buildEmojiRows() {
    document.querySelectorAll('.emoji-row').forEach(function (row) {
      var target = Number(row.getAttribute('data-target'));
      row.innerHTML = '';
      EMOJIS.forEach(function (e) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-9 h-9 rounded-xl border text-xl flex items-center justify-center ' +
          (wizardState.members[target].emoji === e ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200');
        btn.textContent = e;
        btn.addEventListener('click', function () {
          wizardState.members[target].emoji = e;
          document.getElementById('w-emoji-' + target).textContent = e;
          buildEmojiRows();
        });
        row.appendChild(btn);
      });
    });
  }

  function finishWizard() {
    wizardState.familyName = document.getElementById('w-family').value.trim() || '我们的家';
    wizardState.members[0].name = document.getElementById('w-name-0').value.trim() || '成员A';
    wizardState.members[1].name = document.getElementById('w-name-1').value.trim() || '成员B';
    wizardState.ratio = Number(document.getElementById('w-ratio').value);
    var r = fcDb.init({
      familyName: wizardState.familyName,
      members: wizardState.members,
      ratio: { m1: wizardState.ratio, m2: 100 - wizardState.ratio }
    });
    if (!r.ok) { toast(r.errors[0]); return; }
    document.getElementById('wizard').classList.add('hidden');
    document.getElementById('app-main').classList.remove('hidden');
    window.renderAll();
    showPage('ledger');
    toast('账本创建成功，开始记第一笔吧');
  }

  function bindWizard() {
    buildEmojiRows();
    document.getElementById('w-next-1').addEventListener('click', function () {
      wizardState.familyName = document.getElementById('w-family').value.trim() || '我们的家';
      goStep(2);
    });
    document.getElementById('w-next-2').addEventListener('click', function () {
      goStep(3);
    });
    document.getElementById('w-ratio').addEventListener('input', function (e) {
      var v = Number(e.target.value);
      document.getElementById('w-ratio-text').textContent = v + '% : ' + (100 - v) + '%';
      document.getElementById('w-ratio-label-0').textContent = '成员A ' + v + '%';
      document.getElementById('w-ratio-label-1').textContent = '成员B ' + (100 - v) + '%';
    });
    document.getElementById('w-finish').addEventListener('click', finishWizard);
  }

  /* ---------------- 加密解锁（批次⑤） ---------------- */

  function cryptoLocked() {
    return window.fcCrypto && fcCrypto.available() && fcCrypto.isEnabled() && !fcCrypto.isUnlocked();
  }

  function showLockMask() {
    document.getElementById('lock-mask').classList.remove('hidden');
    document.getElementById('lock-pin').value = '';
    document.getElementById('lock-err').textContent = '';
    setTimeout(function () { document.getElementById('lock-pin').focus(); }, 100);
  }

  function doUnlock() {
    var pin = document.getElementById('lock-pin').value.trim();
    var err = document.getElementById('lock-err');
    if (!/^\d{6}$/.test(pin)) { err.textContent = '请输入 6 位数字口令'; return; }
    fcCrypto.unlock(pin).then(function (r) {
      if (!r.ok) { err.textContent = r.errors[0]; return; }
      document.getElementById('lock-mask').classList.add('hidden');
      window.renderAll();
      toast('已解锁');
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    fcDb.migrate();

    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { showPage(btn.getAttribute('data-tab')); });
    });
    // 中央 ＋ 按钮：进入新账模式
    document.querySelector('[data-tab="add"]').addEventListener('click', function () {
      ledger.newEntry();
      showPage('add');
    });

    settingsUI.bind();
    ledger.bind();
    if (window.splitUI) splitUI.bind();
    if (window.dashUI) dashUI.bind();
    if (window.fcSync) fcSync.bind();
    bindWizard();

    // v1.1 云认证 + 配对链接直达：登录态变化驱动设置页云卡片（未配置时回调 null，自动显示单机态）
    if (window.cloud) {
      // #/join?c=<secret> 邀请链接：先记下，登录后自动弹加入框（fragment 不进服务器日志）
      var joinMatch = location.hash.match(/join\?c=([A-Za-z0-9]{8,24})/);
      if (joinMatch && window.settingsUI && settingsUI.setPendingJoin) {
        settingsUI.setPendingJoin(joinMatch[1]);
        history.replaceState(null, '', location.pathname + location.search);
      }
      cloud.onAuthChange(function (user) {
        if (window.settingsUI && settingsUI.setCloudUser) settingsUI.setCloudUser(user);
      });
    }

    // 加密解锁遮罩
    document.getElementById('lock-unlock').addEventListener('click', doUnlock);
    document.getElementById('lock-pin').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doUnlock();
    });

    if (fcDb.isInitialized()) {
      document.getElementById('wizard').classList.add('hidden');
      document.getElementById('app-main').classList.remove('hidden');
      if (cryptoLocked()) {
        showLockMask(); // 加密已开启但未解锁：先拦在遮罩，不渲染账目
      } else {
        window.renderAll();
        showPage('ledger');
      }
    } else {
      document.getElementById('app-main').classList.add('hidden');
      document.getElementById('wizard').classList.remove('hidden');
      goStep(1);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window);

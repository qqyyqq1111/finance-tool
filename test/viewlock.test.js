/* ============================================================
 * viewlock.test.js — F16 视角锁定 + 切换隐私提示 单测（v1.2 批次②）
 * 运行：node test/viewlock.test.js
 * ============================================================ */
'use strict';

/* ---- localStorage stub ---- */
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; },
  clear: function () { store = {}; },
  key: function () { return null; },
  length: 0
};
global.window = global;

// settings.js 加载时仅定义（纯函数与状态读写不依赖 DOM/fcDb）
require('../js/settings.js');
var S = settingsUI;

var passed = 0;
var failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}

/* ---------- 1. parseViewLock（纯函数） ---------- */
check('null → 未锁定', S.parseViewLock(null).locked === false);
check('undefined → 未锁定', S.parseViewLock(undefined).locked === false);
check('空串 → 未锁定', S.parseViewLock('').locked === false);
check('损坏 JSON → 未锁定', S.parseViewLock('{broken').locked === false);
check('非对象 JSON → 未锁定', S.parseViewLock('123').locked === false);
check('{"locked":true} → 锁定', S.parseViewLock('{"locked":true}').locked === true);
check('{"locked":false} → 未锁定', S.parseViewLock('{"locked":false}').locked === false);
check('locked 为字符串 → 按真值锁定', S.parseViewLock('{"locked":"yes"}').locked === true);
check('带 at 字段不影响判定', S.parseViewLock('{"locked":true,"at":123}').locked === true);

/* ---------- 2. canSwitchTo（纯函数） ---------- */
check('无锁状态 → 可切换', S.canSwitchTo(null, 'm2', 'm1').ok === true);
check('locked:false → 可切换', S.canSwitchTo({ locked: false }, 'm2', 'm1').ok === true);
check('锁定中切对方 → 拒绝', S.canSwitchTo({ locked: true }, 'm2', 'm1').ok === false);
check('拒绝原因 locked', S.canSwitchTo({ locked: true }, 'm2', 'm1').reason === 'locked');
check('锁定中切自己 → 允许', S.canSwitchTo({ locked: true }, 'm1', 'm1').ok === true);
check('切自己标记 same', S.canSwitchTo({ locked: true }, 'm1', 'm1').same === true);

/* ---------- 3. isViewLocked / setViewLock（存储读写） ---------- */
S.setViewLock(false);
check('默认未锁定', S.isViewLocked() === false);
S.setViewLock(true);
check('设置后已锁定', S.isViewLocked() === true);
check('存储为JSON且含locked', JSON.parse(localStorage.getItem('fc_view_lock')).locked === true);
S.setViewLock(false);
check('关闭后未锁定', S.isViewLocked() === false);
check('关闭后key已移除', localStorage.getItem('fc_view_lock') === null);

/* ---------- 4. 切换隐私提示开关 ---------- */
S.setSwitchHintOff(false);
check('默认需要提示（hintOff=false）', S.isSwitchHintOff() === false);
S.setSwitchHintOff(true);
check('设置后不再提示', S.isSwitchHintOff() === true);
check('存储值为1', localStorage.getItem('fc_switch_hint_off') === '1');
S.setSwitchHintOff(false);
check('重新开启后需要提示', S.isSwitchHintOff() === false);
check('重新开启后key已移除', localStorage.getItem('fc_switch_hint_off') === null);

/* ---------- 5. 存储损坏时状态安全回退 ---------- */
localStorage.setItem('fc_view_lock', 'not-a-json');
check('视角锁存储损坏 → 回退未锁定', S.isViewLocked() === false);

/* ---------- 汇总 ---------- */
console.log('\n视角锁定测试：' + passed + ' 项通过，' + failed + ' 项失败');
process.exit(failed ? 1 : 0);

/* ============================================================
 * 加密层单测（node test/crypto.test.js，异步）
 * 覆盖 07-PRD §2.1：AES-GCM + PBKDF2 口令派生，交易/结算加密、元数据不加密
 * ============================================================ */
'use strict';

function makeLocalStorageStub() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    key: function (i) { return Object.keys(store)[i] || null; },
    get length() { return Object.keys(store).length; }
  };
}
global.localStorage = makeLocalStorageStub();
global.window = global;

require('../js/db.js');
require('../js/privacy.js');
require('../js/split.js');
require('../js/crypto.js');

var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

async function main() {
  console.log('[0] 环境与初始化');
  assert(!!fcCrypto.available(), 'WebCrypto 环境可用');
  assert(fcDb.init({ familyName: '加密测试家', members: [{ name: '阿晨', emoji: '🧑' }, { name: '小棠', emoji: '👩' }], ratio: { m1: 50, m2: 50 } }).ok, 'init 成功');
  assert(!fcCrypto.isEnabled() && !fcCrypto.isUnlocked(), '默认关闭加密');

  fcDb.tx.add({ date: '2026-09-01', type: 'expense', amount: 12800, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true, note: '火锅' });
  fcDb.tx.add({ date: '2026-09-02', type: 'expense', amount: 66600, categoryId: 'c_other', ownerId: 'm1', privacy: 'vault', vaultId: fcDb.getVaultOf('m1').id, note: '秘密' });
  fcDb.tx.add({ date: '2026-08-15', type: 'expense', amount: 10000, categoryId: 'c_food', ownerId: 'm1', privacy: 'public', shared: true });
  var augResult = fcSplit.monthSettlement(fcDb.tx.list(), '2026-08', fcDb.getSettings());
  var stR = fcDb.settlements.add('2026-08', augResult);
  assert(stR.ok, '8月结算单已创建');

  console.log('[1] 开启加密（口令校验）');
  var bad1 = await fcCrypto.enable('123');
  assert(!bad1.ok, '非6位口令拒绝');
  var bad2 = await fcCrypto.enable('abcdef');
  assert(!bad2.ok, '非数字口令拒绝');

  console.log('[2] 开启加密成功 → 落盘为密文');
  var r = await fcCrypto.enable('246810');
  assert(r.ok, 'enable(246810) 成功');
  assert(fcCrypto.isEnabled() && fcCrypto.isUnlocked(), '状态=已开启且解锁中');
  var rawTx = JSON.parse(localStorage.getItem('fc_transactions'));
  assert(rawTx && rawTx.__enc === 1 && typeof rawTx.data === 'string' && rawTx.data.indexOf('火锅') < 0, 'fc_transactions 为密文（不含明文备注）');
  var rawSt = JSON.parse(localStorage.getItem('fc_settlements'));
  assert(rawSt && rawSt.__enc === 1, 'fc_settlements 为密文');
  var rawSettings = JSON.parse(localStorage.getItem('fc_settings'));
  assert(rawSettings.encryptionEnabled === true && rawSettings.familyName === '加密测试家', 'settings 明文且 encryptionEnabled=true');
  var rawCats = JSON.parse(localStorage.getItem('fc_categories'));
  assert(Array.isArray(rawCats) && rawCats[0].name === '餐饮', 'categories 元数据不加密');
  assert(!!JSON.parse(localStorage.getItem('fc_crypto_meta')).salt, 'cryptoMeta 含 salt');

  console.log('[3] 解锁态业务读写正常（内存会话）');
  assert(fcDb.tx.list().length === 3, '解锁后 tx.list() 返回明文 3 笔（09两笔+08一笔）');
  fcDb.tx.add({ date: '2026-09-03', type: 'expense', amount: 5000, categoryId: 'c_transport', ownerId: 'm2', privacy: 'public', shared: true });
  await fcCrypto.persist();
  var rawTx2 = JSON.parse(localStorage.getItem('fc_transactions'));
  assert(rawTx2.__enc === 1 && rawTx2.data !== rawTx.data, '新增账目后落盘密文已更新');

  console.log('[4] 锁定 → 数据不可见');
  fcCrypto.lock();
  assert(fcCrypto.isEnabled() && !fcCrypto.isUnlocked(), '锁定后状态=已开启未解锁');
  assert(fcDb.tx.list().length === 0, '锁定后 tx.list() 为空（密文不反序列化）');
  assert(fcDb.settlements.list().length === 0, '锁定后结算列表为空');

  console.log('[5] 错误口令解锁失败');
  var wrong = await fcCrypto.unlock('000000');
  assert(!wrong.ok && /口令/.test(wrong.errors[0]), '错误口令被拒绝（GCM 认证失败）');
  assert(!fcCrypto.isUnlocked(), '失败后仍未解锁');
  assert(fcDb.tx.list().length === 0, '失败后数据仍不可见');

  console.log('[6] 正确口令解锁 → 数据完整还原');
  var ok = await fcCrypto.unlock('246810');
  assert(ok.ok, '正确口令解锁成功');
  var list = fcDb.tx.list();
  assert(list.length === 4, '4 笔账目完整还原（含加密会话期间新增的1笔）');
  assert(list.some(function (t) { return t.note === '火锅' && t.amount === 12800; }), '明文内容一致（火锅128元）');
  assert(list.some(function (t) { return t.privacy === 'vault'; }), '小金库账还原');
  assert(fcDb.settlements.list().length === 1, '结算记录还原');

  console.log('[7] 关闭加密 → 恢复明文存储');
  var disBad = await fcCrypto.disable('999999');
  assert(!disBad.ok, '关闭加密需口令验证（错误口令拒绝）');
  var disOk = await fcCrypto.disable('246810');
  assert(disOk.ok, '正确口令关闭加密成功');
  assert(!fcCrypto.isEnabled() && !fcCrypto.isUnlocked(), '状态恢复关闭');
  var rawTx3 = JSON.parse(localStorage.getItem('fc_transactions'));
  assert(Array.isArray(rawTx3) && rawTx3.length === 4 && rawTx3[0].note === '火锅', 'fc_transactions 恢复明文数组（4笔）');
  assert(localStorage.getItem('fc_crypto_meta') === null, 'cryptoMeta 已删除');
  assert(JSON.parse(localStorage.getItem('fc_settings')).encryptionEnabled === false, 'settings 标记复位');

  console.log('[8] 关闭后业务正常（回归明文路径）');
  assert(fcDb.tx.list().length === 4, '明文路径 tx.list() 正常（4笔）');
  fcDb.tx.add({ date: '2026-09-04', type: 'income', amount: 100000, categoryId: 'c_salary', ownerId: 'm1', privacy: 'public' });
  assert(fcDb.tx.list().length === 5, '明文路径新增正常（5笔）');

  console.log('');
  console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error('测试异常:', e); process.exit(1); });

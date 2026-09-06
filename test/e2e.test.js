/* ============================================================
 * e2e.js 密钥/邀请纯函数单测（node test/e2e.test.js）
 * 覆盖 09-PRD §3.3/§3.4：双密钥生成、邀请双路包装、备份恢复
 * 网络编排（Supabase RPC/表读写）在浏览器验收中覆盖。
 * ============================================================ */
'use strict';

/* ---- localStorage 桩（e2e.state 用） ---- */
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

require('../js/e2e.js');

var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}
function b64Len(n) { return Math.ceil(n / 3) * 4; }

function run() {
  /* [1] 密钥与邀请码生成 */
  console.log('[1] 随机生成');
  var k1 = fcE2E.genKeyB64(), k2 = fcE2E.genKeyB64();
  assert(typeof k1 === 'string' && k1.length === b64Len(32), 'genKeyB64 为 32 字节的 base64');
  assert(k1 !== k2, '两次生成密钥不同（随机性）');

  var codes = fcE2E.genInviteCodes();
  assert(/^[A-Za-z0-9]{24}$/.test(codes.secret), '链接 secret 为 24 位字母数字');
  assert(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(codes.short), '短码为 8 位且无易混字符 I/L/O/0/1');
  assert(!/[ILO01]/.test(codes.short), '短码不含 I/L/O/0/1');

  var c2 = fcE2E.genInviteCodes();
  assert(c2.secret !== codes.secret && c2.short !== codes.short, '邀请码两次生成不同');

  /* [2] SHA-256 */
  console.log('[2] code_hash 计算');
  return fcE2E.sha256Hex('abc').then(function (h) {
    assert(/^[0-9a-f]{64}$/.test(h), 'sha256Hex 输出 64 位 hex');
    assert(h === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256("abc") 与标准向量一致');
    return fcE2E.sha256Hex('abc');
  }).then(function (h2) {
    return fcE2E.sha256Hex('abc').then(function (h3) {
      assert(h2 === h3, '相同输入哈希稳定（服务端 digest 可比对）');
    });
  }).then(function () {

    /* [3] 单路 wrap/unwrap */
    console.log('[3] wrapKey/unwrapKey 包装与解封');
    return fcE2E.wrapKey(k1, codes.secret).then(function (blob) {
      var parsed = JSON.parse(blob);
      assert(parsed.v === 1 && !!parsed.salt && !!parsed.iv && !!parsed.data, '包装密文结构 {v,salt,iv,data}');
      return fcE2E.unwrapKey(blob, codes.secret).then(function (back) {
        assert(back === k1, '正确 secret 解封得到原 familyKey');
      });
    });
  }).then(function () {
    // 错误码解封必须失败（GCM 认证）
    return fcE2E.wrapKey(k1, codes.secret).then(function (blob) {
      return fcE2E.unwrapKey(blob, 'wrong-secret-xxxxxxxxxxxxxxxx').then(function () {
        assert(false, '错误 secret 解封应失败');
      }).catch(function () { assert(true, '错误 secret 解封被 AES-GCM 拒绝'); });
    });
  }).then(function () {

    /* [4] 邀请双路包装（链接 secret 与短码都能解） */
    console.log('[4] 邀请双路包装 wrapFamilyForInvite');
    return fcE2E.wrapFamilyForInvite(k1, codes).then(function (enc) {
      var parsed = JSON.parse(enc);
      assert(!!parsed.s && !!parsed.c, '密文含 s(链接路)/c(短码路) 两份包装');
      return fcE2E.unwrapFamilyFromInvite(enc, codes.secret).then(function (viaS) {
        assert(viaS === k1, '用链接 secret 解出 familyKey');
        return fcE2E.unwrapFamilyFromInvite(enc, codes.short).then(function (viaC) {
          assert(viaC === k1, '用 8 位短码也能解出同一把 familyKey（人工输入兜底）');
        });
      });
    });
  }).then(function () {
    return fcE2E.wrapFamilyForInvite(k1, codes).then(function (enc) {
      return fcE2E.unwrapFamilyFromInvite(enc, 'ZZZZZZZZ').then(function () {
        assert(false, '无关短码解封应失败');
      }).catch(function () { assert(true, '无关短码两路都解不开 → 拒绝'); });
    });
  }).then(function () {

    /* [5] 文本加解密（家庭名 name_enc） */
    console.log('[5] encryptText/decryptText');
    return fcE2E.encryptText('我们的家🏠', k1).then(function (blob) {
      return fcE2E.decryptText(blob, k1).then(function (txt) {
        assert(txt === '我们的家🏠', '家庭名加密-解密还原（含 emoji）');
      });
    }).then(function () {
      return fcE2E.encryptText('小棠', k1).then(function (blob) {
        return fcE2E.decryptText(blob, k2).then(function () {
          assert(false, '错密钥解密应失败');
        }).catch(function () { assert(true, '错密钥无法解密家庭名（GCM 认证）'); });
      });
    });
  }).then(function () {

    /* [6] 登录口令备份/恢复（换设备） */
    console.log('[6] 双密钥口令备份与恢复');
    var st = { familyId: 'fid-test', memberId: 'm1', familyKey: k1, personalKey: k2 };
    return fcE2E.backupPayload(st, 'my-pass-123').then(function (payload) {
      var p = JSON.parse(payload);
      assert(!!p.salt && !!p.iv && !!p.data, '备份密文结构完整（salt 自描述，新设备可解）');
      return fcE2E.restorePayload(payload, 'my-pass-123').then(function (restored) {
        assert(restored.familyKey === k1 && restored.personalKey === k2, '恢复得到 familyKey+personalKey 双密钥');
        assert(restored.familyId === 'fid-test' && restored.memberId === 'm1', '恢复携带家庭/身份位');
      });
    }).then(function () {
      return fcE2E.backupPayload(st, 'my-pass-123').then(function (payload) {
        return fcE2E.restorePayload(payload, 'wrong-password').then(function () {
          assert(false, '错口令恢复应失败');
        }).catch(function () { assert(true, '错口令无法恢复密钥（忘口令不可恢复原则）'); });
      });
    });
  }).then(function () {

    /* [7] 邀请码提取（粘贴链接/纯码） */
    console.log('[7] extractJoinCode 输入容错');
    var link = 'https://qqyyqq1111.github.io/finance-tool/#/join?c=' + codes.secret;
    assert(fcE2E.extractJoinCode(link) === codes.secret, '从完整邀请链接提取 secret');
    assert(fcE2E.extractJoinCode(codes.secret) === codes.secret, '纯 secret 原样返回');
    assert(fcE2E.extractJoinCode(codes.short) === codes.short, '纯短码原样返回');
    assert(fcE2E.extractJoinCode('  ' + codes.short + ' ') === codes.short, '带空格短码自动 trim');
    var linkQ = 'https://x.com/?c=' + codes.short;
    assert(fcE2E.extractJoinCode(linkQ) === codes.short, '?c= 形式也能提取');
  }).then(function () {
    console.log('\n========================================');
    console.log('结果：' + passed + ' 通过 / ' + failed + ' 失败');
    console.log('========================================');
    process.exit(failed ? 1 : 0);
  }).catch(function (e) {
    console.error('测试链异常:', e);
    process.exit(1);
  });
}

run();

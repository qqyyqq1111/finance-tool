/* ============================================================
 * ui.test.js — 错误文案映射 mapError 单测（v1.2 批次①）
 * 运行：node test/ui.test.js
 * ============================================================ */
'use strict';

global.window = global;
require('../js/ui.js');
var mapError = fcUI.mapError;

var passed = 0;
var failed = 0;

function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}

/* ---------- 1. 网络断连 ---------- */
check('"Failed to fetch" → network', mapError('Failed to fetch').kind === 'network');
check('网络错误文案含中文', /网络/.test(mapError('Failed to fetch').message));
check('网络错误可重试', mapError('Failed to fetch').retryable === true);
check('TypeError 对象传入', mapError(new TypeError('Failed to fetch')).kind === 'network');
check('NetworkError 长文案', mapError('NetworkError when attempting to fetch resource').kind === 'network');
check('ECONNRESET', mapError('ECONNRESET').kind === 'network');
check('"兑换失败：Failed to fetch" 优先识别网络', mapError('兑换失败：Failed to fetch').kind === 'network');

/* ---------- 2. 服务不可用 / 超时 / 暂停 ---------- */
check('503 → unavailable', mapError('Request failed with status code 503').kind === 'unavailable');
check('项目 paused → unavailable', mapError('Cannot connect: the project is paused').kind === 'unavailable');
check('timed out → unavailable', mapError(new Error('The operation timed out')).kind === 'unavailable');

/* ---------- 3. 操作过频 ---------- */
check('rate limit → rate', mapError('rate limit exceeded').kind === 'rate');
check('Too Many Requests → rate', mapError('Too Many Requests').kind === 'rate');

/* ---------- 4. 密码错误 ---------- */
check('Invalid login credentials → password', mapError('Invalid login credentials').kind === 'password');
check('密码错误不可重试', mapError('Invalid login credentials').retryable === false);

/* ---------- 5. 邮箱已注册 ---------- */
check('User already registered → registered', mapError('User already registered').kind === 'registered');

/* ---------- 6. 邮箱未确认 ---------- */
check('Email not confirmed → unconfirmed', mapError('Email not confirmed').kind === 'unconfirmed');

/* ---------- 7. 邮箱格式 ---------- */
check('invalid email address → email', mapError('invalid email address').kind === 'email');

/* ---------- 8. 邀请码 ---------- */
check('邀请码无效或已过期 → invite', mapError('邀请码无效或已过期').kind === 'invite');
check('邀请码错误次数过多 → invite', mapError('邀请码错误次数过多已作废，请让对方重新生成').kind === 'invite');
check('英文 invalid code → invite', mapError('invalid code abc').kind === 'invite');
check('英文 expired → invite', mapError('This link has expired').kind === 'invite');
check('邀请码已被使用 → invite', mapError('邀请码已被使用').kind === 'invite');
check('"格式不正确"输入提示不映射 invite', mapError('邀请码格式不正确（应为 8 位短码或邀请链接）').kind === 'business');
check('格式提示原文保留', mapError('邀请码格式不正确（应为 8 位短码或邀请链接）').message === '邀请码格式不正确（应为 8 位短码或邀请链接）');

/* ---------- 9. 中文业务文案放行 ---------- */
check('"请先登录" 放行 business', mapError('请先登录').kind === 'business');
check('"请先登录" 原文保留', mapError('请先登录').message === '请先登录');
check('"该家庭已配对完成" 放行', mapError('该家庭已配对完成').kind === 'business');

/* ---------- 10. "中文前缀：英文技术细节" 清洗 ---------- */
var cleaned = mapError('兑换失败：Some Weird Error XYZ');
check('清洗后 kind=business', cleaned.kind === 'business');
check('清洗后不含连续英文单词', !/[A-Za-z]{3,}/.test(cleaned.message));
check('清洗保留中文前缀', cleaned.message.indexOf('兑换失败') === 0);

/* ---------- 11. 未识别英文错误：兜底不泄露 ---------- */
var unk = mapError('undefined is not a function');
check('未知英文 → unknown', unk.kind === 'unknown');
check('未知英文不暴露原文', unk.message.indexOf('undefined is not a function') < 0);
check('未知英文可重试', unk.retryable === true);

/* ---------- 12. 空输入 ---------- */
check('null 输入兜底', mapError(null).kind === 'unknown');
check('undefined 输入兜底', mapError(undefined).kind === 'unknown');
check('空字符串兜底', mapError('').kind === 'unknown');

/* ---------- 13. 返回结构完整性 ---------- */
var m = mapError('Failed to fetch');
check('返回四字段结构完整',
  typeof m.kind === 'string' && typeof m.title === 'string' &&
  typeof m.message === 'string' && typeof m.retryable === 'boolean');

/* ---------- 14. 任何英文错误展示给用户的都是中文 ---------- */
check('未识别英文错误输出含中文', /[\u4e00-\u9fa5]/.test(mapError('some raw english error zzz').message));
check('密码错误展示含中文', /[\u4e00-\u9fa5]/.test(mapError('Invalid login credentials').message));

/* ---------- 汇总 ---------- */
console.log('\nUI 错误映射测试：' + passed + ' 项通过，' + failed + ' 项失败');
process.exit(failed ? 1 : 0);

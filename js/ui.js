/* ============================================================
 * ui.js — 通用交互组件（v1.2 批次①）
 * 职责：
 *  - 错误文案映射 mapError：技术错误 → 用户能看懂的中文（纯函数，可单测）
 *  - showError 统一错误弹层（支持"重试"按钮）
 *  - setLoading 按钮 loading 状态（防重复点击）
 *  - focus 自动滚动：输入法弹出时输入框滚动到可视区
 * 红线：服务层（cloud/e2e/sync）只返回结构化错误，一律在 UI 边界经本模块翻译，
 *       不向用户暴露技术细节（堆栈 / 接口地址 / 英文报错）。
 * ============================================================ */
(function (global) {
  'use strict';

  var U = {};

  /* ---------------- 错误文案映射（纯函数） ---------------- */

  function toMessage(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw;
    if (typeof raw.message === 'string') return raw.message;
    return String(raw);
  }

  function hasChinese(s) {
    return /[\u4e00-\u9fa5]/.test(s);
  }

  /**
   * 把任意错误（字符串 / Error / {message}）映射为友好文案
   * @returns {{kind:string, title:string, message:string, retryable:boolean}}
   */
  U.mapError = function (raw) {
    var msg = toMessage(raw);
    var lower = msg.toLowerCase();

    // 1. 网络断连（fetch 失败 / DNS / 连接重置）
    if (/failed to fetch|networkerror|network request failed|fetch failed|load failed|err_internet|err_network|not connected|econnreset|enotfound|socket hang up/.test(lower)) {
      return { kind: 'network', title: '网络不太好', message: '检查一下网络连接，然后重试', retryable: true };
    }
    // 2. 服务不可用 / 超时 / 5xx / 项目暂停
    if (/service unavailable|maintenance|paused|overloaded|status code 5|\b503\b|\b502\b|\b500\b|timeout|timed out|unavailable/.test(lower)) {
      return { kind: 'unavailable', title: '服务暂时不可用', message: '服务器忙不过来，等几分钟再试试吧', retryable: true };
    }
    // 3. 操作过频
    if (/rate limit|too many requests|请求过频|操作太频繁/.test(lower)) {
      return { kind: 'rate', title: '操作太频繁了', message: '歇一会儿，稍后再试', retryable: true };
    }
    // 4. 密码错误
    if (/invalid login credentials|incorrect password|wrong password|密码不对|密码错误/.test(lower)) {
      return { kind: 'password', title: '密码不对', message: '再想想，注意大小写哦', retryable: false };
    }
    // 5. 邮箱已注册
    if (/already registered|already been registered|user already|邮箱已注册|已经注册过/.test(lower)) {
      return { kind: 'registered', title: '这个邮箱已经注册过了', message: '直接登录就好，不用重复注册', retryable: false };
    }
    // 6. 邮箱未确认
    if (/email not confirmed|not confirmed/.test(lower) || /邮箱[^。；]*确认/.test(msg)) {
      return { kind: 'unconfirmed', title: '邮箱还没确认', message: '去邮箱里点一下确认链接，然后回来登录', retryable: false };
    }
    // 7. 邮箱格式
    if (/invalid email|邮箱格式|email address/.test(lower)) {
      return { kind: 'email', title: '邮箱格式好像不对', message: '检查一下邮箱地址有没有写错', retryable: false };
    }
    // 8. 邀请码无效/过期（"格式不正确"类输入提示不在此列，原文放行）
    if (/redeem|expired|invalid[ _](code|invite|token)/.test(lower) ||
        /邀请(码|链接|信息)?[^。；]*(无效|过期|失效|不对|错误|已被使用)/.test(msg)) {
      return { kind: 'invite', title: '邀请码不对或已过期', message: '让对方重新生成一个邀请码吧', retryable: false };
    }

    // 兜底 a：中文业务文案——若带"前缀：英文技术细节"，去掉冒号后的纯 ASCII 串
    if (hasChinese(msg)) {
      var cleaned = msg.replace(/[：:]\s*[^\u4e00-\u9fa5]*[A-Za-z][^\u4e00-\u9fa5]*\s*$/, '，请稍后重试');
      return { kind: 'business', title: '操作没成功', message: cleaned, retryable: false };
    }
    // 兜底 b：未识别的英文技术错误——不暴露细节
    return { kind: 'unknown', title: '操作没成功', message: '请稍后再试，或检查网络后重试', retryable: true };
  };

  /* ---------------- 统一错误弹层 ---------------- */

  var errorRetryCb = null;

  /**
   * 显示错误弹层
   * @param {string} title
   * @param {string} message
   * @param {{retry?:Function, retryText?:string}} [opts] 传 retry 回调时显示"重试"按钮
   */
  U.showError = function (title, message, opts) {
    opts = opts || {};
    document.getElementById('error-title').textContent = title || '操作没成功';
    document.getElementById('error-message').textContent = message || '请稍后再试';
    var retryBtn = document.getElementById('error-retry');
    errorRetryCb = null;
    if (typeof opts.retry === 'function') {
      errorRetryCb = opts.retry;
      retryBtn.textContent = opts.retryText || '重试';
      retryBtn.classList.remove('hidden');
    } else {
      retryBtn.classList.add('hidden');
    }
    document.getElementById('error-mask').classList.remove('hidden');
  };

  U.hideError = function () {
    document.getElementById('error-mask').classList.add('hidden');
    errorRetryCb = null;
  };

  /** 便捷方法：映射错误后弹层；mapped.retryable 且传 onRetry 时自动挂重试按钮 */
  U.reportError = function (raw, opts) {
    var mapped = U.mapError(raw);
    var options = opts || {};
    if (mapped.retryable && typeof options.onRetry === 'function') {
      options.retry = options.onRetry;
    }
    U.showError(mapped.title, mapped.message, options);
    return mapped;
  };

  /* ---------------- 按钮 loading（防重复点击） ---------------- */

  var SPINNER_SVG = '<svg class="inline-block animate-spin h-4 w-4 mr-1.5 align-[-2px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
    '<path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"></path></svg>';

  /**
   * 按钮进入/退出 loading：保存原内容 → 禁用+转圈+文案；退出时原样恢复
   * @param {HTMLButtonElement} btn
   * @param {boolean} loading
   * @param {string} [loadingText]
   */
  U.setLoading = function (btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.normalHtml) btn.dataset.normalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('opacity-70');
      btn.innerHTML = '<span class="inline-flex items-center justify-center">' + SPINNER_SVG +
        (loadingText || '处理中…') + '</span>';
    } else {
      btn.disabled = false;
      btn.classList.remove('opacity-70');
      if (typeof btn.dataset.normalHtml === 'string') btn.innerHTML = btn.dataset.normalHtml;
      delete btn.dataset.normalHtml;
    }
  };

  /* ---------------- 输入法遮挡：focus 自动滚动 ---------------- */

  U.bind = function () {
    // focusin（冒泡，可事件委托）
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) return;
      var type = (t.type || '').toLowerCase();
      if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'file'].indexOf(type) >= 0) return;
      // 居中弹层（登录/注册）：键盘弹出时整体上移
      var centerMask = t.closest('.keyboard-adapt');
      if (centerMask) centerMask.classList.add('items-start', 'pt-14');
      // 等键盘弹出后把输入框滚到可视区中部
      setTimeout(function () {
        if (typeof t.scrollIntoView === 'function') {
          t.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 300);
    });

    // focusout：焦点离开居中弹层时恢复位置
    document.addEventListener('focusout', function (e) {
      var mask = e.target.closest ? e.target.closest('.keyboard-adapt') : null;
      if (!mask) return;
      setTimeout(function () {
        if (!mask.contains(document.activeElement)) {
          mask.classList.remove('items-start', 'pt-14');
        }
      }, 100);
    });

    // 错误弹层按钮
    document.getElementById('error-close').addEventListener('click', U.hideError);
    document.getElementById('error-retry').addEventListener('click', function () {
      var cb = errorRetryCb;
      U.hideError();
      if (typeof cb === 'function') cb();
    });
  };

  global.fcUI = U;
})(typeof window !== 'undefined' ? window : this);

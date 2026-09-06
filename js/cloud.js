/* ============================================================
 * cloud.js — Supabase 云端接入（v1.1 批次⑥）
 * 职责：认证（邮箱+密码）与会话管理；同步引擎在 sync.js（批次⑧）
 * 安全：anon key 是前端公开标识，安全全靠 RLS（见 supabase/schema.sql）；
 *       账目内容端到端加密，云端只有密文，本模块不接触明文业务数据。
 * 配置：把下面两个常量替换为你 Supabase 项目的值（Settings → API）。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---- 配置（部署时替换；留空则云功能不可用，应用退化为单机模式） ---- */
  var SUPABASE_URL = 'https://vvbasvrbxscprmnvbvwm.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_UdkIEsYLmX3iLoKIqO29vg_D8qWNrX7';

  var C = {};
  var client = null;

  /** 云功能是否可用（已配置 + supabase-js CDN 加载成功） */
  C.available = function () {
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY &&
              typeof global.supabase !== 'undefined' &&
              typeof global.supabase.createClient === 'function');
  };

  function getClient() {
    if (!C.available()) return null;
    if (!client) {
      client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return client;
  }
  C._client = getClient; // 供 sync.js 使用

  /* ---------------- 认证 ---------------- */

  /** 注册：邮箱+密码；成功后自动登录 */
  C.signUp = function (email, password) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ ok: false, errors: ['云服务未配置'] });
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.resolve({ ok: false, errors: ['请输入正确的邮箱'] });
    if (!/^.{6,}$/.test(password)) return Promise.resolve({ ok: false, errors: ['密码至少 6 位'] });
    return sb.auth.signUp({ email: email, password: password }).then(function (r) {
      if (r.error) return { ok: false, errors: [r.error.message] };
      // 若项目开启了邮箱确认，session 可能为 null
      if (!r.data.session) {
        return { ok: false, errors: ['注册成功，请先到邮箱点击确认链接后再登录（Supabase 默认需确认邮箱）'] };
      }
      return { ok: true, user: r.data.user };
    }).catch(function (e) { return { ok: false, errors: [e.message || '注册失败'] }; });
  };

  /** 登录 */
  C.signIn = function (email, password) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ ok: false, errors: ['云服务未配置'] });
    email = String(email || '').trim().toLowerCase();
    if (!email || !password) return Promise.resolve({ ok: false, errors: ['请输入邮箱和密码'] });
    return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
      if (r.error) return { ok: false, errors: [r.error.message] };
      return { ok: true, user: r.data.user };
    }).catch(function (e) { return { ok: false, errors: [e.message || '登录失败'] }; });
  };

  /** 退出登录（本地数据保留，只是断开云同步） */
  C.signOut = function () {
    var sb = getClient();
    if (!sb) return Promise.resolve({ ok: true });
    return sb.auth.signOut().then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, errors: [e.message || '退出失败'] }; });
  };

  /** 异步获取当前会话（启动时调用一次） */
  C.getSession = function () {
    var sb = getClient();
    if (!sb) return Promise.resolve(null);
    return sb.auth.getSession().then(function (r) {
      return (r && r.data && r.data.session) || null;
    });
  };

  /** 注册登录态变化回调（cb(user|null)） */
  C.onAuthChange = function (cb) {
    var sb = getClient();
    if (!sb) { cb(null); return function () {}; }
    var sub = sb.auth.onAuthStateChange(function (_event, session) {
      cb(session ? session.user : null);
    });
    // 立即推一次当前状态
    sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      cb(s ? s.user : null);
    });
    return function () { if (sub && sub.data && sub.data.unsubscribe) sub.data.unsubscribe(); };
  };

  global.cloud = C;
})(typeof window !== 'undefined' ? window : this);

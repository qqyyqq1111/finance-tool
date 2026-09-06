-- ============================================================
-- finance-tool v1.1 — Supabase 建表 + RLS 脚本
-- 用法：Supabase 控制台 → SQL Editor → 粘贴本文件全部内容 → Run
-- 安全模型：云端只存密文（enc_payload），RLS 保证行级隔离；
--          密钥永不落云端明文，服务商无法解密任何账目。
-- ============================================================

-- pgcrypto 扩展（digest/SHA-256 用于邀请码哈希校验）
create extension if not exists pgcrypto;

-- ---------- 1. 家庭 ----------
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name_enc    text,                                   -- 家庭名密文（familyKey 加密），可空
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ---------- 2. 家庭成员 ----------
create table if not exists public.family_members (
  family_id        uuid not null references public.families(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  member_id        text not null check (member_id in ('m1','m2')),  -- 家庭内角色位
  display_name_enc text,                              -- 昵称密文（familyKey 加密）
  joined_at        timestamptz not null default now(),
  primary key (family_id, user_id),
  unique (family_id, member_id)                       -- 每个家庭 m1/m2 各一人
);

-- ---------- 3. 邀请码（一次性） ----------
create table if not exists public.invites (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  enc_family_key text not null,                       -- familyKey 双路包装密文 JSON：{s:链接secret包装, c:短码包装}，均为 AES-GCM(PBKDF2(码))
  code_hash      text not null,                       -- 24字符链接 secret 的 SHA-256（不存明文）
  short_code     text not null,                       -- 8位人类可读短码（辅助兜底，明文存储靠 RLS+24h+一次性兜底）
  expires_at     timestamptz not null,
  used           boolean not null default false,
  attempts       int not null default 0,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists invites_short_idx on public.invites(short_code) where used = false;

-- ---------- 4. 家庭空间文档（公开账 + 对方私密账密文） ----------
-- entity_id 用 text：兼容客户端现有 id（tx_xxx/st_xxx/cat_xxx 字符串，全局唯一）
create table if not exists public.family_docs (
  family_id    uuid not null references public.families(id) on delete cascade,
  entity_type  text not null,                        -- 'tx' | 'settlement' | 'category' | 'settings'
  entity_id    text not null,
  enc_payload  text not null,                        -- AES-GCM 密文
  enc_key      text not null check (enc_key in ('family','personal')),
  owner_uid    uuid not null,                        -- 写入者（personal 密文归属用）
  updated_at   bigint not null,                      -- 毫秒时间戳（LWW 依据，客户端时钟经服务端校正）
  device_id    text not null,
  deleted      boolean not null default false,       -- 软删墓碑
  primary key (family_id, entity_type, entity_id)
);
create index if not exists family_docs_sync_idx on public.family_docs(family_id, updated_at);

-- ---------- 5. 个人空间文档（小金库 + 个人密钥备份，RLS 仅本人） ----------
create table if not exists public.personal_docs (
  user_id      uuid not null references auth.users(id) on delete cascade,
  entity_type  text not null,                        -- 'vault_tx' | '_key_backup'
  entity_id    text not null,
  enc_payload  text not null,
  updated_at   bigint not null,
  device_id    text not null,
  deleted      boolean not null default false,
  primary key (user_id, entity_type, entity_id)
);
create index if not exists personal_docs_sync_idx on public.personal_docs(user_id, updated_at);

-- ============================================================
-- RLS 策略
-- ============================================================
alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.invites        enable row level security;
alter table public.family_docs    enable row level security;
alter table public.personal_docs  enable row level security;

-- 辅助函数：当前用户是否属于某家庭
create or replace function public.is_family_member(fid uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;

-- families：成员可读；创建者在加入 family_members 前也需能读到自己的家庭行（insert.select() 场景）
drop policy if exists families_select on public.families;
create policy families_select on public.families
  for select to authenticated using (public.is_family_member(id) or created_by = auth.uid());
drop policy if exists families_insert on public.families;
create policy families_insert on public.families
  for insert with check (created_by = auth.uid());
drop policy if exists families_update on public.families;
create policy families_update on public.families
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());

-- family_members：同家庭可读；本人可写入自己的成员行（配对 RPC 也会用）
drop policy if exists members_select on public.family_members;
create policy members_select on public.family_members
  for select using (public.is_family_member(family_id) or user_id = auth.uid());
drop policy if exists members_insert on public.family_members;
create policy members_insert on public.family_members
  for insert with check (user_id = auth.uid());
drop policy if exists members_update on public.family_members;
create policy members_update on public.family_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- invites：仅创建者可读/可写；兑换走 RPC（SECURITY DEFINER）
drop policy if exists invites_creator on public.invites;
create policy invites_creator on public.invites
  for all using (created_by = auth.uid()) with check (created_by = auth.uid());

-- family_docs：家庭成员可读写
drop policy if exists fdocs_rw on public.family_docs;
create policy fdocs_rw on public.family_docs
  for all using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id) and owner_uid = auth.uid());

-- personal_docs：仅本人
drop policy if exists pdocs_owner on public.personal_docs;
create policy pdocs_owner on public.personal_docs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- RPC：兑换邀请码（原子：校验 + 计数 + 作废 + 返回密文家庭密钥）
-- 入参 p_short_code：8位短码或24字符链接secret（链接secret的校验在批次⑦细化：
-- v1.1 首期用短码兑换 + 链接直达携带 secret 解密双路径，本 RPC 处理短码路径）
-- ============================================================
create or replace function public.redeem_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv public.invites%rowtype;
begin
  -- 短码或长 secret 都查（短码直接匹配；长 secret 比对 code_hash 由调用方先 hash 传入）
  select * into inv from public.invites
   where used = false
     and expires_at > now()
     and (short_code = p_code or code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex'))
   limit 1;

  if not found then
    -- 统一模糊错误，不泄露是过期还是错误
    return jsonb_build_object('ok', false, 'error', '邀请码无效或已过期');
  end if;

  if inv.attempts >= 5 then
    update public.invites set used = true where id = inv.id;
    return jsonb_build_object('ok', false, 'error', '邀请码错误次数过多已作废，请让对方重新生成');
  end if;

  -- 先加入家庭（m2 位；若已满员则不消耗邀请码）
  begin
    insert into public.family_members (family_id, user_id, member_id)
    values (inv.family_id, auth.uid(), 'm2');
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', '该家庭已配对完成');
  end;

  -- 加入成功后标记邀请码已用（防重放）
  update public.invites set used = true, attempts = attempts + 1 where id = inv.id and used = false;
  if not found then
    return jsonb_build_object('ok', false, 'error', '邀请码已被使用');
  end if;

  return jsonb_build_object(
    'ok', true,
    'family_id', inv.family_id,
    'enc_family_key', inv.enc_family_key
  );
end;
$$;

-- 兑换 RPC 授予已登录用户执行权
grant execute on function public.redeem_invite(text) to authenticated;
grant execute on function public.is_family_member(uuid) to authenticated;

-- ============================================================
-- 表级授权（Supabase 新项目不会自动给新表 GRANT，RLS 之外仍需表权限）
-- 幂等：重复执行无副作用；anon 角色不授权（未登录用户只能走 GoTrue 认证接口）
-- ============================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- 未来新增表默认授权（本版本表已全部建完，属防御性配置）
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

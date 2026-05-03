-- =========================================================================
-- 018_ad_orders.sql — Ad Sales / Production / Payment tracker
--
-- Plan: ~/.claude/plans/i-want-to-glittery-balloon.md
--
-- Adds three new tables and supporting machinery for tracking the full
-- lifecycle of an underwriting/ad sale (production -> airing -> invoice
-- -> payment -> commission payout). Money is involved; integrity is
-- enforced at the DB layer in addition to the API:
--
--   * `org_settings` — single-row config (default commission %, default
--     net-days). Single-row invariant via `id boolean primary key check (id)`.
--   * `ad_orders` — main table; one row per promo. `commission_amount`
--     is a STORED generated column so the formula cannot drift.
--   * `ad_order_amendments` — append-only log of admin amendments after
--     a row has been paid. Inserted only via the `/amend` API which sets
--     a session GUC that the lockdown trigger recognises.
--   * `ad_orders_status` — derived lifecycle view used by filters.
--   * `whrb_semester(date)` — immutable function for ad-hoc semester
--     rollups; functional index on `campaign_start` makes per-period
--     queries indexable without materialising an `accounting_periods`
--     table.
--
-- Trigger stack (mirrors the prospects pattern from 000_init.sql +
-- 001_prospect_update_guard.sql):
--   1) `t_ad_orders_touch` (BEFORE UPDATE) — reuses set_updated_at()
--   2) `t_ad_orders_update_guard` (BEFORE UPDATE) — column-level RBAC
--   3) `t_ad_orders_paid_lockdown` (BEFORE UPDATE) — freezes financial
--      fields after `is_paid=true` unless the `/amend` flow is active.
--   4) `t_ad_orders_audit` (AFTER UPDATE) — emits one event_log row per
--      changed tracked field; mirrors audit_prospect_change().
--
-- Idempotent: `create table if not exists`, `create or replace function`,
-- `drop trigger if exists` + `create trigger`. Re-run is safe.
--
-- Rollback: 018_rollback.sql drops in reverse order. WARNING: dropping
-- ad_orders deletes data. See ROLLBACK.md.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) org_settings — single-row config
-- -------------------------------------------------------------------------
create table if not exists public.org_settings (
  id boolean primary key default true check (id),
  default_commission_pct numeric(5,2) not null default 15
    check (default_commission_pct between 0 and 100),
  default_invoice_net_days integer not null default 30
    check (default_invoice_net_days between 0 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.org_settings (id) values (true) on conflict (id) do nothing;

-- -------------------------------------------------------------------------
-- 2) ad_orders — main table
-- -------------------------------------------------------------------------
create table if not exists public.ad_orders (
  id uuid primary key default gen_random_uuid(),

  -- Human-facing key. Server normalizes (uppercase + single-space) before insert.
  promo_id text not null unique
    check (promo_id ~ '^[A-Z]{2,4} [0-9]{4}$'),

  -- Company linkage. Nullable for one-off advertisers without a prospect row.
  -- ON DELETE RESTRICT so we cannot orphan paid orders.
  prospect_id uuid references public.prospects(id) on delete restrict,
  company_name text not null check (length(company_name) between 1 and 300),

  -- Sales reference doc (Google Doc URL). Optional.
  package_doc_url text
    check (package_doc_url is null
           or package_doc_url ~* '^https://(docs|drive)\.google\.com/'),

  -- Pricing modifiers.
  is_nonprofit_rate boolean not null default false,
  discount_pct numeric(5,2) not null default 0
    check (discount_pct >= 0 and discount_pct <= 100),

  -- Payment contact (denormalised; orders survive a prospect rename).
  payment_contact_name text check (length(payment_contact_name) <= 200),
  payment_contact_email text
    check (payment_contact_email is null
           or payment_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  -- Campaign window.
  campaign_start date not null,
  campaign_end   date not null,
  constraint ad_orders_campaign_range check (campaign_end >= campaign_start),

  -- Booked total. Money is numeric(12,2): exact decimal up to ~$10B.
  -- Postgres returns numeric as a string via PostgREST; client-side parsing
  -- happens at the query-helper boundary. NEVER compute commission in JS.
  total_amount numeric(12,2) not null check (total_amount >= 0),

  -- Attribution. RESTRICT on delete so attribution is never lost: an admin
  -- must reassign before a profile can be removed.
  salesperson_id uuid references public.profiles(id) on delete restrict,
  commission_pct numeric(5,2) not null default 15
    check (commission_pct >= 0 and commission_pct <= 100),

  -- Production.
  ad_produced boolean not null default false,
  ad_produced_at timestamptz,
  se_engineer_id uuid references public.profiles(id) on delete restrict,

  -- Invoice & client payment.
  invoice_number text check (length(invoice_number) <= 50),
  invoice_sent_at date,
  is_paid boolean not null default false,
  paid_at timestamptz,
  client_check_number text check (length(client_check_number) <= 50),

  -- Commission. STORED generated column — single source of truth for the
  -- formula. Cannot be written directly; Postgres rejects explicit writes.
  commission_amount numeric(12,2)
    generated always as (round(total_amount * commission_pct / 100.0, 2)) stored,
  commission_paid boolean not null default false,
  commission_paid_at timestamptz,

  notes text check (length(notes) <= 5000),

  -- Soft archive (no hard DELETE; RLS denies it).
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,

  -- Bookkeeping.
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Lifecycle gates: enforce illegal state combinations cannot exist.
  constraint ad_orders_paid_requires_invoice
    check (is_paid = false or invoice_sent_at is not null),
  constraint ad_orders_commission_requires_paid
    check (commission_paid = false or is_paid = true),

  -- Boolean ⇔ timestamp consistency.
  constraint ad_orders_paid_at_consistent
    check ((is_paid = false and paid_at is null)
        or (is_paid = true  and paid_at is not null)),
  constraint ad_orders_commpaid_at_consistent
    check ((commission_paid = false and commission_paid_at is null)
        or (commission_paid = true  and commission_paid_at is not null)),
  constraint ad_orders_produced_at_consistent
    check ((ad_produced = false and ad_produced_at is null)
        or (ad_produced = true  and ad_produced_at is not null))
);

-- -------------------------------------------------------------------------
-- 3) ad_order_amendments — immutable post-paid amendment log
-- -------------------------------------------------------------------------
create table if not exists public.ad_order_amendments (
  id uuid primary key default gen_random_uuid(),
  ad_order_id uuid not null references public.ad_orders(id) on delete restrict,
  field text not null check (length(field) between 1 and 64),
  old_value jsonb not null,
  new_value jsonb not null,
  reason text not null check (length(reason) between 5 and 1000),
  amended_by uuid not null references public.profiles(id) on delete restrict,
  amended_at timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 4) Indexes
-- -------------------------------------------------------------------------
create index if not exists idx_ad_orders_salesperson  on public.ad_orders (salesperson_id);
create index if not exists idx_ad_orders_se_engineer  on public.ad_orders (se_engineer_id) where se_engineer_id is not null;
create index if not exists idx_ad_orders_prospect     on public.ad_orders (prospect_id) where prospect_id is not null;
create index if not exists idx_ad_orders_campaign     on public.ad_orders (campaign_start, campaign_end);
create index if not exists idx_ad_orders_unpaid       on public.ad_orders (campaign_start)
  where is_paid = false and archived_at is null;
create index if not exists idx_ad_orders_comm_unpaid  on public.ad_orders (salesperson_id)
  where is_paid = true and commission_paid = false and archived_at is null;
create unique index if not exists uq_ad_orders_invoice_number
  on public.ad_orders (invoice_number) where invoice_number is not null;

create index if not exists idx_ad_order_amendments_order
  on public.ad_order_amendments (ad_order_id, amended_at desc);

-- -------------------------------------------------------------------------
-- 5) whrb_semester(date) — immutable; powers per-semester rollups
--    Harvard convention: Fall = Aug-Dec, Spring = Jan-May, Summer = Jun-Jul.
-- -------------------------------------------------------------------------
create or replace function public.whrb_semester(d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from d) between 1 and 5 then 'SP' || extract(year from d)::text
    when extract(month from d) between 6 and 7 then 'SU' || extract(year from d)::text
    else 'FA' || extract(year from d)::text
  end;
$$;

create index if not exists idx_ad_orders_semester
  on public.ad_orders ((public.whrb_semester(campaign_start)));

-- -------------------------------------------------------------------------
-- 6) ad_orders_status — derived lifecycle view (used by filter UI)
--    security_invoker so RLS on ad_orders applies to view queries.
-- -------------------------------------------------------------------------
create or replace view public.ad_orders_status
  with (security_invoker = true) as
select id,
  case
    when archived_at is not null      then 'archived'
    when commission_paid              then 'closed'
    when is_paid                      then 'awaiting_commission'
    when invoice_sent_at is not null  then 'awaiting_payment'
    when ad_produced                  then 'awaiting_invoice'
    else                                   'pending_production'
  end as status
from public.ad_orders;

-- -------------------------------------------------------------------------
-- 7) Triggers — BEFORE UPDATE
--
-- BEFORE UPDATE triggers fire alphabetically by name. With the names below,
-- the order is:
--   a) t_ad_orders_paid_lockdown   (P)
--   b) t_ad_orders_touch           (T)
--   c) t_ad_orders_update_guard    (U)
-- Either deny-trigger may fire first; both will deny the bad path. The
-- touch trigger only sets updated_at and is harmless either side.
-- -------------------------------------------------------------------------

drop trigger if exists t_ad_orders_touch on public.ad_orders;
create trigger t_ad_orders_touch
  before update on public.ad_orders
  for each row execute function public.set_updated_at();

-- 7a) Column-level RBAC. Mirrors enforce_prospect_update_guard().
--     - service role / pipeline (auth.uid() is null) bypass.
--     - admin role: full access (subject to paid-lockdown).
--     - salesperson on this row: may change everything except admin_only_fields.
--     - SE engineer on this row: may change ONLY se_engineer_allowed.
--     - anyone else: row-level UPDATE policy denies; this trigger denies as
--       a defence-in-depth fallback.
create or replace function public.enforce_ad_order_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  is_salesperson boolean;
  is_se boolean;
  f text;
  -- Fields only admins may change. Includes attribution (salesperson,
  -- engineer, identity) and ALL financial / pricing-modifier fields.
  -- INSERT is already admin-only, so the "salesperson types the deal"
  -- workflow happens at create-time; everything money-shaped stays
  -- admin-controlled afterward. Reps may still edit notes,
  -- payment_contact_*, package_doc_url, ad_produced/_at (see below).
  admin_only_fields text[] := array[
    -- payment status
    'is_paid','paid_at',
    'commission_paid','commission_paid_at',
    'commission_pct',
    'invoice_number','invoice_sent_at',
    'client_check_number',
    -- booked amount + pricing modifiers
    'total_amount','discount_pct','is_nonprofit_rate',
    -- campaign window (affects revenue recognition + reminders)
    'campaign_start','campaign_end',
    -- archive + attribution + identity
    'archived_at','archived_by',
    'salesperson_id','se_engineer_id',
    'promo_id','prospect_id','company_name',
    'created_by','created_at'
  ];
  -- Fields the SE engineer may change. Plus the always-allowed bookkeeping
  -- columns updated by other triggers (updated_at).
  se_engineer_allowed text[] := array[
    'ad_produced','ad_produced_at',
    'notes','package_doc_url',
    'updated_at'
  ];
  k text;
begin
  if actor is null then
    return new;
  end if;

  select exists(select 1 from public.profiles where id = actor and role = 'admin')
    into is_admin;
  if is_admin then
    return new;
  end if;

  is_salesperson := (old.salesperson_id is not distinct from actor)
                 or (new.salesperson_id is not distinct from actor);
  is_se          := (old.se_engineer_id is not distinct from actor)
                 or (new.se_engineer_id is not distinct from actor);

  if is_salesperson then
    foreach f in array admin_only_fields loop
      if (to_jsonb(old) -> f) is distinct from (to_jsonb(new) -> f) then
        raise exception 'ad_orders.% requires admin role', f using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;

  if is_se then
    -- For SE engineer: only allow listed fields to differ.
    for k in select jsonb_object_keys(to_jsonb(new))
    loop
      if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k)
         and not (k = any(se_engineer_allowed))
      then
        raise exception
          'ad_orders.%: SE engineer may only edit ad_produced, notes, or package_doc_url', k
          using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;

  raise exception 'ad_orders update denied: actor is neither admin, salesperson, nor SE engineer for this row'
    using errcode = '42501';
end;
$$;

drop trigger if exists t_ad_orders_update_guard on public.ad_orders;
create trigger t_ad_orders_update_guard
  before update on public.ad_orders
  for each row execute function public.enforce_ad_order_update_guard();

-- 7b) Paid-lockdown. Once OLD.is_paid = true, only the listed fields may
--     change. The `/amend` API sets a session GUC `app.amend_in_progress`
--     to 'on' before its UPDATE, which this trigger checks to allow the
--     change through. The handler resets the GUC after the UPDATE.
--     Service role (auth.uid() is null) bypasses entirely.
create or replace function public.enforce_ad_order_paid_lockdown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  -- Allowed-after-paid set: fields that may continue to change after
  -- the row is locked.
  allowed_after_paid text[] := array[
    'notes',
    'commission_paid','commission_paid_at',
    'archived_at','archived_by',
    'updated_at'
  ];
  k text;
  amend_active text;
begin
  if old.is_paid is not true then
    return new;
  end if;
  if actor is null then
    return new;
  end if;

  amend_active := current_setting('app.amend_in_progress', true);
  if amend_active = 'on' then
    return new;
  end if;

  for k in select jsonb_object_keys(to_jsonb(new))
  loop
    if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k)
       and not (k = any(allowed_after_paid))
    then
      raise exception
        'ad_orders.% is locked after is_paid = true; use the /amend flow', k
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists t_ad_orders_paid_lockdown on public.ad_orders;
create trigger t_ad_orders_paid_lockdown
  before update on public.ad_orders
  for each row execute function public.enforce_ad_order_paid_lockdown();

-- -------------------------------------------------------------------------
-- 8) Audit trigger — AFTER UPDATE; emits one event_log row per changed
--    tracked field. Mirrors audit_prospect_change() in 000_init.sql:244.
-- -------------------------------------------------------------------------
create or replace function public.audit_ad_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  -- `commission_amount` is intentionally omitted: it's a STORED generated
  -- column whose value is fully determined by total_amount + commission_pct.
  -- Auditing it would emit a duplicate event_log row alongside the
  -- source-of-truth column change.
  tracked text[] := array[
    'promo_id','prospect_id','company_name','package_doc_url',
    'is_nonprofit_rate','discount_pct',
    'payment_contact_name','payment_contact_email',
    'campaign_start','campaign_end',
    'total_amount','salesperson_id','commission_pct',
    'ad_produced','ad_produced_at','se_engineer_id',
    'invoice_number','invoice_sent_at',
    'is_paid','paid_at','client_check_number',
    'commission_paid','commission_paid_at',
    'notes','archived_at','archived_by'
  ];
  actor uuid := auth.uid();
begin
  foreach f in array tracked loop
    if (to_jsonb(old) -> f) is distinct from (to_jsonb(new) -> f) then
      insert into public.event_log (source, level, category, message, context, user_id)
      values (
        case when actor is null then 'pipeline' else 'web_server' end,
        'info',
        case f
          when 'is_paid'         then 'ad_order_paid'
          when 'commission_paid' then 'ad_order_commission_paid'
          when 'salesperson_id'  then 'ad_order_assignment_change'
          when 'se_engineer_id'  then 'ad_order_assignment_change'
          when 'archived_at'     then 'ad_order_archive_change'
          else                        'ad_order_field_change'
        end,
        format('ad_order %s: %s changed', new.id, f),
        jsonb_build_object(
          'ad_order_id', new.id,
          'promo_id',    new.promo_id,
          'field',       f,
          'old',         to_jsonb(old) -> f,
          'new',         to_jsonb(new) -> f,
          'actor_id',    actor
        ),
        actor
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists t_ad_orders_audit on public.ad_orders;
create trigger t_ad_orders_audit
  after update on public.ad_orders
  for each row execute function public.audit_ad_order_change();

-- Also reuse set_updated_at on org_settings.
drop trigger if exists t_org_settings_touch on public.org_settings;
create trigger t_org_settings_touch
  before update on public.org_settings
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- 9) Row Level Security
-- -------------------------------------------------------------------------

-- org_settings ------------------------------------------------------------
alter table public.org_settings enable row level security;

drop policy if exists p_orgsettings_read on public.org_settings;
create policy p_orgsettings_read on public.org_settings
  for select using (auth.uid() is not null);

drop policy if exists p_orgsettings_update on public.org_settings;
create policy p_orgsettings_update on public.org_settings
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- INSERT/DELETE blocked (single-row managed via the seed insert).
drop policy if exists p_orgsettings_no_insert on public.org_settings;
create policy p_orgsettings_no_insert on public.org_settings
  for insert with check (false);

drop policy if exists p_orgsettings_no_delete on public.org_settings;
create policy p_orgsettings_no_delete on public.org_settings
  for delete using (false);

-- ad_orders ---------------------------------------------------------------
alter table public.ad_orders enable row level security;

-- SELECT: any authenticated user. Reps see all rows (per product decision).
drop policy if exists p_ad_orders_read on public.ad_orders;
create policy p_ad_orders_read on public.ad_orders
  for select using (auth.uid() is not null);

-- INSERT: admin only.
drop policy if exists p_ad_orders_insert on public.ad_orders;
create policy p_ad_orders_insert on public.ad_orders
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- UPDATE: admin OR the row's salesperson OR the row's SE engineer.
-- Column-level enforcement happens in t_ad_orders_update_guard +
-- t_ad_orders_paid_lockdown.
drop policy if exists p_ad_orders_update on public.ad_orders;
create policy p_ad_orders_update on public.ad_orders
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or salesperson_id = auth.uid()
    or se_engineer_id = auth.uid()
  );

-- DELETE: blocked entirely. Use archived_at.
drop policy if exists p_ad_orders_no_delete on public.ad_orders;
create policy p_ad_orders_no_delete on public.ad_orders
  for delete using (false);

-- ad_order_amendments -----------------------------------------------------
alter table public.ad_order_amendments enable row level security;

-- SELECT: any authenticated user (so the Amendments tab renders for everyone).
drop policy if exists p_ad_order_amend_read on public.ad_order_amendments;
create policy p_ad_order_amend_read on public.ad_order_amendments
  for select using (auth.uid() is not null);

-- INSERT: admin only. The /amend handler runs as the user (not service role)
-- and the policy gates correctly via auth.uid().
drop policy if exists p_ad_order_amend_insert on public.ad_order_amendments;
create policy p_ad_order_amend_insert on public.ad_order_amendments
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    and amended_by = auth.uid()
  );

-- UPDATE/DELETE: blocked. Amendments are immutable.
drop policy if exists p_ad_order_amend_no_update on public.ad_order_amendments;
create policy p_ad_order_amend_no_update on public.ad_order_amendments
  for update using (false);

drop policy if exists p_ad_order_amend_no_delete on public.ad_order_amendments;
create policy p_ad_order_amend_no_delete on public.ad_order_amendments
  for delete using (false);

-- -------------------------------------------------------------------------
-- 10) ad_order_amend(p_ad_order_id, p_field, p_new_value_text, p_reason)
--
-- Admin-only RPC that:
--   * verifies the caller is an admin
--   * captures the OLD value of the target field as jsonb
--   * sets a transaction-local GUC (`app.amend_in_progress = 'on'`) so the
--     paid-lockdown trigger lets the UPDATE through
--   * dispatches a typed UPDATE on the named column
--   * inserts an immutable row into ad_order_amendments
--
-- The dispatch table is the only "amendable" surface — fields not listed
-- (e.g. archived_at, commission_paid, the audit columns themselves)
-- raise. Pass `p_new_value_text` as the string the user typed; the
-- function casts based on the column type. Empty string means NULL for
-- nullable columns.
-- -------------------------------------------------------------------------
create or replace function public.ad_order_amend(
  p_ad_order_id uuid,
  p_field text,
  p_new_value_text text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  old_value jsonb;
begin
  if actor is null then
    raise exception 'ad_order_amend requires an authenticated user' using errcode = '42501';
  end if;
  select exists(select 1 from public.profiles where id = actor and role = 'admin')
    into is_admin;
  if not is_admin then
    raise exception 'ad_order_amend requires admin role' using errcode = '42501';
  end if;
  if length(coalesce(p_reason, '')) < 5 then
    raise exception 'ad_order_amend: reason must be at least 5 characters' using errcode = '22023';
  end if;

  -- Snapshot old value.
  execute format('select to_jsonb(t.%I) from public.ad_orders t where t.id = $1', p_field)
    into old_value using p_ad_order_id;
  if old_value is null then
    raise exception 'ad_order_amend: ad_order % not found', p_ad_order_id using errcode = '23503';
  end if;

  -- Bypass paid-lockdown for this transaction only.
  perform set_config('app.amend_in_progress', 'on', true);

  -- Dispatch typed UPDATE based on field. Nullable columns coerce '' -> NULL.
  case p_field
    -- text columns
    when 'promo_id' then
      execute 'update public.ad_orders set promo_id = upper(regexp_replace(trim($1), ''\s+'', '' '', ''g'')) where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'company_name' then
      execute 'update public.ad_orders set company_name = $1 where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'package_doc_url' then
      execute 'update public.ad_orders set package_doc_url = nullif($1, '''') where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'payment_contact_name' then
      execute 'update public.ad_orders set payment_contact_name = nullif($1, '''') where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'payment_contact_email' then
      execute 'update public.ad_orders set payment_contact_email = nullif($1, '''') where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'invoice_number' then
      execute 'update public.ad_orders set invoice_number = nullif($1, '''') where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'client_check_number' then
      execute 'update public.ad_orders set client_check_number = nullif($1, '''') where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'notes' then
      execute 'update public.ad_orders set notes = nullif($1, '''') where id = $2'
        using p_new_value_text, p_ad_order_id;

    -- uuid columns (FKs)
    when 'prospect_id' then
      execute 'update public.ad_orders set prospect_id = nullif($1, '''')::uuid where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'salesperson_id' then
      execute 'update public.ad_orders set salesperson_id = nullif($1, '''')::uuid where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'se_engineer_id' then
      execute 'update public.ad_orders set se_engineer_id = nullif($1, '''')::uuid where id = $2'
        using p_new_value_text, p_ad_order_id;

    -- numeric / money
    when 'total_amount', 'discount_pct', 'commission_pct' then
      execute format('update public.ad_orders set %I = $1::numeric where id = $2', p_field)
        using p_new_value_text, p_ad_order_id;

    -- date columns
    when 'campaign_start', 'campaign_end', 'invoice_sent_at' then
      execute format('update public.ad_orders set %I = nullif($1, '''')::date where id = $2', p_field)
        using p_new_value_text, p_ad_order_id;

    -- timestamptz
    when 'ad_produced_at' then
      execute 'update public.ad_orders set ad_produced_at = nullif($1, '''')::timestamptz where id = $2'
        using p_new_value_text, p_ad_order_id;

    -- booleans
    when 'is_nonprofit_rate', 'ad_produced' then
      execute format('update public.ad_orders set %I = $1::boolean where id = $2', p_field)
        using p_new_value_text, p_ad_order_id;

    else
      raise exception 'ad_order_amend: field % is not amendable', p_field using errcode = '22023';
  end case;

  -- set_config(..., true) is transaction-local and clears at COMMIT/ROLLBACK,
  -- but reset explicitly for clarity.
  perform set_config('app.amend_in_progress', 'off', true);

  -- Record the amendment. new_value stored as the user-typed string wrapped
  -- as jsonb (one source of truth for what the actor actually requested).
  insert into public.ad_order_amendments
    (ad_order_id, field, old_value, new_value, reason, amended_by)
  values
    (p_ad_order_id, p_field, old_value, to_jsonb(p_new_value_text), p_reason, actor);
end;
$$;

-- =========================================================================
-- End of 018_ad_orders.sql
-- =========================================================================

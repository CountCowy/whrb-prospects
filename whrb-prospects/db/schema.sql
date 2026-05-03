-- WHRB prospects — initial schema (Stage 1)
-- =========================================================================
-- 10 tables + indexes + 5 triggers + RLS policies.
-- Canonical location: whrb-web/supabase/migrations/000_init.sql
-- Mirrored (read-only reference) at: whrb-prospects/db/schema.sql
-- Apply via: whrb-prospects/scripts/apply_migration.py
--
-- DO NOT EDIT ONE COPY WITHOUT THE OTHER. If you change this file, regenerate
-- the mirror with: cp whrb-web/supabase/migrations/000_init.sql whrb-prospects/db/schema.sql
-- =========================================================================

-- Required extension for gen_random_uuid()
create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------
-- Tables
-- -------------------------------------------------------------------------

-- 1) profiles: extends auth.users
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  display_name text,
  role text not null check (role in ('admin','rep')) default 'rep',
  created_at timestamptz default now(),
  -- Stage 9 (002_profiles_deactivation.sql): non-null blocks sign-in via
  -- whrb-web/middleware.ts. Cleared by /admin/users Reactivate.
  deactivated_at timestamptz
);

-- 2) prospects: main table. Columns mirror pipeline.py::CSV_COLUMNS plus
--    user-facing state and audit.
create table prospects (
  id uuid primary key default gen_random_uuid(),
  business_key text unique not null,

  company_name text not null,
  website text,
  company_phone text,
  company_email text,
  sales_email text,
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  contact_linkedin text,
  address text,
  zip text,
  tier char(1),
  category text,
  rating numeric,
  review_count int,
  source text,
  priority_score int,
  seasonality_window text,
  pipeline_notes text,
  alt_fields jsonb default '{}'::jsonb,

  state text not null check (state in (
    'researching','waiting_response','initial_contact',
    'ongoing_contact','sold','previous_client','dead'
  )) default 'researching',
  is_nonprofit boolean,
  nonprofit_source text check (nonprofit_source in ('irs_bmf','propublica','manual')),
  ein text,
  assigned_to uuid references profiles(id) on delete set null,
  assigned_at timestamptz,

  user_overrides jsonb default '{}'::jsonb,

  pipeline_last_seen_at timestamptz,
  created_source text not null default 'pipeline' check (created_source in ('pipeline','manual')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_prospects_tier_score on prospects (tier, priority_score desc);
create index idx_prospects_score      on prospects (priority_score desc);
create index idx_prospects_assigned   on prospects (assigned_to);
create index idx_prospects_state      on prospects (state);
create index idx_prospects_zip        on prospects (zip);

-- 3) prospect_notes: soft-delete thread
create table prospect_notes (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index idx_notes_prospect_created on prospect_notes (prospect_id, created_at desc);
create index idx_notes_prospect_deleted on prospect_notes (prospect_id, deleted_at);

-- 4) source_config: admin UI toggles
create table source_config (
  source_key text primary key,
  enabled boolean default true,
  extra_args jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid references profiles(id)
);

-- 5) pipeline_runs: audit + queue
create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  triggered_by uuid references profiles(id),
  status text not null check (status in ('queued','running','success','failed')) default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  rows_upserted int,
  error text,
  args text,
  -- Stage 10c: GitHub Actions workflow run ID (nullable). Added by
  -- migration 005_pipeline_runs_github_run_id.sql; populated by
  -- .github/workflows/run-pipeline.yml when transitioning queued→running.
  -- Used by /api/pipeline/run/[id]/cancel to target the workflow run via
  -- POST /repos/.../actions/runs/{id}/cancel.
  github_run_id bigint,
  created_at timestamptz default now()
);

-- 6) event_log: unified errors + events from pipeline + web
create table event_log (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('pipeline','web_server','web_client')),
  level text not null check (level in ('debug','info','warn','error','fatal')),
  category text,
  message text not null,
  context jsonb default '{}'::jsonb,
  user_id uuid references profiles(id) on delete set null,
  pipeline_run_id uuid references pipeline_runs(id) on delete set null,
  url text,
  http_status int,
  created_at timestamptz default now()
);
create index idx_log_created        on event_log (created_at desc);
create index idx_log_level_created  on event_log (level, created_at desc);
create index idx_log_source_cat     on event_log (source, category);
create index idx_log_pipeline_run   on event_log (pipeline_run_id);

-- 7) feedback
create table feedback (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete set null,
  category text check (category in ('bug','idea','data_issue','other')) default 'other',
  body text not null check (length(body) between 1 and 2000),
  page_url text,
  user_agent text,
  status text not null check (status in ('new','acknowledged','in_progress','closed')) default 'new',
  admin_response text,
  created_at timestamptz default now()
);
create index idx_feedback_status_created on feedback (status, created_at desc);

-- 8) user_preferences
create table user_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  notify_assignment_toast boolean not null default true,
  notify_assignment_email boolean not null default true,
  notify_mention_toast    boolean not null default true,
  notify_mention_email    boolean not null default false,
  notify_run_complete_email boolean not null default false,
  notify_feedback_status_email boolean not null default true,
  updated_at timestamptz default now()
);

-- 9) notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in (
    'assigned','unassigned','note_mention','run_complete','feedback_status'
  )),
  prospect_id uuid references prospects(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  payload jsonb default '{}'::jsonb,
  read_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz default now()
);
create index idx_notif_recipient_created on notifications (recipient_id, created_at desc);
create index idx_notif_recipient_read    on notifications (recipient_id, read_at);

-- 10) prospect_presence
create table prospect_presence (
  prospect_id uuid not null references prospects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (prospect_id, user_id)
);
create index idx_presence_last_seen on prospect_presence (last_seen_at);

-- -------------------------------------------------------------------------
-- Triggers
-- -------------------------------------------------------------------------

-- T1) on_auth_user_created: auto-create a profiles row (role='rep') on signup
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'rep')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- T2) set_updated_at: generic updated_at maintenance
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger t_prospects_updated_at        before update on prospects
  for each row execute function public.set_updated_at();
create trigger t_source_config_updated_at    before update on source_config
  for each row execute function public.set_updated_at();
create trigger t_user_preferences_updated_at before update on user_preferences
  for each row execute function public.set_updated_at();

-- T3) set_edited_at: stamp prospect_notes.edited_at only when body changes
--     and only while not soft-deleted.
create or replace function public.set_edited_at()
returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at = now();
  end if;
  return new;
end;
$$;

create trigger t_notes_edited_at before update on prospect_notes
  for each row execute function public.set_edited_at();

-- T4) audit_prospect_change: emit an event_log row per changed column on prospects.
--     Fires AFTER UPDATE only — INSERTs generate no audit events by design.
create or replace function public.audit_prospect_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  tracked text[] := array[
    'state','assigned_to','tier','company_name','company_phone','company_email',
    'contact_name','contact_email','contact_phone','website','is_nonprofit',
    'nonprofit_source','ein','priority_score','user_overrides'
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
          when 'state'       then 'prospect_state_change'
          when 'assigned_to' then 'prospect_assignment_change'
          else                    'prospect_field_change'
        end,
        format('prospect %s: %s changed', new.id, f),
        jsonb_build_object(
          'prospect_id', new.id,
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

create trigger t_prospects_audit after update on prospects
  for each row execute function public.audit_prospect_change();

-- -------------------------------------------------------------------------
-- Row Level Security
-- -------------------------------------------------------------------------

-- profiles
alter table profiles enable row level security;
create policy p_profiles_read on profiles for select using (true);
create policy p_profiles_self on profiles for update using (id = auth.uid());

-- prospects
alter table prospects enable row level security;
create policy p_prospects_read on prospects for select using (auth.uid() is not null);
create policy p_prospects_insert on prospects for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
-- Final update policy: anyone authenticated may update. Column-level guards
-- (e.g. "only the assignee or admin may change scraped fields") are enforced
-- at the API layer. This policy is the broad version referenced in the plan's
-- clarifications; the narrower earlier draft ("assigned_to = auth.uid() OR admin")
-- is superseded.
create policy p_prospects_update on prospects for update using (auth.uid() is not null);

-- prospect_notes
alter table prospect_notes enable row level security;
create policy p_notes_read on prospect_notes for select using (
  auth.uid() is not null and (
    deleted_at is null
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
);
create policy p_notes_insert on prospect_notes for insert with check (author_id = auth.uid());
create policy p_notes_update on prospect_notes for update using (
  author_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- source_config
alter table source_config enable row level security;
create policy p_src_read on source_config for select using (auth.uid() is not null);
create policy p_src_write on source_config for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- pipeline_runs
alter table pipeline_runs enable row level security;
create policy p_runs_read on pipeline_runs for select using (auth.uid() is not null);
create policy p_runs_insert on pipeline_runs for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- cron_state (014_cron_state.sql) — opaque idempotence cursors per cron job.
-- Read for admins only (powers /admin diagnostics if surfaced); writes only
-- via service-role connections (cron jobs bypass RLS).
create table if not exists public.cron_state (
  key         text primary key,
  last_run_at timestamptz not null default now()
);
alter table public.cron_state enable row level security;
drop policy if exists p_cron_state_read on public.cron_state;
create policy p_cron_state_read on public.cron_state
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- event_log
alter table event_log enable row level security;
create policy p_log_read on event_log for select using (auth.uid() is not null);
create policy p_log_insert on event_log for insert with check (
  auth.uid() is not null and (user_id is null or user_id = auth.uid())
);

-- feedback
alter table feedback enable row level security;
create policy p_feedback_read_self_or_admin on feedback for select using (
  author_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy p_feedback_insert on feedback for insert with check (author_id = auth.uid());
create policy p_feedback_admin_update on feedback for update using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- user_preferences
alter table user_preferences enable row level security;
create policy p_prefs_self on user_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notifications
alter table notifications enable row level security;
create policy p_notif_read_self   on notifications for select using (recipient_id = auth.uid());
create policy p_notif_update_self on notifications for update using (recipient_id = auth.uid());

-- prospect_presence
alter table prospect_presence enable row level security;
create policy p_presence_read on prospect_presence for select using (auth.uid() is not null);
create policy p_presence_self on prospect_presence for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- End of 000_init.sql
-- =========================================================================

-- =========================================================================
-- Stage T1: 007_tag_schema.sql (mirrored read-only reference)
-- Canonical: whrb-web/supabase/migrations/007_tag_schema.sql
-- See that file for the authoritative DDL. This block exists so a Python
-- developer reading the mirror sees the full picture without leaving the
-- pipeline tree.
-- =========================================================================

create table if not exists public.tag_vocabulary (
  id uuid primary key default gen_random_uuid(),
  axis text not null check (axis in (
    'sector','operating_model','genre','affiliation','cadence',
    'daypart_fit','history','compliance','other'
  )),
  value text not null,
  status text not null default 'active' check (status in (
    'active','pending_admin_review','deprecated'
  )),
  replacement_id uuid references public.tag_vocabulary(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (axis, value)
);

create index if not exists idx_tag_vocabulary_axis_status
  on public.tag_vocabulary (axis, status);

create table if not exists public.prospect_tags (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  tag_id uuid not null references public.tag_vocabulary(id),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz,
  unique (prospect_id, tag_id)
);

create index if not exists idx_prospect_tags_prospect_id
  on public.prospect_tags (prospect_id);
create index if not exists idx_prospect_tags_tag_id
  on public.prospect_tags (tag_id);

-- notifications.kind extended with 'tag_vocab_pending'.
-- Triggers + RLS + merge_tag_vocabulary RPC: see canonical migration.

-- =========================================================================
-- End of 007_tag_schema.sql mirror
-- =========================================================================

-- =========================================================================
-- 008_daypart_view.sql mirror (read-only reference; canonical at
-- whrb-web/supabase/migrations/008_daypart_view.sql). Stage T2.
-- =========================================================================

alter table public.prospect_tags
  add column if not exists suppressed_at timestamptz,
  add column if not exists suppressed_by uuid references auth.users(id) on delete set null;

create index if not exists idx_prospect_tags_suppressed
  on public.prospect_tags (prospect_id)
  where suppressed_at is not null;

alter table public.pipeline_runs
  add column if not exists tag_sync_status text
    check (tag_sync_status in ('pending', 'ok', 'failed'));

-- derive_daypart(uuid) function + prospect_daypart view: see canonical migration.

-- =========================================================================
-- End of 008_daypart_view.sql mirror
-- =========================================================================

-- =========================================================================
-- 009_tag_triggers.sql mirror (read-only reference; canonical at
-- whrb-web/supabase/migrations/009_tag_triggers.sql). Stage T3.
-- =========================================================================

alter table public.profiles
  add column if not exists vocab_notify_mode text not null default 'digest_daily'
    check (vocab_notify_mode in ('instant', 'digest_daily', 'digest_off'));

alter table public.notifications
  add column if not exists digested_at timestamptz;

create index if not exists idx_notif_kind_digested
  on public.notifications (kind, digested_at)
  where digested_at is null;

-- Partial unique index for atomic dedup of open tag_vocab_pending
-- notifications. (M2 fix; canonical body in the migration.)
create unique index if not exists ux_notif_open_vocab_pending
  on public.notifications (recipient_id, ((payload ->> 'tag_id')))
  where kind = 'tag_vocab_pending'
    and read_at is null
    and digested_at is null;

-- notifications.kind extended with 'tag_removed_by_other'.

-- Triggers added in 009 (canonical bodies in the migration):
--   t_pending_tag_use          AFTER INSERT on prospect_tags
--   t_tag_removed_by_other     AFTER DELETE on prospect_tags
--   t_prospect_tags_audit      AFTER INSERT/UPDATE/DELETE on prospect_tags
--                              (replaces 007's INSERT/DELETE-only attach)

-- =========================================================================
-- End of 009_tag_triggers.sql mirror
-- =========================================================================

-- =========================================================================
-- 010_prospect_contact_emails.sql mirror (read-only reference; canonical
-- at whrb-web/supabase/migrations/010_prospect_contact_emails.sql).
-- Multi-email per prospect (Option B): child table + denormalized scalar
-- cache + count. See the canonical migration for full trigger bodies.
-- =========================================================================

-- New child table — one row per (prospect, email).
create table if not exists public.prospect_contact_emails (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  email text not null,
  source text not null check (source in (
    'pipeline_hunter','pipeline_apollo','pipeline_scraper',
    'manual_rep','legacy_scalar'
  )),
  is_primary boolean not null default false,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_contact_emails_email_format
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint prospect_contact_emails_email_length
    check (length(email) <= 200)
);

-- Invariant 1: at most one primary per prospect.
create unique index if not exists uniq_prospect_primary_email
  on public.prospect_contact_emails (prospect_id) where is_primary;

-- Invariant 2: no duplicate emails per prospect (case-insensitive).
create unique index if not exists uniq_prospect_contact_emails_lower
  on public.prospect_contact_emails (prospect_id, lower(email));

create index if not exists idx_prospect_contact_emails_prospect
  on public.prospect_contact_emails (prospect_id, is_primary desc, added_at asc);

-- Denormalized count on prospects. Always equals
-- count(*) FROM prospect_contact_emails WHERE prospect_id = p.id.
-- Maintained by sync_prospect_primary_email() AFTER trigger. The pipeline
-- gate in db/supabase_sync.py reads this column to decide whether to
-- skip a prospect (count > 0 → skip all email enrichment).
alter table public.prospects
  add column if not exists contact_email_count int not null default 0
    check (contact_email_count >= 0);

-- Triggers added in 010 (canonical bodies in the migration):
--   t_pce_updated_at         BEFORE UPDATE — set_updated_at
--   t_pce_enforce            BEFORE INSERT/UPDATE — auto-primary on first
--                            row + reject second-primary outside RPC
--   t_pce_sync               AFTER INSERT/UPDATE/DELETE — keeps
--                            prospects.contact_email and contact_email_count
--                            consistent; auto-promotes a successor when the
--                            primary is removed; reentrancy guarded via
--                            app.in_email_after_trigger GUC
--   t_pce_audit              AFTER INSERT/UPDATE/DELETE — emits
--                            prospect_email_added/removed/updated/
--                            primary_changed event_log rows
--   t_prospects_guard_contact_email
--                            BEFORE UPDATE on prospects — blocks direct
--                            writes to prospects.contact_email outside the
--                            sync trigger (which sets app.syncing_contact_email='1')
--
-- RPC added in 010:
--   set_primary_contact_email(p_prospect_id uuid, p_email_id uuid) RETURNS void
--     Atomic primary swap; uses pg_advisory_xact_lock + app.in_primary_swap
--     GUC. GRANTed to authenticated, service_role.
--
-- audit_prospect_change (from 000) is REPLACEd in 010 to drop
-- 'contact_email' from its tracked array — email-level audit comes from
-- t_pce_audit instead.
--
-- RLS on prospect_contact_emails mirrors prospects:
--   p_pce_read   — auth.uid() is not null
--   p_pce_insert — auth.uid() is not null
--   p_pce_update — auth.uid() is not null
--   p_pce_delete — auth.uid() is not null
-- Pipeline uses service-role and bypasses RLS; column-level auth on the
-- parent prospect's UPDATE (001_prospect_update_guard.sql) acts as
-- defense-in-depth for non-admin/non-assignee writes.

-- =========================================================================
-- End of 010_prospect_contact_emails.sql mirror
-- =========================================================================

-- =========================================================================
-- 011_instrumentation.sql mirror — Stage T4
-- =========================================================================
-- 011_instrumentation.sql — Stage T4
--
-- Source-quality instrumentation, retention rollups, source lifecycle, and
-- the changelog surface. Schema-only — no data inserts beyond the dedupe
-- backfill at the bottom (which is guarded for idempotence).
--
-- Mirrored at whrb-prospects/db/schema.sql.

-- =========================================================================
-- 1) filter_impressions — raw row-impression log (30-day retention).
-- =========================================================================

create table if not exists public.filter_impressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  filter_signature text,
  created_at timestamptz not null default now(),
  -- Generated UTC date so the daily-unique constraint is deterministic
  -- regardless of session TZ. Postgres requires the expression be IMMUTABLE;
  -- ((tstz at time zone 'UTC')::date) qualifies.
  impression_date date generated always as
    (((created_at at time zone 'UTC'))::date) stored
);

create index if not exists filter_impressions_prospect
  on public.filter_impressions(prospect_id);
create index if not exists filter_impressions_user
  on public.filter_impressions(user_id);
create unique index if not exists filter_impressions_daily_unique
  on public.filter_impressions(user_id, prospect_id, impression_date);

alter table public.filter_impressions enable row level security;

-- Anon denied; users see only their own rows; admins see all.
drop policy if exists p_filter_impressions_select on public.filter_impressions;
create policy p_filter_impressions_select on public.filter_impressions
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists p_filter_impressions_insert on public.filter_impressions;
create policy p_filter_impressions_insert on public.filter_impressions
  for insert with check (auth.uid() = user_id);

-- =========================================================================
-- 2) filter_impression_stats — week-grain rollup (indefinite retention).
-- =========================================================================

create table if not exists public.filter_impression_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  week_start date not null,
  impression_count int not null,
  primary key (user_id, prospect_id, week_start)
);

create index if not exists filter_impression_stats_week
  on public.filter_impression_stats(week_start);

alter table public.filter_impression_stats enable row level security;

drop policy if exists p_fi_stats_select on public.filter_impression_stats;
create policy p_fi_stats_select on public.filter_impression_stats
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- No INSERT policy — only the service-role rollup script writes.

-- =========================================================================
-- 3) event_log_stats — indefinite-retention rollup of pruned event_log rows.
-- =========================================================================

create table if not exists public.event_log_stats (
  week_start date not null,
  category text not null,
  level text not null,
  count int not null,
  primary key (week_start, category, level)
);

create index if not exists event_log_stats_week
  on public.event_log_stats(week_start);

alter table public.event_log_stats enable row level security;

drop policy if exists p_event_log_stats_select on public.event_log_stats;
create policy p_event_log_stats_select on public.event_log_stats
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- =========================================================================
-- 4) source_config: extend with status enum + status_changed_at.
-- =========================================================================

alter table public.source_config
  add column if not exists status text not null default 'active';

-- Drop old check (if running this twice) before reattaching.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'source_config_status_check'
  ) then
    alter table public.source_config drop constraint source_config_status_check;
  end if;
end $$;

alter table public.source_config
  add constraint source_config_status_check
  check (status in ('active','sunset_proposed','sunset','archived'));

alter table public.source_config
  add column if not exists status_changed_at timestamptz not null default now();

-- Backfill: rows with enabled=false get sunset_proposed; enabled=true keeps
-- the default 'active'. Idempotent — only updates rows whose status is the
-- default and whose enabled flag disagrees.
update public.source_config
set status = case when enabled then 'active' else 'sunset_proposed' end
where status = 'active'
  and not enabled;

create index if not exists source_config_status
  on public.source_config(status);

-- Trigger: keep status and enabled in two-way sync. Lets the existing
-- SourceToggle.tsx (which writes to `enabled`) coexist with the new
-- /admin/sources lifecycle UI (which writes to `status`).
create or replace function public.sync_source_config_status_enabled()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.enabled := (new.status in ('active','sunset_proposed'));
    new.status_changed_at := now();
  elsif new.enabled is distinct from old.enabled then
    new.status := case when new.enabled then 'active' else 'sunset_proposed' end;
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists t_source_config_status_enabled on public.source_config;
create trigger t_source_config_status_enabled
  before update on public.source_config
  for each row execute function public.sync_source_config_status_enabled();

-- =========================================================================
-- 5) changelog_entries + profiles.last_changelog_ack.
-- =========================================================================

create table if not exists public.changelog_entries (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  body_mdx text not null,
  audience text not null default 'all',
  released_at timestamptz not null,
  pinned boolean default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'changelog_entries_audience_check'
  ) then
    alter table public.changelog_entries drop constraint changelog_entries_audience_check;
  end if;
end $$;

alter table public.changelog_entries
  add constraint changelog_entries_audience_check
  check (audience in ('rep','admin','all'));

create index if not exists changelog_entries_released
  on public.changelog_entries(released_at desc);

alter table public.changelog_entries enable row level security;

-- Authed users see entries for their role + 'all'; admins see everything.
drop policy if exists p_changelog_select on public.changelog_entries;
create policy p_changelog_select on public.changelog_entries
  for select using (
    auth.uid() is not null
    and (
      audience = 'all'
      or audience = (
        select role from public.profiles where id = auth.uid()
      )
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    )
  );

-- Admin-only write surface.
drop policy if exists p_changelog_write on public.changelog_entries;
create policy p_changelog_write on public.changelog_entries
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

alter table public.profiles
  add column if not exists last_changelog_ack timestamptz default now();

-- =========================================================================
-- 6) One-time backfill: synthesize dedupe_match events from existing
--    multi-source prospects (rows whose `source` is comma-joined).
--
--    Idempotent — guarded by checking event_log for any prior
--    `category='dedupe_match'` row tagged `context->>'backfill' = 'true'`.
--    Future merges emit fresh dedupe_match events live from the pipeline.
-- =========================================================================

do $$
begin
  if not exists (
    select 1 from public.event_log
    where category = 'dedupe_match'
      and context ->> 'backfill' = 'true'
    limit 1
  ) then
    insert into public.event_log
      (source, level, category, message, context, created_at)
    select
      'pipeline',
      'info',
      'dedupe_match',
      'T4 backfill: synthesized from prospects.source comma-list',
      jsonb_build_object(
        'winning_source', srcs[1],
        'losing_source', loser,
        'business_key', p.business_key,
        'backfill', 'true'
      ),
      coalesce(p.created_at, now())
    from public.prospects p,
      lateral string_to_array(p.source, ',') srcs,
      lateral unnest(srcs[2:array_length(srcs, 1)]) loser
    where p.source like '%,%'
      and array_length(srcs, 1) >= 2;
  end if;
end $$;

-- =========================================================================
-- End of 011_instrumentation.sql mirror
-- =========================================================================

-- =========================================================================
-- 012_schedule.sql mirror — Schedule Feature
-- =========================================================================
-- 012_schedule.sql — Schedule Feature
--
-- Shared interactive calendar for the WHRB sales team. Tracks ad air dates,
-- recontact reminders, internal events, and invoice send dates with per-user
-- per-category notification preferences and lead-time reminders dispatched
-- via pg_cron every minute.
--
-- Reminders ride the existing `notifications` table (extended kind constraint)
-- and reach the browser through the existing Realtime subscription on
-- NotificationBell.tsx. No new client-side channel is needed for reminder
-- delivery.
--
-- This migration also adds the schema (table, trigger, RLS policies) for
-- one-way Google Calendar ICS imports. The actual sync worker ships in a
-- later PR but the schema lands here to keep the migration count low.
--
-- Mirrored at whrb-prospects/db/schema.sql.

-- =========================================================================
-- 0) Extensions
-- =========================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- =========================================================================
-- 1) Enums
-- =========================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'schedule_event_category') then
    create type public.schedule_event_category as enum (
      'sold_ad_airing',
      'client_recontact',
      'invoice_due',
      'internal_event',
      'personal_task',
      'other'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'schedule_assignee_kind') then
    create type public.schedule_assignee_kind as enum ('user','team_wide','admin');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'schedule_reminder_channel') then
    create type public.schedule_reminder_channel as enum ('in_app','email');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'schedule_event_visibility') then
    create type public.schedule_event_visibility as enum ('public','private');
  end if;
end $$;

-- =========================================================================
-- 2) schedule_external_calendars — admin-managed ICS feed list
-- =========================================================================

create table if not exists public.schedule_external_calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  feed_url text not null check (length(feed_url) between 1 and 2048),
  default_category public.schedule_event_category not null default 'internal_event',
  default_assignee_kind public.schedule_assignee_kind not null default 'team_wide',
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_status text check (last_status in ('success','failure','running')),
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists t_sched_external_calendars_updated_at on public.schedule_external_calendars;
create trigger t_sched_external_calendars_updated_at
  before update on public.schedule_external_calendars
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3) schedule_events — one row per event occurrence
-- =========================================================================

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  series_id uuid,
  title text not null check (length(title) between 1 and 200),
  description text check (length(description) <= 5000),
  category public.schedule_event_category not null,
  starts_at timestamptz not null,
  duration_minutes int not null default 30 check (duration_minutes between 1 and 1440),
  all_day boolean not null default false,
  assignee_kind public.schedule_assignee_kind not null default 'user',
  assigned_to uuid references public.profiles(id) on delete set null,
  author_id uuid references public.profiles(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  location text check (location is null or length(location) <= 300),
  url text check (url is null or length(url) <= 1000),
  visibility public.schedule_event_visibility not null default 'public',
  metadata jsonb not null default '{}'::jsonb,
  external_source text check (external_source is null or external_source in ('google_calendar')),
  external_calendar_id uuid references public.schedule_external_calendars(id) on delete set null,
  external_id text,
  external_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sched_assignee_consistent check (
    (assignee_kind = 'user' and assigned_to is not null)
    or (assignee_kind in ('team_wide','admin') and assigned_to is null)
  ),
  constraint sched_visibility_requires_user check (
    visibility = 'public' or assignee_kind = 'user'
  ),
  constraint sched_external_consistent check (
    (external_source is null and external_id is null and external_calendar_id is null)
    or (external_source is not null and external_id is not null and external_calendar_id is not null)
  )
);

create index if not exists idx_sched_starts_at        on public.schedule_events (starts_at);
create index if not exists idx_sched_starts_category  on public.schedule_events (starts_at, category);
create index if not exists idx_sched_assigned        on public.schedule_events (assigned_to) where assigned_to is not null;
create index if not exists idx_sched_series          on public.schedule_events (series_id) where series_id is not null;
create index if not exists idx_sched_prospect        on public.schedule_events (prospect_id) where prospect_id is not null;
-- Conflict target for ICS upserts. Scoped by external_calendar_id so a
-- malicious feed cannot hijack another feed's events by reusing a UID.
create unique index if not exists idx_sched_external_unique
  on public.schedule_events (external_source, external_calendar_id, external_id)
  where external_source is not null;

drop trigger if exists t_sched_events_updated_at on public.schedule_events;
create trigger t_sched_events_updated_at
  before update on public.schedule_events
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 4) schedule_event_reminders — one row per recipient × lead × channel
-- =========================================================================

create table if not exists public.schedule_event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.schedule_events(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  channel public.schedule_reminder_channel not null,
  lead_minutes int not null check (lead_minutes between 0 and 43200),
  -- Tripwire: derive_schedule_reminder_fire_at trigger overwrites the
  -- placeholder API callers send (epoch). If the trigger fails to fire,
  -- this CHECK prevents a row from persisting with an always-due fire_at.
  fire_at timestamptz not null check (fire_at > timestamptz '2000-01-01'),
  dispatched_at timestamptz,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sched_reminder_unique unique (event_id, recipient_id, channel, lead_minutes)
);

create index if not exists idx_sched_reminder_due
  on public.schedule_event_reminders (fire_at)
  where dispatched_at is null;
create index if not exists idx_sched_reminder_recipient
  on public.schedule_event_reminders (recipient_id);

-- =========================================================================
-- 5) user_schedule_preferences — per-user, per-category defaults
-- =========================================================================

create table if not exists public.user_schedule_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  prefs jsonb not null default $json$
    {
      "sold_ad_airing":   {"lead_minutes": [60, 1440],     "channels": ["in_app"]},
      "client_recontact": {"lead_minutes": [1440],         "channels": ["in_app","email"]},
      "invoice_due":      {"lead_minutes": [1440, 4320],   "channels": ["in_app","email"]},
      "internal_event":   {"lead_minutes": [60],           "channels": ["in_app"]},
      "personal_task":    {"lead_minutes": [60],           "channels": ["in_app"]},
      "other":            {"lead_minutes": [60],           "channels": ["in_app"]}
    }
  $json$::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists t_user_sched_prefs_updated_at on public.user_schedule_preferences;
create trigger t_user_sched_prefs_updated_at
  before update on public.user_schedule_preferences
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 6) Triggers
-- =========================================================================

-- 6a) Reminder fire_at maintenance: derive on insert/update from event.starts_at
create or replace function public.derive_schedule_reminder_fire_at()
returns trigger
language plpgsql
as $$
declare
  v_starts_at timestamptz;
begin
  select starts_at into v_starts_at
    from public.schedule_events where id = new.event_id;
  if v_starts_at is null then
    raise exception 'schedule_event_reminders.event_id % not found', new.event_id;
  end if;
  new.fire_at := v_starts_at - make_interval(mins => new.lead_minutes);
  return new;
end;
$$;

drop trigger if exists t_sched_reminder_derive_fire_at on public.schedule_event_reminders;
create trigger t_sched_reminder_derive_fire_at
  before insert or update of event_id, lead_minutes on public.schedule_event_reminders
  for each row execute function public.derive_schedule_reminder_fire_at();

-- 6b) When schedule_events.starts_at changes, recompute fire_at on PENDING
-- reminders only. Dispatched rows are immutable history.
create or replace function public.sync_schedule_reminder_fire_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.starts_at is distinct from old.starts_at then
    update public.schedule_event_reminders
       set fire_at = new.starts_at - make_interval(mins => lead_minutes)
     where event_id = new.id and dispatched_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists t_sched_reschedule on public.schedule_events;
create trigger t_sched_reschedule
  after update on public.schedule_events
  for each row execute function public.sync_schedule_reminder_fire_at();

-- 6c) Defense-in-depth: block non-service writes to externally-imported rows.
-- Service role and superusers (migrations / cron) bypass; JWT-authed users
-- are blocked. The API layer also enforces this with a clean 403.
create or replace function public.block_external_event_user_writes()
returns trigger
language plpgsql
as $$
declare
  v_jwt_role text;
begin
  v_jwt_role := current_setting('request.jwt.claim.role', true);
  if v_jwt_role = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if current_user in ('postgres','supabase_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE' and old.external_source is not null then
    raise exception 'imported events are read-only (external_source=%)', old.external_source
      using errcode = 'check_violation';
  elsif tg_op = 'DELETE' and old.external_source is not null then
    raise exception 'imported events cannot be deleted directly (external_source=%)', old.external_source
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists t_sched_block_external_writes on public.schedule_events;
create trigger t_sched_block_external_writes
  before update or delete on public.schedule_events
  for each row execute function public.block_external_event_user_writes();

-- =========================================================================
-- 7) Extend notifications.kind to include 'schedule_reminder'
-- =========================================================================

do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'notifications_kind_check'
  ) then
    alter table public.notifications drop constraint notifications_kind_check;
  end if;
end $$;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'assigned',
    'unassigned',
    'note_mention',
    'run_complete',
    'feedback_status',
    'schedule_reminder'
  ));

-- =========================================================================
-- 8) RLS policies
-- =========================================================================

alter table public.schedule_events enable row level security;

drop policy if exists p_sched_read on public.schedule_events;
create policy p_sched_read on public.schedule_events
  for select using (
    auth.uid() is not null
    and (
      visibility = 'public'
      or author_id = auth.uid()
      or assigned_to = auth.uid()
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    )
  );

drop policy if exists p_sched_insert on public.schedule_events;
create policy p_sched_insert on public.schedule_events
  for insert with check (
    auth.uid() is not null
    and (author_id is null or author_id = auth.uid())
  );

drop policy if exists p_sched_update on public.schedule_events;
create policy p_sched_update on public.schedule_events
  for update using (auth.uid() is not null);

drop policy if exists p_sched_delete on public.schedule_events;
create policy p_sched_delete on public.schedule_events
  for delete using (auth.uid() is not null);

alter table public.schedule_event_reminders enable row level security;

drop policy if exists p_sched_rem_read on public.schedule_event_reminders;
create policy p_sched_rem_read on public.schedule_event_reminders
  for select using (
    recipient_id = auth.uid()
    or exists (
      select 1 from public.schedule_events e
      where e.id = event_id and e.author_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists p_sched_rem_write on public.schedule_event_reminders;
create policy p_sched_rem_write on public.schedule_event_reminders
  for all using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

alter table public.user_schedule_preferences enable row level security;

drop policy if exists p_user_sched_prefs_self on public.user_schedule_preferences;
create policy p_user_sched_prefs_self on public.user_schedule_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.schedule_external_calendars enable row level security;

drop policy if exists p_sched_ext_cal_admin on public.schedule_external_calendars;
create policy p_sched_ext_cal_admin on public.schedule_external_calendars
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- =========================================================================
-- 9) dispatch_schedule_reminders — pg_cron-driven dispatcher
-- =========================================================================

create or replace function public.dispatch_schedule_reminders(p_now timestamptz default now())
returns table(dispatched_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_notif_id uuid;
begin
  for rec in
    select id, event_id, recipient_id, channel, lead_minutes
    from public.schedule_event_reminders
    where dispatched_at is null and fire_at <= p_now
    for update skip locked
  loop
    insert into public.notifications (recipient_id, kind, prospect_id, actor_id, payload)
    select rec.recipient_id,
           'schedule_reminder',
           e.prospect_id,
           e.author_id,
           jsonb_build_object(
             'event_id', e.id,
             'series_id', e.series_id,
             'title', e.title,
             'category', e.category::text,
             'starts_at', e.starts_at,
             'lead_minutes', rec.lead_minutes,
             'channel', rec.channel::text
           )
    from public.schedule_events e
    where e.id = rec.event_id
    returning id into v_notif_id;

    update public.schedule_event_reminders
       set dispatched_at = p_now,
           notification_id = v_notif_id
     where id = rec.id;

    dispatched_id := rec.id;
    return next;
  end loop;
end;
$$;

-- =========================================================================
-- 10) Schedule the cron job (idempotent)
-- =========================================================================

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'dispatch_schedule_reminders';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'dispatch_schedule_reminders',
    '* * * * *',
    'select public.dispatch_schedule_reminders();'
  );
end $$;

-- =========================================================================
-- End of 012_schedule.sql mirror
-- =========================================================================

-- =========================================================================
-- 015_peer_stations.sql mirror — Stage T5
-- =========================================================================
-- Slot 015 because 013_schedule_fixes.sql + 014_cron_state.sql consumed
-- 013/014. peer_stations is the admin-editable whitelist consumed by
-- sources/competitor_stations.py: any scraped row whose normalized
-- company_name matches an active row gets tagged history:peer_public_radio
-- and suppressed from prospects output.

create table if not exists public.peer_stations (
  id              uuid primary key default gen_random_uuid(),
  normalized_name text unique not null,
  display_name    text not null,
  status          text not null default 'active'
                  check (status in ('active', 'deprecated')),
  added_by        uuid references auth.users(id),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists peer_stations_status_active
  on public.peer_stations(status)
  where status = 'active';

drop trigger if exists t_peer_stations_updated_at on public.peer_stations;
create trigger t_peer_stations_updated_at
  before update on public.peer_stations
  for each row execute function public.set_updated_at();

alter table public.peer_stations enable row level security;

drop policy if exists p_peer_stations_read on public.peer_stations;
create policy p_peer_stations_read on public.peer_stations
  for select using (auth.uid() is not null);

drop policy if exists p_peer_stations_admin_write on public.peer_stations;
create policy p_peer_stations_admin_write on public.peer_stations
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

insert into public.peer_stations (normalized_name, display_name, notes)
values
  ('whrb',  'WHRB',   'Self — WHRB 95.3 FM. Should never appear in any source output.'),
  ('wcrb',  'WCRB',   'Classical 99.5 / GBH-owned classical sister station. Scrape target — never a prospect.'),
  ('wgbh',  'WGBH',   'GBH 89.7. Scrape target — never a prospect.'),
  ('gbh',   'GBH',    'Post-rebrand display form of WGBH; same entity.'),
  ('wbur',  'WBUR',   'WBUR 90.9 (BU NPR). Scrape target — never a prospect.'),
  ('wumb',  'WUMB',   'WUMB 91.9 (UMass Boston). Scrape target — never a prospect.'),
  ('wers',  'WERS',   'WERS 88.9 (Emerson College). Scrape target — never a prospect.'),
  ('wnyc',  'WNYC',   'NYC public radio. Often appears in WBUR / WGBH peer-content credits.'),
  ('wqxr',  'WQXR',   'NYC classical sister-station of WNYC.'),
  ('npr',   'NPR',    'National Public Radio.'),
  ('prx',   'PRX',    'Public Radio Exchange.'),
  ('pri',   'PRI',    'Public Radio International.'),
  ('pbs',   'PBS',    'Public Broadcasting Service.'),
  ('boston public radio', 'Boston Public Radio', 'GBH on-air program brand; not a sponsor.'),
  ('classicalwcrb', 'Classical WCRB', 'Display form of WCRB used on classicalwcrb.org.')
on conflict (normalized_name) do nothing;

-- =========================================================================
-- End of 015_peer_stations.sql mirror
-- =========================================================================

-- =========================================================================
-- 018_ad_orders.sql mirror — Ad Sales / Production / Payment tracker
-- =========================================================================
-- Slot 018 because 016 + 017 are vocab seed inserts (not DDL) and were
-- not mirrored. Adds three tables (org_settings, ad_orders,
-- ad_order_amendments), one immutable function (whrb_semester), one
-- view (ad_orders_status), four triggers on ad_orders, and an
-- updated_at trigger on org_settings.
--
-- See whrb-web/supabase/migrations/018_ad_orders.sql for the full
-- comment block; this is a verbatim mirror so the pipeline + integrity
-- scripts can run against the schema without an extra DB roundtrip.

-- 1) org_settings
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

-- 2) ad_orders
create table if not exists public.ad_orders (
  id uuid primary key default gen_random_uuid(),
  promo_id text not null unique
    check (promo_id ~ '^[A-Z]{2,4} [0-9]{4}$'),
  prospect_id uuid references public.prospects(id) on delete restrict,
  company_name text not null check (length(company_name) between 1 and 300),
  package_doc_url text
    check (package_doc_url is null
           or package_doc_url ~* '^https://(docs|drive)\.google\.com/'),
  is_nonprofit_rate boolean not null default false,
  discount_pct numeric(5,2) not null default 0
    check (discount_pct >= 0 and discount_pct <= 100),
  payment_contact_name text check (length(payment_contact_name) <= 200),
  payment_contact_email text
    check (payment_contact_email is null
           or payment_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  campaign_start date not null,
  campaign_end   date not null,
  constraint ad_orders_campaign_range check (campaign_end >= campaign_start),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  salesperson_id uuid references public.profiles(id) on delete restrict,
  commission_pct numeric(5,2) not null default 15
    check (commission_pct >= 0 and commission_pct <= 100),
  ad_produced boolean not null default false,
  ad_produced_at timestamptz,
  se_engineer_id uuid references public.profiles(id) on delete restrict,
  invoice_number text check (length(invoice_number) <= 50),
  invoice_sent_at date,
  is_paid boolean not null default false,
  paid_at timestamptz,
  client_check_number text check (length(client_check_number) <= 50),
  commission_amount numeric(12,2)
    generated always as (round(total_amount * commission_pct / 100.0, 2)) stored,
  commission_paid boolean not null default false,
  commission_paid_at timestamptz,
  notes text check (length(notes) <= 5000),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_orders_paid_requires_invoice
    check (is_paid = false or invoice_sent_at is not null),
  constraint ad_orders_commission_requires_paid
    check (commission_paid = false or is_paid = true),
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

-- 3) ad_order_amendments
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

-- 4) Indexes
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

-- 5) whrb_semester(date)
create or replace function public.whrb_semester(d date)
returns text language sql immutable as $$
  select case
    when extract(month from d) between 1 and 5 then 'SP' || extract(year from d)::text
    when extract(month from d) between 6 and 7 then 'SU' || extract(year from d)::text
    else 'FA' || extract(year from d)::text
  end;
$$;

create index if not exists idx_ad_orders_semester
  on public.ad_orders ((public.whrb_semester(campaign_start)));

-- 6) ad_orders_status view
create or replace view public.ad_orders_status with (security_invoker = true) as
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

-- 7) Triggers (functions defined in canonical 018_ad_orders.sql; see there
--    for the full body. The schema.sql mirror only re-creates the trigger
--    bindings so the integrity script can rely on their existence.)
drop trigger if exists t_ad_orders_touch on public.ad_orders;
create trigger t_ad_orders_touch
  before update on public.ad_orders
  for each row execute function public.set_updated_at();

drop trigger if exists t_ad_orders_update_guard on public.ad_orders;
create trigger t_ad_orders_update_guard
  before update on public.ad_orders
  for each row execute function public.enforce_ad_order_update_guard();

drop trigger if exists t_ad_orders_paid_lockdown on public.ad_orders;
create trigger t_ad_orders_paid_lockdown
  before update on public.ad_orders
  for each row execute function public.enforce_ad_order_paid_lockdown();

drop trigger if exists t_ad_orders_audit on public.ad_orders;
create trigger t_ad_orders_audit
  after update on public.ad_orders
  for each row execute function public.audit_ad_order_change();

drop trigger if exists t_org_settings_touch on public.org_settings;
create trigger t_org_settings_touch
  before update on public.org_settings
  for each row execute function public.set_updated_at();

-- 8) RLS (verbatim from canonical migration)
alter table public.org_settings enable row level security;
drop policy if exists p_orgsettings_read on public.org_settings;
create policy p_orgsettings_read on public.org_settings
  for select using (auth.uid() is not null);
drop policy if exists p_orgsettings_update on public.org_settings;
create policy p_orgsettings_update on public.org_settings
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
drop policy if exists p_orgsettings_no_insert on public.org_settings;
create policy p_orgsettings_no_insert on public.org_settings
  for insert with check (false);
drop policy if exists p_orgsettings_no_delete on public.org_settings;
create policy p_orgsettings_no_delete on public.org_settings
  for delete using (false);

alter table public.ad_orders enable row level security;
drop policy if exists p_ad_orders_read on public.ad_orders;
create policy p_ad_orders_read on public.ad_orders
  for select using (auth.uid() is not null);
drop policy if exists p_ad_orders_insert on public.ad_orders;
create policy p_ad_orders_insert on public.ad_orders
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
drop policy if exists p_ad_orders_update on public.ad_orders;
create policy p_ad_orders_update on public.ad_orders
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or salesperson_id = auth.uid()
    or se_engineer_id = auth.uid()
  );
drop policy if exists p_ad_orders_no_delete on public.ad_orders;
create policy p_ad_orders_no_delete on public.ad_orders
  for delete using (false);

alter table public.ad_order_amendments enable row level security;
drop policy if exists p_ad_order_amend_read on public.ad_order_amendments;
create policy p_ad_order_amend_read on public.ad_order_amendments
  for select using (auth.uid() is not null);
drop policy if exists p_ad_order_amend_insert on public.ad_order_amendments;
create policy p_ad_order_amend_insert on public.ad_order_amendments
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    and amended_by = auth.uid()
  );
drop policy if exists p_ad_order_amend_no_update on public.ad_order_amendments;
create policy p_ad_order_amend_no_update on public.ad_order_amendments
  for update using (false);
drop policy if exists p_ad_order_amend_no_delete on public.ad_order_amendments;
create policy p_ad_order_amend_no_delete on public.ad_order_amendments
  for delete using (false);

-- 9) ad_order_amend RPC (security definer; admin-only; sets the
--    app.amend_in_progress GUC to bypass the paid-lockdown trigger).
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
  execute format('select to_jsonb(t.%I) from public.ad_orders t where t.id = $1', p_field)
    into old_value using p_ad_order_id;
  if old_value is null then
    raise exception 'ad_order_amend: ad_order % not found', p_ad_order_id using errcode = '23503';
  end if;
  perform set_config('app.amend_in_progress', 'on', true);
  case p_field
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
    when 'prospect_id' then
      execute 'update public.ad_orders set prospect_id = nullif($1, '''')::uuid where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'salesperson_id' then
      execute 'update public.ad_orders set salesperson_id = nullif($1, '''')::uuid where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'se_engineer_id' then
      execute 'update public.ad_orders set se_engineer_id = nullif($1, '''')::uuid where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'total_amount', 'discount_pct', 'commission_pct' then
      execute format('update public.ad_orders set %I = $1::numeric where id = $2', p_field)
        using p_new_value_text, p_ad_order_id;
    when 'campaign_start', 'campaign_end', 'invoice_sent_at' then
      execute format('update public.ad_orders set %I = nullif($1, '''')::date where id = $2', p_field)
        using p_new_value_text, p_ad_order_id;
    when 'ad_produced_at' then
      execute 'update public.ad_orders set ad_produced_at = nullif($1, '''')::timestamptz where id = $2'
        using p_new_value_text, p_ad_order_id;
    when 'is_nonprofit_rate', 'ad_produced' then
      execute format('update public.ad_orders set %I = $1::boolean where id = $2', p_field)
        using p_new_value_text, p_ad_order_id;
    else
      raise exception 'ad_order_amend: field % is not amendable', p_field using errcode = '22023';
  end case;
  perform set_config('app.amend_in_progress', 'off', true);
  insert into public.ad_order_amendments
    (ad_order_id, field, old_value, new_value, reason, amended_by)
  values
    (p_ad_order_id, p_field, old_value, to_jsonb(p_new_value_text), p_reason, actor);
end;
$$;

-- =========================================================================
-- End of 018_ad_orders.sql mirror
-- =========================================================================

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

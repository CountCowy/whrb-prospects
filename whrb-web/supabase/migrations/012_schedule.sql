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
create unique index if not exists idx_sched_external_unique
  on public.schedule_events (external_source, external_id)
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
  fire_at timestamptz not null,
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

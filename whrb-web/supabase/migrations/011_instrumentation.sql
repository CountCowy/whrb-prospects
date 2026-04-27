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

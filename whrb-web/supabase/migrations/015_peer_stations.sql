-- 015_peer_stations.sql — Peer-station whitelist for the Stage T5
-- competitor_stations source.
--
-- Plan: gleaming-dawn §7.4. The new sources/competitor_stations.py module
-- scrapes the public corporate-sponsor pages of WCRB, WGBH, WBUR, WUMB, and
-- WERS. Every emitted row gets normalized against the active set of rows
-- in this table; matches are tagged history:peer_public_radio AND
-- suppressed from appearing as a prospect (peer stations should not appear
-- as ad-sales targets).
--
-- The set is admin-editable via /admin/peer-stations so a station rebrand
-- (e.g. WGBH -> GBH) does not require a code change or redeploy. Pipeline
-- loads `status='active'` rows at startup; admins update via the web UI.
--
-- Slot rationale: T5 originally drafted as 012 in the plan. 012 was
-- consumed by 012_schedule.sql (Schedule feature), 013 by
-- 013_schedule_fixes.sql (Schedule code-review follow-up), and 014 by
-- 014_cron_state.sql (T4 deferred follow-up L7, ops cleanup PR #29).
-- T5 takes the next free slot — 015.
--
-- Idempotent: every drop + create uses IF EXISTS / IF NOT EXISTS.

-- =========================================================================
-- 1) peer_stations — one row per peer public-radio entity to suppress from
--    competitor_stations output (and to tag with history:peer_public_radio
--    when matched on entity normalization).
-- =========================================================================

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

comment on table public.peer_stations is
  'Peer public-radio whitelist used by sources/competitor_stations.py. '
  'When a scraped sponsor name (or its normalized form) matches an '
  'active row here, the row is tagged history:peer_public_radio and '
  'suppressed from appearing as a prospect. Admin-editable via '
  '/admin/peer-stations; pipeline loads active rows at startup.';

comment on column public.peer_stations.normalized_name is
  'Result of enrich/dedupe.py::_norm_name (lowercase, alnum-only). '
  'Compared to scraped rows on this normalized form for stability '
  'across HTML rebrands ("GBH" vs. "WGBH" vs. "WGBH-FM").';

comment on column public.peer_stations.display_name is
  'Human-readable label rendered in /admin/peer-stations.';

create index if not exists peer_stations_status_active
  on public.peer_stations(status)
  where status = 'active';

-- =========================================================================
-- 2) updated_at trigger — reuse the existing public.set_updated_at()
--    function shipped by 000_init.sql.
-- =========================================================================

drop trigger if exists t_peer_stations_updated_at on public.peer_stations;
create trigger t_peer_stations_updated_at
  before update on public.peer_stations
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3) RLS — anon denied entirely (per gleaming-dawn §1.3 #20). Authed
--    users can SELECT all rows; only admins can INSERT/UPDATE/DELETE.
-- =========================================================================

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

-- =========================================================================
-- 4) Seed — peer public-radio stations + the five competitor_stations scrape
--    targets themselves (so they don't self-match if a sister-station name
--    appears in another peer's sponsor copy). normalized_name is the
--    lowercase alnum-only form matching enrich/dedupe.py::_norm_name.
-- =========================================================================

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
-- 5) Mirror appended to whrb-prospects/db/schema.sql so the snapshot stays
--    a single source of truth. Edit there too when this file changes.
-- =========================================================================

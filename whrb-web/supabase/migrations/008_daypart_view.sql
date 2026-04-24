-- WHRB prospects — daypart view + compliance soft-clear + tag_sync_status
-- (Stage T2, plan §4.4)
-- =========================================================================
-- Three things land together here because they all gate the tag-sync phase:
--
--   1) `prospect_tags` gains `suppressed_at` / `suppressed_by` — plan §1.3
--      #24 compliance soft-clear. Clearing a compliance tag is a soft
--      action (pipeline re-emission becomes a no-op + emits
--      `compliance_resuppressed`); other axes still hard-DELETE on clear.
--
--   2) `pipeline_runs` gains `tag_sync_status` (pending/ok/failed). Phase
--      `08_b_tag_sync` in `pipeline.py` flips it on entry/exit; the
--      admin /admin/pipeline UI shows a red banner while any recent run
--      is `failed`.
--
--   3) `derive_daypart(prospect_id)` function + `prospect_daypart` view
--      — compute-on-read daypart mapping driven by genre / affiliation /
--      history / sector / operating_model tags. Rules match plan §4.4
--      / conversation v4 §5. Materialization trigger: p95 filter latency
--      > 500 ms or Postgres flips to seq scan (see plan §4.5).
--
-- Paired rollback: 008_rollback.sql
-- Recovery procedure: see ROLLBACK.md
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) prospect_tags soft-clear columns (plan §1.3 #24)
-- -------------------------------------------------------------------------

alter table public.prospect_tags
  add column if not exists suppressed_at timestamptz,
  add column if not exists suppressed_by uuid references auth.users(id) on delete set null;

-- Partial index — rows with suppressed_at set are the hot path for
-- compliance re-emission checks; unsuppressed rows are the hot path for
-- everything else. Keep the index narrow so it only costs on suppressed rows.
create index if not exists idx_prospect_tags_suppressed
  on public.prospect_tags (prospect_id)
  where suppressed_at is not null;

-- -------------------------------------------------------------------------
-- 2) pipeline_runs.tag_sync_status (plan §4.5 tag-sync recovery)
-- -------------------------------------------------------------------------

alter table public.pipeline_runs
  add column if not exists tag_sync_status text
    check (tag_sync_status in ('pending', 'ok', 'failed'));

-- -------------------------------------------------------------------------
-- 3) derive_daypart(prospect_id) — compute-on-read daypart rule set
-- -------------------------------------------------------------------------
-- Rules (condensed from plan §4.4 / conversation v4 §5):
--   genre ∈ {classical,choral,opera,dance,theatre,film,spoken_word} → daypart_classical
--   genre='jazz'                                                    → daypart_jazz
--   genre='folk' | 'blues' | 'country'                              → daypart_blues_hillbilly
--   genre='rock_indie'                                              → daypart_rock_indie  (note: not in seeded daypart_fit vocab at T1;
--                                                                     returned as a raw text value anyway — the view owns the label set)
--   genre='world_music'                                             → daypart_classical + daypart_jazz
--   operating_model='ensemble' with no explicit genre               → daypart_classical
--   affiliation='harvard_affiliated'                                → daypart_classical + daypart_sports_news
--   sector='home_services'                                          → daypart_blues_hillbilly + daypart_classical
--   history='wcrb_sponsor'                                          → daypart_classical
--   history='wumb_sponsor'                                          → daypart_blues_hillbilly
--   sector='media' + operating_model='distributor'                  → multi_daypart
--   default fallback                                                → daypart_classical
--
-- The function unions the rule outputs into a distinct text[]. Suppressed
-- compliance rows are ignored but do not affect daypart derivation in v1
-- (no compliance value currently maps to a daypart).

create or replace function public.derive_daypart(p_prospect_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_axes jsonb;
  v_genres text[];
  v_affiliations text[];
  v_operating_models text[];
  v_sectors text[];
  v_histories text[];
  v_result text[] := array[]::text[];
  v_has_ensemble boolean := false;
  v_has_genre boolean := false;
begin
  -- One pass over the prospect's active tags, bucketed by axis.
  select coalesce(jsonb_object_agg(axis, values), '{}'::jsonb) into v_axes
  from (
    select tv.axis, jsonb_agg(distinct tv.value) as values
    from public.prospect_tags pt
    join public.tag_vocabulary tv on tv.id = pt.tag_id
    where pt.prospect_id = p_prospect_id
      and pt.suppressed_at is null
    group by tv.axis
  ) t;

  -- Extract per-axis arrays (default empty if absent).
  v_genres := coalesce(
    array(select jsonb_array_elements_text(v_axes->'genre')),
    array[]::text[]
  );
  v_affiliations := coalesce(
    array(select jsonb_array_elements_text(v_axes->'affiliation')),
    array[]::text[]
  );
  v_operating_models := coalesce(
    array(select jsonb_array_elements_text(v_axes->'operating_model')),
    array[]::text[]
  );
  v_sectors := coalesce(
    array(select jsonb_array_elements_text(v_axes->'sector')),
    array[]::text[]
  );
  v_histories := coalesce(
    array(select jsonb_array_elements_text(v_axes->'history')),
    array[]::text[]
  );
  v_has_genre := array_length(v_genres, 1) is not null;
  v_has_ensemble := 'ensemble' = any(v_operating_models);

  -- genre ∈ {classical,choral,opera,dance,theatre,film,spoken_word} → classical
  if v_genres && array['classical','choral','opera','dance','theatre','film','spoken_word']::text[] then
    v_result := array_append(v_result, 'classical');
  end if;
  -- genre = jazz → jazz
  if 'jazz' = any(v_genres) then
    v_result := array_append(v_result, 'jazz');
  end if;
  -- genre = folk / blues / country → blues_hillbilly
  if v_genres && array['folk','blues','country']::text[] then
    v_result := array_append(v_result, 'blues_hillbilly');
  end if;
  -- genre = rock_indie → record_hospital (WHRB's 11pm–5am underground rock block)
  if 'rock_indie' = any(v_genres) then
    v_result := array_append(v_result, 'record_hospital');
  end if;
  -- genre = world_music → classical + jazz
  if 'world_music' = any(v_genres) then
    v_result := array_append(v_result, 'classical');
    v_result := array_append(v_result, 'jazz');
  end if;
  -- ensemble with no explicit genre → classical
  if v_has_ensemble and not v_has_genre then
    v_result := array_append(v_result, 'classical');
  end if;
  -- harvard_affiliated → classical + sports_news
  if 'harvard_affiliated' = any(v_affiliations) then
    v_result := array_append(v_result, 'classical');
    v_result := array_append(v_result, 'sports_news');
  end if;
  -- sector = home_services → blues_hillbilly + classical
  if 'home_services' = any(v_sectors) then
    v_result := array_append(v_result, 'blues_hillbilly');
    v_result := array_append(v_result, 'classical');
  end if;
  -- history = wcrb_sponsor → classical; wumb_sponsor → blues_hillbilly
  if 'wcrb_sponsor' = any(v_histories) then
    v_result := array_append(v_result, 'classical');
  end if;
  if 'wumb_sponsor' = any(v_histories) then
    v_result := array_append(v_result, 'blues_hillbilly');
  end if;

  -- Default fallback — nothing matched.
  if array_length(v_result, 1) is null then
    v_result := array['classical'];
  end if;

  -- Dedupe (array_agg-distinct via subquery).
  return array(select distinct unnest(v_result));
end;
$$;

revoke all on function public.derive_daypart(uuid) from public;
grant execute on function public.derive_daypart(uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 4) prospect_daypart view
-- -------------------------------------------------------------------------
-- Thin SELECT over derive_daypart(). The web app + advanced-filter SQL
-- join against this view; the compute is per-row on demand.

create or replace view public.prospect_daypart as
select
  id as prospect_id,
  public.derive_daypart(id) as daypart_fit
from public.prospects;

-- Views default to SECURITY INVOKER in Postgres 15+ (current project).
-- Leave anon gate to prospect RLS — the view reads only through it.

-- =========================================================================
-- End of 008_daypart_view.sql
-- =========================================================================

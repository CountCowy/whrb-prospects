-- =========================================================================
-- 001_prospect_update_guard.sql
-- Stage 7 defense-in-depth: column-level auth on public.prospects UPDATE.
--
-- The admin-only INSERT policy (§16.2 item 7 second bullet of the companion
-- plan) is ALREADY in place in 000_init.sql:301-303 (p_prospects_insert),
-- so this migration only adds the BEFORE UPDATE trigger.
--
-- Rule enforced at the DB layer (round-4 §17.3 items 5-8):
--   * auth.uid() is null                     => no-op (pipeline / service role)
--   * auth.uid() = assigned_to               => may update any column
--   * profiles.role = 'admin'                => may update any column
--   * otherwise (non-assignee, non-admin)    => may only change
--         assigned_to + assigned_at + updated_at (updated_at is written by
--         the existing t_prospects_touch BEFORE UPDATE trigger so is
--         considered always-allowed here).
--
-- On violation raises SQLSTATE '42501' -> PostgREST returns HTTP 403.
-- Registered BEFORE UPDATE so the guard fires ahead of the AFTER UPDATE
-- audit trigger (t_prospects_audit), preventing denied writes from
-- emitting audit events.
--
-- Idempotent: `create or replace function` + `drop trigger if exists`.
-- =========================================================================

create or replace function public.enforce_prospect_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  is_assignee boolean;
  f text;
  -- Columns a non-admin non-assignee may change. updated_at is implicitly
  -- permitted because t_prospects_touch writes it on every update.
  allowed text[] := array['assigned_to','assigned_at','updated_at'];
  -- Columns to diff between OLD and NEW. Skip audit-ignored bookkeeping
  -- columns that aren't meaningful to policy: created_at, id.
  checked text[] := array[
    'state','assigned_to','assigned_at','tier','company_name','company_phone',
    'company_email','contact_name','contact_email','contact_phone','website',
    'address','zip','category','source','is_nonprofit','nonprofit_source','ein',
    'priority_score','user_overrides','alt_fields','pipeline_notes',
    'pipeline_last_seen_at','created_source','business_key','updated_at'
  ];
begin
  if actor is null then
    -- Service-role / pipeline path. Bypass guard.
    return new;
  end if;

  select exists (
    select 1 from public.profiles where id = actor and role = 'admin'
  ) into is_admin;

  if is_admin then
    return new;
  end if;

  is_assignee := (new.assigned_to is not distinct from actor)
               or (old.assigned_to is not distinct from actor);

  if is_assignee then
    return new;
  end if;

  -- Non-admin, non-assignee: only allowed columns may differ.
  foreach f in array checked loop
    if (to_jsonb(old) -> f) is distinct from (to_jsonb(new) -> f)
       and not (f = any(allowed))
    then
      raise exception
        'prospect update denied: column % requires admin or assignee role', f
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists t_prospects_update_guard on public.prospects;
create trigger t_prospects_update_guard
  before update on public.prospects
  for each row execute function public.enforce_prospect_update_guard();

-- -------------------------------------------------------------------------
-- Realtime publication — Stage 7 adds prospect_notes to supabase_realtime
-- so the NotesPanel can subscribe to postgres_changes. Idempotent via
-- duplicate_object exception swallow.
-- -------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.prospect_notes;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.prospects;
exception when duplicate_object then
  null;
end $$;

-- =========================================================================
-- End of 001_prospect_update_guard.sql
-- =========================================================================

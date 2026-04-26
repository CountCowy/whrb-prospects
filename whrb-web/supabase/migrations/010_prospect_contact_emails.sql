-- WHRB prospects — multi-email per prospect (Option B)
-- =========================================================================
-- Replaces the single-scalar `prospects.contact_email` workflow with a
-- child table `prospect_contact_emails`, while keeping
-- `prospects.contact_email` as a denormalized cache of the primary email
-- (Option B from the design discussion).
--
-- New invariants enforced at the DB layer:
--   1. At most one primary per prospect — partial unique index.
--   2. No duplicate emails per prospect (case-insensitive) — unique index.
--   3. `prospects.contact_email` always reflects the primary row — AFTER
--      sync trigger; direct writes blocked by guard trigger.
--   4. `prospects.contact_email_count` always equals row count for the
--      prospect — same AFTER sync trigger.
--   5. Pipeline never writes to a prospect that already has any email —
--      enforced at the sync layer in whrb-prospects/db/supabase_sync.py.
--   6. Audit log captures every email change — new audit trigger.
--   7. No orphaned rows — FK with on delete cascade.
--   8. Email format/length validation — DB CHECK + Zod at API.
--
-- Canonical location: whrb-web/supabase/migrations/010_prospect_contact_emails.sql
-- Mirrored (read-only reference) at: whrb-prospects/db/schema.sql
-- Apply via: whrb-prospects/scripts/apply_migration.py (same harness as 000).
-- Paired rollback: 010_rollback.sql
-- Recovery procedure: see ROLLBACK.md (010 specifics section)
--
-- Migration is one-way for production. A prospect with multiple emails
-- cannot round-trip into the single-scalar world cleanly without operator
-- triage. The rollback exists for dev environments only.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Table
-- -------------------------------------------------------------------------
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

-- Listing API + table cell join lookup.
create index if not exists idx_prospect_contact_emails_prospect
  on public.prospect_contact_emails (prospect_id, is_primary desc, added_at asc);

-- -------------------------------------------------------------------------
-- 2) Denormalized count column on prospects
-- -------------------------------------------------------------------------
-- Lets the all-prospects table render "+N" without a JOIN, and lets the
-- pipeline gate (supabase_sync.py) skip prospects with any email present.
alter table public.prospects
  add column if not exists contact_email_count int not null default 0
    check (contact_email_count >= 0);

-- -------------------------------------------------------------------------
-- 3) Backfill from existing scalar
-- -------------------------------------------------------------------------
-- One row per non-null scalar, primary by definition, source=legacy_scalar.
-- Rows whose scalar fails the new format/length checks are skipped here
-- and their stale scalar is NULL'd (next step) so the table view doesn't
-- keep displaying garbage that the pipeline gate (count>0 → skip) won't
-- re-enrich.
insert into public.prospect_contact_emails
  (prospect_id, email, source, is_primary, added_by, added_at)
select id, contact_email, 'legacy_scalar', true, null,
       coalesce(created_at, now())
  from public.prospects
 where contact_email is not null
   and contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
   and length(contact_email) <= 200
on conflict do nothing;

-- Reconcile contact_email_count for every prospect.
update public.prospects p
   set contact_email_count = (
     select count(*) from public.prospect_contact_emails pce
      where pce.prospect_id = p.id
   );

-- Surface any backfill skips and NULL the stale scalar.
-- This UPDATE fires the existing audit_prospect_change trigger (still
-- carrying 'contact_email' in its tracked array at this point in the
-- migration; section 9 rewrites it). One prospect_field_change event_log
-- row per skipped prospect is the intended audit trail for the fix-up.
do $$
declare
  skipped_count int;
  sample_ids uuid[];
  sample_emails text[];
begin
  select count(*),
         coalesce((array_agg(id order by id))[1:100], array[]::uuid[]),
         coalesce((array_agg(contact_email order by id))[1:100],
                  array[]::text[])
    into skipped_count, sample_ids, sample_emails
    from public.prospects
   where contact_email is not null
     and contact_email_count = 0;

  if skipped_count > 0 then
    insert into public.event_log (source, level, category, message, context)
    values (
      'web_server', 'warn', 'multi_email_backfill_skipped',
      format('010 backfill skipped %s prospects whose scalar failed validation',
             skipped_count),
      jsonb_build_object(
        'skipped_count',  skipped_count,
        'sample_ids',     to_jsonb(sample_ids),
        'sample_scalars', to_jsonb(sample_emails),
        'sample_capped_at', 100
      )
    );

    -- Clear the malformed scalar so the prospects table doesn't display
    -- garbage. The pipeline gate (count>0 skip) then sees count=0 and is
    -- free to re-enrich on the next run.
    update public.prospects
       set contact_email = null
     where contact_email is not null
       and contact_email_count = 0;
  end if;
end$$;

-- -------------------------------------------------------------------------
-- 4) updated_at maintenance (reuses existing set_updated_at)
-- -------------------------------------------------------------------------
drop trigger if exists t_pce_updated_at on public.prospect_contact_emails;
create trigger t_pce_updated_at
  before update on public.prospect_contact_emails
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- 5) BEFORE INSERT/UPDATE: enforce invariants on prospect_contact_emails
-- -------------------------------------------------------------------------
-- Rules:
--   - First row inserted for a prospect (count=0) is auto-promoted to
--     is_primary=true regardless of what the caller passed. Reps and
--     pipeline can both rely on this.
--   - Setting is_primary=true while another primary already exists is
--     forbidden. Use set_primary_contact_email() RPC, which sets
--     app.in_primary_swap during the demote/promote pair.
--   - Demoting a primary directly (is_primary=true → false) is allowed;
--     the AFTER trigger auto-promotes a successor. This case happens
--     during the RPC swap (between the two UPDATEs) and via the AFTER
--     DELETE handler.
create or replace function public.enforce_prospect_email_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  in_swap boolean := coalesce(
    current_setting('app.in_primary_swap', true), '') = '1';
  existing_primary uuid;
begin
  if (TG_OP = 'INSERT') then
    if not exists (
      select 1 from public.prospect_contact_emails
       where prospect_id = NEW.prospect_id
    ) then
      NEW.is_primary := true;
    end if;
    if NEW.is_primary then
      select id into existing_primary
        from public.prospect_contact_emails
       where prospect_id = NEW.prospect_id
         and is_primary
       limit 1;
      if existing_primary is not null and not in_swap then
        raise exception
          'cannot insert a second primary email for prospect %; '
          'use set_primary_contact_email RPC instead',
          NEW.prospect_id
          using errcode = 'P0001';
      end if;
    end if;
    return NEW;
  end if;

  -- TG_OP = 'UPDATE'
  if NEW.is_primary and not OLD.is_primary then
    select id into existing_primary
      from public.prospect_contact_emails
     where prospect_id = NEW.prospect_id
       and is_primary
       and id <> NEW.id
     limit 1;
    if existing_primary is not null and not in_swap then
      raise exception
        'cannot promote a second primary email for prospect %; '
        'use set_primary_contact_email RPC instead',
        NEW.prospect_id
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists t_pce_enforce on public.prospect_contact_emails;
create trigger t_pce_enforce
  before insert or update on public.prospect_contact_emails
  for each row execute function public.enforce_prospect_email_invariants();

-- -------------------------------------------------------------------------
-- 6) AFTER INSERT/UPDATE/DELETE: sync prospects.contact_email + count
-- -------------------------------------------------------------------------
-- Two responsibilities:
--   (a) Maintain `prospects.contact_email` (always = primary row's email,
--       or NULL when no rows exist for this prospect) and
--       `prospects.contact_email_count` (always = count(*) for this
--       prospect).
--   (b) Auto-promote a successor when the prior primary was removed
--       (deletion or direct demote). Skipped during in-progress RPC swaps,
--       which manage their own primary explicitly.
--
-- Reentrancy: the auto-promote step issues an UPDATE that re-fires this
-- trigger. The `app.in_email_after_trigger` GUC short-circuits the inner
-- invocation, so the recursion is bounded to one level.
--
-- Concurrency / multi-row safety: `set_config(name, value, is_local=true)`
-- scopes the GUC to the current transaction, and each DB connection has
-- its own session — concurrent transactions don't share GUC state. Within
-- one transaction modifying many rows (e.g. cascade DELETE of N children,
-- or a multi-row UPDATE), the per-row trigger fires sequentially: each
-- invocation reads the GUC, sets it to '1', does work (possibly recursing
-- once), and resets to '0' before returning. The next per-row firing
-- reads '0' and proceeds normally. There is no parallel firing of this
-- trigger within a single transaction, so a single global GUC name is
-- safe — no need to scope it per prospect_id.
create or replace function public.sync_prospect_primary_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid := coalesce(NEW.prospect_id, OLD.prospect_id);
  in_swap boolean := coalesce(
    current_setting('app.in_primary_swap', true), '') = '1';
  primary_email text;
  row_count int;
  successor_id uuid;
begin
  -- Reentrancy guard: skip when fired by our own auto-promote UPDATE.
  if coalesce(current_setting('app.in_email_after_trigger', true), '')
       = '1' then
    return null;
  end if;
  perform set_config('app.in_email_after_trigger', '1', true);

  select email into primary_email
    from public.prospect_contact_emails
   where prospect_id = pid and is_primary
   limit 1;

  if primary_email is null and not in_swap then
    select id into successor_id
      from public.prospect_contact_emails
     where prospect_id = pid
     order by added_at desc, id desc
     limit 1;
    if successor_id is not null then
      update public.prospect_contact_emails
         set is_primary = true
       where id = successor_id;
      select email into primary_email
        from public.prospect_contact_emails
       where id = successor_id;
    end if;
  end if;

  select count(*) into row_count
    from public.prospect_contact_emails
   where prospect_id = pid;

  -- Bypass guard_prospects_contact_email for this UPDATE.
  perform set_config('app.syncing_contact_email', '1', true);
  update public.prospects
     set contact_email = primary_email,
         contact_email_count = row_count
   where id = pid;
  perform set_config('app.syncing_contact_email', '0', true);

  perform set_config('app.in_email_after_trigger', '0', true);
  return null;
end;
$$;

drop trigger if exists t_pce_sync on public.prospect_contact_emails;
create trigger t_pce_sync
  after insert or update or delete on public.prospect_contact_emails
  for each row execute function public.sync_prospect_primary_email();

-- -------------------------------------------------------------------------
-- 7) Audit trigger — mirror audit_prospect_change shape
-- -------------------------------------------------------------------------
-- Categories:
--   prospect_email_added            (INSERT)
--   prospect_email_removed          (DELETE)
--   prospect_email_updated          (UPDATE — email text changed)
--   prospect_email_primary_changed  (UPDATE — is_primary changed)
create or replace function public.audit_prospect_contact_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor       uuid := auth.uid();
  pid         uuid := coalesce(NEW.prospect_id, OLD.prospect_id);
  evt_source  text := case when actor is null then 'pipeline' else 'web_server' end;
begin
  if (TG_OP = 'INSERT') then
    insert into public.event_log (source, level, category, message, context, user_id)
    values (
      evt_source, 'info', 'prospect_email_added',
      format('prospect %s: email added (%s)', pid, NEW.email),
      jsonb_build_object(
        'prospect_id', pid,
        'email_id',    NEW.id,
        'email',       NEW.email,
        'source',      NEW.source,
        'is_primary',  NEW.is_primary,
        'actor_id',    actor
      ),
      actor
    );
    return NEW;
  elsif (TG_OP = 'DELETE') then
    insert into public.event_log (source, level, category, message, context, user_id)
    values (
      evt_source, 'info', 'prospect_email_removed',
      format('prospect %s: email removed (%s)', pid, OLD.email),
      jsonb_build_object(
        'prospect_id', pid,
        'email_id',    OLD.id,
        'email',       OLD.email,
        'was_primary', OLD.is_primary,
        'actor_id',    actor
      ),
      actor
    );
    return OLD;
  end if;

  -- TG_OP = 'UPDATE'
  if NEW.email is distinct from OLD.email then
    insert into public.event_log (source, level, category, message, context, user_id)
    values (
      evt_source, 'info', 'prospect_email_updated',
      format('prospect %s: email %s changed', pid, NEW.id),
      jsonb_build_object(
        'prospect_id', pid,
        'email_id',    NEW.id,
        'old',         OLD.email,
        'new',         NEW.email,
        'actor_id',    actor
      ),
      actor
    );
  end if;
  if NEW.is_primary is distinct from OLD.is_primary then
    insert into public.event_log (source, level, category, message, context, user_id)
    values (
      evt_source, 'info', 'prospect_email_primary_changed',
      format('prospect %s: email %s primary %s -> %s',
             pid, NEW.id, OLD.is_primary, NEW.is_primary),
      jsonb_build_object(
        'prospect_id', pid,
        'email_id',    NEW.id,
        'old_primary', OLD.is_primary,
        'new_primary', NEW.is_primary,
        'actor_id',    actor
      ),
      actor
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists t_pce_audit on public.prospect_contact_emails;
create trigger t_pce_audit
  after insert or update or delete on public.prospect_contact_emails
  for each row execute function public.audit_prospect_contact_email_change();

-- -------------------------------------------------------------------------
-- 8) set_primary_contact_email RPC
-- -------------------------------------------------------------------------
-- Atomic primary swap. Sets app.in_primary_swap so the BEFORE-trigger
-- collision rule and the AFTER-trigger auto-promote both stand down.
-- Advisory lock serializes concurrent calls per prospect.
create or replace function public.set_primary_contact_email(
  p_prospect_id uuid, p_email_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_primary_id uuid;
  target_exists boolean;
  -- 64-bit hash to keep the per-prospect advisory-lock key space wide
  -- enough that unrelated prospects don't accidentally serialize on hash
  -- collisions. hashtextextended(text, bigint) returns bigint.
  pidhash bigint := hashtextextended(
    'contact_email_primary:' || p_prospect_id::text, 0::bigint
  );
begin
  perform pg_advisory_xact_lock(pidhash);

  select exists (
    select 1 from public.prospect_contact_emails
     where id = p_email_id and prospect_id = p_prospect_id
  ) into target_exists;
  if not target_exists then
    raise exception 'email % not found on prospect %', p_email_id, p_prospect_id
      using errcode = 'P0002';
  end if;

  perform set_config('app.in_primary_swap', '1', true);

  update public.prospect_contact_emails
     set is_primary = false
   where prospect_id = p_prospect_id and is_primary and id <> p_email_id;

  update public.prospect_contact_emails
     set is_primary = true
   where id = p_email_id and prospect_id = p_prospect_id;

  perform set_config('app.in_primary_swap', '0', true);
end;
$$;

revoke all on function public.set_primary_contact_email(uuid, uuid) from public;
grant execute on function public.set_primary_contact_email(uuid, uuid)
  to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 9) audit_prospect_change — drop 'contact_email' from tracked array
-- -------------------------------------------------------------------------
-- The scalar is now derived from prospect_contact_emails; per-row audit
-- on the join table is the source of truth for email changes. We do NOT
-- track contact_email_count here either — count changes are derivable
-- from the email-level audit rows and tracking would double-count.
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
    'contact_name','contact_phone','website','is_nonprofit',
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

-- -------------------------------------------------------------------------
-- 10) Guard trigger: block direct writes to prospects.contact_email
-- -------------------------------------------------------------------------
-- Installed last so the backfill (which doesn't write the scalar) and the
-- sync trigger's own UPDATE (which sets app.syncing_contact_email='1')
-- both pass; ad-hoc UPDATEs by application code or admins do not.
-- Fires on UPDATE only — INSERT path is intentionally unguarded so new
-- prospects can seed the scalar in the same transaction as their first
-- prospect_contact_emails row (whrb-prospects/db/supabase_sync.py).
create or replace function public.guard_prospects_contact_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contact_email is distinct from old.contact_email then
    if coalesce(current_setting('app.syncing_contact_email', true), '')
         <> '1' then
      raise exception
        'prospects.contact_email is denormalized from prospect_contact_emails; '
        'use the API or set_primary_contact_email RPC instead'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists t_prospects_guard_contact_email on public.prospects;
create trigger t_prospects_guard_contact_email
  before update on public.prospects
  for each row execute function public.guard_prospects_contact_email();

-- -------------------------------------------------------------------------
-- 11) Row Level Security
-- -------------------------------------------------------------------------
alter table public.prospect_contact_emails enable row level security;

drop policy if exists p_pce_read   on public.prospect_contact_emails;
drop policy if exists p_pce_insert on public.prospect_contact_emails;
drop policy if exists p_pce_update on public.prospect_contact_emails;
drop policy if exists p_pce_delete on public.prospect_contact_emails;

create policy p_pce_read   on public.prospect_contact_emails
  for select using (auth.uid() is not null);
create policy p_pce_insert on public.prospect_contact_emails
  for insert with check (auth.uid() is not null);
create policy p_pce_update on public.prospect_contact_emails
  for update using (auth.uid() is not null);
create policy p_pce_delete on public.prospect_contact_emails
  for delete using (auth.uid() is not null);

-- =========================================================================
-- End of 010_prospect_contact_emails.sql
-- =========================================================================

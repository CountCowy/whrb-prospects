-- WHRB prospects — rollback for 010_prospect_contact_emails.sql
-- =========================================================================
-- Drops everything 010 added, restores audit_prospect_change to its 009
-- shape (with 'contact_email' back in the tracked array), and removes the
-- guard trigger so the scalar is writable again. Dev/test use only —
-- production rollback would lose multi-email data that has no place in
-- the single-scalar world.
-- =========================================================================

-- 1) Drop dependent triggers first.
drop trigger if exists t_prospects_guard_contact_email on public.prospects;
drop trigger if exists t_pce_audit on public.prospect_contact_emails;
drop trigger if exists t_pce_sync on public.prospect_contact_emails;
drop trigger if exists t_pce_enforce on public.prospect_contact_emails;
drop trigger if exists t_pce_updated_at on public.prospect_contact_emails;

-- 2) Drop functions.
drop function if exists public.guard_prospects_contact_email() cascade;
drop function if exists public.set_primary_contact_email(uuid, uuid) cascade;
drop function if exists public.audit_prospect_contact_email_change() cascade;
drop function if exists public.sync_prospect_primary_email() cascade;
drop function if exists public.enforce_prospect_email_invariants() cascade;

-- 3) Drop the join table (cascade removes RLS policies).
drop table if exists public.prospect_contact_emails cascade;

-- 4) Drop the count column from prospects.
alter table public.prospects
  drop column if exists contact_email_count;

-- 5) Restore audit_prospect_change with 'contact_email' back in the
--    tracked array. Mirrors the function body from 000_init.sql:244-284.
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

-- =========================================================================
-- End of 010_rollback.sql
-- =========================================================================

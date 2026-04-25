-- WHRB prospects — rollback for 009_tag_triggers.sql (Stage T3)
-- =========================================================================
-- Restores the on-disk schema to the post-T2 state:
--
--   - Drops the new T3 triggers + functions (on_pending_tag_use,
--     on_tag_removed_by_other).
--   - Restores audit_prospect_tag_change to the 007 (INSERT/DELETE only)
--     body.
--   - Restores on_rep_tag_vocab_insert to the 007 body (no creators[]
--     in payload).
--   - Restores notifications.kind enum to the 007 set (drops
--     `tag_removed_by_other`).
--   - Drops notifications.digested_at + index.
--   - Drops profiles.vocab_notify_mode.
--
-- Recovery procedure: see ROLLBACK.md.
-- =========================================================================

-- 1) Drop T3 triggers + functions in dependency order.
drop trigger if exists t_pending_tag_use on public.prospect_tags;
drop trigger if exists t_tag_removed_by_other on public.prospect_tags;

-- 2) Restore audit_prospect_tag_change to the 007 body.
drop trigger if exists t_prospect_tags_audit on public.prospect_tags;
create or replace function public.audit_prospect_tag_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  pid uuid;
  tid uuid;
  v_axis text;
  v_value text;
begin
  if (TG_OP = 'INSERT') then
    pid := new.prospect_id;
    tid := new.tag_id;
  else
    pid := old.prospect_id;
    tid := old.tag_id;
  end if;

  select axis, value into v_axis, v_value
    from public.tag_vocabulary where id = tid;

  insert into public.event_log (source, level, category, message, context, user_id)
  values (
    case when actor is null then 'pipeline' else 'web_server' end,
    'info',
    case TG_OP
      when 'INSERT' then 'prospect_tag_added'
      when 'DELETE' then 'prospect_tag_removed'
    end,
    format(
      'prospect %s: tag %s/%s %s',
      pid, v_axis, v_value,
      case TG_OP when 'INSERT' then 'added' else 'removed' end
    ),
    jsonb_build_object(
      'prospect_id', pid,
      'tag_id',      tid,
      'axis',        v_axis,
      'value',       v_value,
      'actor_id',    actor
    ),
    actor
  );

  if TG_OP = 'INSERT' then return new; end if;
  return old;
end;
$$;

create trigger t_prospect_tags_audit
  after insert or delete on public.prospect_tags
  for each row execute function public.audit_prospect_tag_change();

drop function if exists public.on_pending_tag_use() cascade;
drop function if exists public.on_tag_removed_by_other() cascade;

-- 3) Restore on_rep_tag_vocab_insert to the 007 body (no creators[]).
create or replace function public.on_rep_tag_vocab_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  is_admin boolean := false;
  admin_id uuid;
begin
  if actor is not null then
    select (role = 'admin') into is_admin
      from public.profiles where id = actor;
  end if;

  if actor is not null and not is_admin then
    new.status := 'pending_admin_review';
    if new.created_by is null then
      new.created_by := actor;
    end if;

    for admin_id in
      select id from public.profiles where role = 'admin'
    loop
      insert into public.notifications (
        recipient_id, kind, actor_id, payload
      )
      values (
        admin_id,
        'tag_vocab_pending',
        actor,
        jsonb_build_object(
          'tag_id', new.id,
          'axis',   new.axis,
          'value',  new.value
        )
      );
    end loop;
  end if;

  return new;
end;
$$;

-- 4) Restore notifications.kind enum to the 007 set.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'assigned', 'unassigned', 'note_mention', 'run_complete',
    'feedback_status', 'tag_vocab_pending'
  ));

-- 5) Drop notifications.digested_at + index.
drop index if exists public.idx_notif_kind_digested;
alter table public.notifications drop column if exists digested_at;

-- 6) Drop profiles.vocab_notify_mode.
alter table public.profiles drop column if exists vocab_notify_mode;

-- =========================================================================
-- End of 009_rollback.sql
-- =========================================================================

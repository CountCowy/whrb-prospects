-- WHRB prospects — rep-facing tag UI triggers + per-admin notify mode (Stage T3)
-- =========================================================================
-- Adds the three behaviour-changing pieces that the T3 rep UI needs at the
-- DB layer:
--
--   1) profiles.vocab_notify_mode column — per-admin preference for how
--      pending-vocab notifications are delivered. Used by
--      scripts/vocab_digest.py to route between instant / daily-digest /
--      off. Default 'digest_daily' is conservative: an admin who never
--      visits /admin/vocab still gets one summary email per day instead
--      of one ping per vocab use.
--
--   2) notifications.digested_at + extend kind enum with
--      `tag_removed_by_other` (per plan §5.4, T25). digested_at is the
--      idempotence cursor for the digest script.
--
--   3) Three trigger functions:
--        - on_pending_tag_use  (prospect_tags AFTER INSERT) — fans
--          notifications to every admin when a rep uses a still-pending
--          vocab value, dedup'd across {creator-set, prospect-set}.
--        - on_tag_removed_by_other (prospect_tags AFTER DELETE) —
--          notifies the original creator when somebody else clears
--          their tag. Plan §5.4 + §5.5 + T25.
--        - audit_prospect_tag_change (REPLACE) — extended with
--          UPDATE branch so lock toggles + suppress / unsuppress also
--          appear in event_log → Activity tab.
--
--   4) on_rep_tag_vocab_insert (REPLACE) — payload now carries a
--      `creators` array (single-element on first insert) so the dedup
--      maths in on_pending_tag_use stays uniform.
--
-- Compliance soft-clear (already shipped in 008) is unchanged here; the
-- new audit branch picks up `suppressed_at` flips so the Activity tab can
-- show "Soft-cleared compliance:political" entries.
--
-- Cannabis-block (also already in T2 pipeline-side) is unchanged.
--
-- Paired rollback: 009_rollback.sql
-- Recovery procedure: see ROLLBACK.md
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) profiles.vocab_notify_mode
-- -------------------------------------------------------------------------
alter table public.profiles
  add column if not exists vocab_notify_mode text not null default 'digest_daily'
    check (vocab_notify_mode in ('instant', 'digest_daily', 'digest_off'));

-- -------------------------------------------------------------------------
-- 2) notifications schema bumps
-- -------------------------------------------------------------------------

-- 2a) digested_at — set by vocab_digest.py when it consolidates a row into
--     a daily digest (or when mode='digest_off'); compliance rows skip the
--     digest so they stay digested_at IS NULL forever (= "instant").
alter table public.notifications
  add column if not exists digested_at timestamptz;

create index if not exists idx_notif_kind_digested
  on public.notifications (kind, digested_at)
  where digested_at is null;

-- 2b) Extend kind enum with `tag_removed_by_other`. Drop + add the
--     check constraint to retain the existing values from 000_init.sql
--     and 007_tag_schema.sql.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'assigned', 'unassigned', 'note_mention', 'run_complete',
    'feedback_status', 'tag_vocab_pending', 'tag_removed_by_other'
  ));

-- -------------------------------------------------------------------------
-- 3) on_rep_tag_vocab_insert (REPLACE) — payload now carries creators[]
-- -------------------------------------------------------------------------
-- Same gate as 007 (force pending status + fan-out per admin) but the
-- payload now includes a `creators` array so on_pending_tag_use can
-- append to it without restructuring the JSON.
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
          'tag_id',       new.id,
          'axis',         new.axis,
          'value',        new.value,
          'creators',     jsonb_build_array(actor),
          'prospect_ids', '[]'::jsonb
        )
      );
    end loop;
  end if;

  return new;
end;
$$;

-- -------------------------------------------------------------------------
-- 4) on_pending_tag_use — prospect_tags AFTER INSERT
-- -------------------------------------------------------------------------
-- Fires only when the inserted prospect_tags row references a vocab whose
-- status is still 'pending_admin_review'. For every admin, the function
-- looks for an unread + un-digested tag_vocab_pending notification keyed
-- on the same tag_id. If one exists it appends the actor to
-- payload.creators (set semantics — no duplicates) and the prospect to
-- payload.prospect_ids; otherwise it inserts a fresh notification.
--
-- Skips entirely when the actor IS the original vocab creator AND no
-- prospect_ids have been recorded yet — that's the "rep-creates +
-- rep-uses" same-transaction path which on_rep_tag_vocab_insert already
-- covered. We still want prospect_id appended though, so the function
-- always runs the prospect_id-append branch.
create or replace function public.on_pending_tag_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  v_status text;
  v_axis text;
  v_value text;
  admin_id uuid;
  notif record;
  v_creators jsonb;
  v_prospects jsonb;
begin
  -- Service-role / pipeline writes carry actor=null. Skip — pipeline tags
  -- are emitted on already-active vocab.
  if actor is null then
    return new;
  end if;

  select status, axis, value into v_status, v_axis, v_value
    from public.tag_vocabulary where id = new.tag_id;

  if v_status is distinct from 'pending_admin_review' then
    return new;
  end if;

  for admin_id in
    select id from public.profiles where role = 'admin'
  loop
    select id, payload into notif
      from public.notifications
      where recipient_id = admin_id
        and kind = 'tag_vocab_pending'
        and read_at is null
        and digested_at is null
        and (payload ->> 'tag_id') = new.tag_id::text
      order by created_at desc
      limit 1;

    if notif.id is null then
      insert into public.notifications (
        recipient_id, kind, actor_id, payload
      )
      values (
        admin_id,
        'tag_vocab_pending',
        actor,
        jsonb_build_object(
          'tag_id',       new.tag_id,
          'axis',         v_axis,
          'value',        v_value,
          'creators',     jsonb_build_array(actor),
          'prospect_ids', jsonb_build_array(new.prospect_id)
        )
      );
    else
      -- Set semantics: only append if not already present.
      v_creators := coalesce(notif.payload -> 'creators', '[]'::jsonb);
      if not (v_creators @> to_jsonb(actor)) then
        v_creators := v_creators || to_jsonb(actor);
      end if;

      v_prospects := coalesce(notif.payload -> 'prospect_ids', '[]'::jsonb);
      if not (v_prospects @> to_jsonb(new.prospect_id)) then
        v_prospects := v_prospects || to_jsonb(new.prospect_id);
      end if;

      update public.notifications
        set payload = notif.payload
                       || jsonb_build_object(
                            'creators',     v_creators,
                            'prospect_ids', v_prospects
                          )
        where id = notif.id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists t_pending_tag_use on public.prospect_tags;
create trigger t_pending_tag_use
  after insert on public.prospect_tags
  for each row execute function public.on_pending_tag_use();

-- -------------------------------------------------------------------------
-- 5) on_tag_removed_by_other — prospect_tags AFTER DELETE
-- -------------------------------------------------------------------------
-- When user X deletes a prospect_tags row created by user Y (Y ≠ X), Y
-- gets a notification. Self-deletes are silent. Pipeline deletes
-- (actor null) are silent. Soft-clears (UPDATE setting suppressed_at)
-- intentionally do not fire this trigger — they don't remove the row.
create or replace function public.on_tag_removed_by_other()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  v_axis text;
  v_value text;
begin
  if actor is null then
    return old;
  end if;
  if old.created_by is null then
    return old;  -- pipeline-created; no human creator to notify.
  end if;
  if old.created_by = actor then
    return old;  -- self-delete; silent per plan §5.5.
  end if;

  select axis, value into v_axis, v_value
    from public.tag_vocabulary where id = old.tag_id;

  insert into public.notifications (
    recipient_id, kind, actor_id, prospect_id, payload
  )
  values (
    old.created_by,
    'tag_removed_by_other',
    actor,
    old.prospect_id,
    jsonb_build_object(
      'tag_id',     old.tag_id,
      'axis',       v_axis,
      'value',      v_value,
      'removed_at', now()
    )
  );

  return old;
end;
$$;

drop trigger if exists t_tag_removed_by_other on public.prospect_tags;
create trigger t_tag_removed_by_other
  after delete on public.prospect_tags
  for each row execute function public.on_tag_removed_by_other();

-- -------------------------------------------------------------------------
-- 6) audit_prospect_tag_change (REPLACE) — extend with UPDATE branch
-- -------------------------------------------------------------------------
-- The 007 trigger fires on INSERT / DELETE only. T3 needs lock-toggle
-- and suppress / unsuppress audit so the Activity tab can render them.
--
-- Categories emitted:
--   prospect_tag_added       — INSERT (unchanged)
--   prospect_tag_removed     — DELETE (unchanged)
--   prospect_tag_locked      — UPDATE: locked_by null -> uuid
--   prospect_tag_unlocked    — UPDATE: locked_by uuid -> null
--   prospect_tag_suppressed  — UPDATE: suppressed_at null -> ts
--   prospect_tag_unsuppressed — UPDATE: suppressed_at ts -> null
-- Other UPDATEs (e.g. tag_id reassignment by merge_tag_vocabulary RPC)
-- emit a generic prospect_tag_change.
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
  v_category text;
  v_message text;
  v_extra jsonb := '{}'::jsonb;
begin
  if (TG_OP = 'INSERT') then
    pid := new.prospect_id;
    tid := new.tag_id;
    v_category := 'prospect_tag_added';
  elsif (TG_OP = 'DELETE') then
    pid := old.prospect_id;
    tid := old.tag_id;
    v_category := 'prospect_tag_removed';
  else  -- UPDATE
    pid := new.prospect_id;
    tid := new.tag_id;
    if (old.locked_by is null) and (new.locked_by is not null) then
      v_category := 'prospect_tag_locked';
    elsif (old.locked_by is not null) and (new.locked_by is null) then
      v_category := 'prospect_tag_unlocked';
    elsif (old.suppressed_at is null) and (new.suppressed_at is not null) then
      v_category := 'prospect_tag_suppressed';
      v_extra := jsonb_build_object('suppressed_by', new.suppressed_by);
    elsif (old.suppressed_at is not null) and (new.suppressed_at is null) then
      v_category := 'prospect_tag_unsuppressed';
    else
      v_category := 'prospect_tag_change';
    end if;
  end if;

  select axis, value into v_axis, v_value
    from public.tag_vocabulary where id = tid;

  v_message := format(
    'prospect %s: tag %s/%s %s',
    pid, v_axis, v_value,
    case v_category
      when 'prospect_tag_added'        then 'added'
      when 'prospect_tag_removed'      then 'removed'
      when 'prospect_tag_locked'       then 'locked'
      when 'prospect_tag_unlocked'     then 'unlocked'
      when 'prospect_tag_suppressed'   then 'soft-cleared'
      when 'prospect_tag_unsuppressed' then 'restored'
      else 'changed'
    end
  );

  insert into public.event_log (source, level, category, message, context, user_id)
  values (
    case when actor is null then 'pipeline' else 'web_server' end,
    'info',
    v_category,
    v_message,
    jsonb_build_object(
      'prospect_id', pid,
      'tag_id',      tid,
      'axis',        v_axis,
      'value',       v_value,
      'actor_id',    actor
    ) || v_extra,
    actor
  );

  if TG_OP = 'INSERT' then return new; end if;
  if TG_OP = 'UPDATE' then return new; end if;
  return old;
end;
$$;

-- Re-attach to all three TG_OPs.
drop trigger if exists t_prospect_tags_audit on public.prospect_tags;
create trigger t_prospect_tags_audit
  after insert or update or delete on public.prospect_tags
  for each row execute function public.audit_prospect_tag_change();

-- =========================================================================
-- End of 009_tag_triggers.sql
-- =========================================================================

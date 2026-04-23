-- WHRB prospects — tag schema (Stage T1)
-- =========================================================================
-- Adds tag_vocabulary + prospect_tags + supporting triggers, RLS policies,
-- and helper functions (merge_tag_vocabulary). Extends notifications.kind
-- to allow 'tag_vocab_pending'.
--
-- Migration number 007 follows 006_pipeline_dispatch_skip_fixtures.sql
-- (Stage 10c follow-up). The plan originally called this 006; renumbered
-- per round-? clarification 2026-04-22 because 006 was consumed during
-- Stage 10c.
--
-- Canonical location: whrb-web/supabase/migrations/007_tag_schema.sql
-- Mirrored (read-only reference) at: whrb-prospects/db/schema.sql
-- Apply via: whrb-prospects/scripts/apply_t1_migration.py
--
-- Paired rollback: 007_rollback.sql
-- Recovery procedure: see ROLLBACK.md
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) tag_vocabulary
-- -------------------------------------------------------------------------
create table if not exists public.tag_vocabulary (
  id uuid primary key default gen_random_uuid(),
  axis text not null check (axis in (
    'sector','operating_model','genre','affiliation','cadence',
    'daypart_fit','history','compliance','other'
  )),
  value text not null,
  status text not null default 'active' check (status in (
    'active','pending_admin_review','deprecated'
  )),
  replacement_id uuid references public.tag_vocabulary(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (axis, value)
);

create index if not exists idx_tag_vocabulary_axis_status
  on public.tag_vocabulary (axis, status);

-- -------------------------------------------------------------------------
-- 2) prospect_tags
-- -------------------------------------------------------------------------
create table if not exists public.prospect_tags (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  tag_id uuid not null references public.tag_vocabulary(id),
  -- created_by NULL = pipeline/system-created; set = user-created.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- locked_by NULL = unlocked; set = locked by that user (or pipeline if
  -- a future scraper claims a per-tag lock — none do today).
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz,
  unique (prospect_id, tag_id)
);

create index if not exists idx_prospect_tags_prospect_id
  on public.prospect_tags (prospect_id);
create index if not exists idx_prospect_tags_tag_id
  on public.prospect_tags (tag_id);

-- -------------------------------------------------------------------------
-- 3) Extend notifications.kind enum to allow tag_vocab_pending
-- -------------------------------------------------------------------------
-- Drop and recreate the check constraint with the new value appended.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'assigned','unassigned','note_mention','run_complete',
    'feedback_status','tag_vocab_pending'
  ));

-- -------------------------------------------------------------------------
-- 4) Triggers
-- -------------------------------------------------------------------------

-- 4a) updated_at maintenance on tag_vocabulary
create trigger t_tag_vocabulary_updated_at
  before update on public.tag_vocabulary
  for each row execute function public.set_updated_at();

-- 4b) Rep-add gate on tag_vocabulary INSERT.
--     If the actor is a non-admin authed user, force status to
--     'pending_admin_review' and queue a notifications row for every admin.
--     Service-role inserts (auth.uid() is null) and admin-authored inserts
--     are left untouched.
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
    -- Force the moderation gate.
    new.status := 'pending_admin_review';
    if new.created_by is null then
      new.created_by := actor;
    end if;

    -- Fan out one notification per admin so the inbox bell lights up.
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

create trigger t_tag_vocabulary_rep_insert
  before insert on public.tag_vocabulary
  for each row execute function public.on_rep_tag_vocab_insert();

-- 4c) Audit trigger for prospect_tags.
--     Emits prospect_tag_added / prospect_tag_removed event_log rows.
--     Mirrors the audit_prospect_change pattern from 000_init.sql.
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

-- -------------------------------------------------------------------------
-- 5) merge_tag_vocabulary RPC
-- -------------------------------------------------------------------------
-- Merge p_source_id into p_target_id. Same-axis only (per gleaming-dawn
-- §1.3 #22). Raises P0002 on cross-axis attempt; the API route translates
-- that to HTTP 400.
--
-- Returns affected_prospect_count + collision_count for audit logging.
create or replace function public.merge_tag_vocabulary(
  p_source_id uuid,
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  src record;
  tgt record;
  v_affected int;
  v_collisions int;
begin
  select id, axis, value, status into src
    from public.tag_vocabulary where id = p_source_id;
  select id, axis, value, status into tgt
    from public.tag_vocabulary where id = p_target_id;

  if src.id is null then
    raise exception 'source tag % not found', p_source_id
      using errcode = 'P0001';
  end if;
  if tgt.id is null then
    raise exception 'target tag % not found', p_target_id
      using errcode = 'P0001';
  end if;
  if src.id = tgt.id then
    raise exception 'cannot merge a tag into itself'
      using errcode = 'P0003';
  end if;
  if src.axis <> tgt.axis then
    raise exception 'cross-axis merge denied: source.axis=% target.axis=%',
      src.axis, tgt.axis using errcode = 'P0002';
  end if;

  -- Count rows that will move (no collision with target on same prospect).
  select count(*) into v_affected
    from public.prospect_tags ps
   where ps.tag_id = p_source_id
     and not exists (
       select 1 from public.prospect_tags pt
        where pt.tag_id = p_target_id and pt.prospect_id = ps.prospect_id
     );

  -- Count rows that will be dropped because the prospect already has the
  -- target tag too.
  select count(*) into v_collisions
    from public.prospect_tags ps
   where ps.tag_id = p_source_id
     and exists (
       select 1 from public.prospect_tags pt
        where pt.tag_id = p_target_id and pt.prospect_id = ps.prospect_id
     );

  -- Move non-colliding rows.
  update public.prospect_tags
     set tag_id = p_target_id
   where tag_id = p_source_id
     and not exists (
       select 1 from public.prospect_tags pt
        where pt.tag_id = p_target_id
          and pt.prospect_id = prospect_tags.prospect_id
     );

  -- Drop colliding rows (target already on the prospect).
  delete from public.prospect_tags where tag_id = p_source_id;

  -- Drop the source vocab row.
  delete from public.tag_vocabulary where id = p_source_id;

  return jsonb_build_object(
    'affected_prospect_count', v_affected,
    'collision_count',         v_collisions,
    'from_axis',               src.axis,
    'from_value',              src.value,
    'to_axis',                 tgt.axis,
    'to_value',                tgt.value
  );
end;
$$;

revoke all on function public.merge_tag_vocabulary(uuid, uuid) from public;
grant execute on function public.merge_tag_vocabulary(uuid, uuid)
  to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 6) Row Level Security
-- -------------------------------------------------------------------------

-- 6a) tag_vocabulary
alter table public.tag_vocabulary enable row level security;

-- Authed users may SELECT all rows regardless of status (so a rep sees
-- pending_admin_review tags they themselves submitted, and admins see
-- everything for the moderation inbox).
create policy p_tag_vocab_read on public.tag_vocabulary
  for select using (auth.uid() is not null);

-- Any authed user may INSERT; the on_rep_tag_vocab_insert trigger forces
-- non-admin inserts to status='pending_admin_review'.
create policy p_tag_vocab_insert on public.tag_vocabulary
  for insert with check (auth.uid() is not null);

-- Only admins may UPDATE (rename, axis change, status change, replacement).
create policy p_tag_vocab_admin_update on public.tag_vocabulary
  for update using (
    exists (select 1 from public.profiles
             where id = auth.uid() and role = 'admin')
  );

-- Only admins may DELETE (hard delete; cascading is via merge RPC).
create policy p_tag_vocab_admin_delete on public.tag_vocabulary
  for delete using (
    exists (select 1 from public.profiles
             where id = auth.uid() and role = 'admin')
  );

-- 6b) prospect_tags
alter table public.prospect_tags enable row level security;

create policy p_prospect_tags_read on public.prospect_tags
  for select using (auth.uid() is not null);

-- Any authed user may INSERT.
create policy p_prospect_tags_insert on public.prospect_tags
  for insert with check (auth.uid() is not null);

-- Lock-aware DELETE policy:
--   - Admins may delete any row.
--   - Otherwise the row must be unlocked OR locked by the requester.
-- (The pipeline runs as service_role and bypasses RLS; the application
-- layer in db/supabase_sync.py enforces the lock check there. T2 wires
-- that up.)
create policy p_prospect_tags_delete on public.prospect_tags
  for delete using (
    auth.uid() is not null and (
      exists (select 1 from public.profiles
               where id = auth.uid() and role = 'admin')
      or locked_by is null
      or locked_by = auth.uid()
    )
  );

-- UPDATE is used only for lock toggling. Same lock-aware gate.
create policy p_prospect_tags_update on public.prospect_tags
  for update
  using (
    auth.uid() is not null and (
      exists (select 1 from public.profiles
               where id = auth.uid() and role = 'admin')
      or locked_by is null
      or locked_by = auth.uid()
    )
  )
  with check (
    auth.uid() is not null and (
      exists (select 1 from public.profiles
               where id = auth.uid() and role = 'admin')
      or locked_by is null
      or locked_by = auth.uid()
    )
  );

-- =========================================================================
-- End of 007_tag_schema.sql
-- =========================================================================

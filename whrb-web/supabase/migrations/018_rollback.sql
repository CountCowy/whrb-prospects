-- =========================================================================
-- 018_rollback.sql — Reverse of 018_ad_orders.sql
--
-- WARNING: dropping ad_orders, ad_order_amendments, and org_settings
-- DELETES DATA. For a soft revert (revert app, keep data) flip the
-- feature flag (`NEXT_PUBLIC_FEATURE_AD_ORDERS=off`) and DO NOT run
-- this script. Only run rollback if the data is corrupt or the
-- migration must be re-applied from scratch.
--
-- Drops in reverse order: triggers -> policies -> view -> function
-- -> tables. Idempotent via `if exists`.
-- =========================================================================

-- Triggers ----------------------------------------------------------------
drop trigger if exists t_ad_orders_audit          on public.ad_orders;
drop trigger if exists t_ad_orders_paid_lockdown  on public.ad_orders;
drop trigger if exists t_ad_orders_update_guard   on public.ad_orders;
drop trigger if exists t_ad_orders_touch          on public.ad_orders;
drop trigger if exists t_org_settings_touch       on public.org_settings;

-- Functions ---------------------------------------------------------------
drop function if exists public.ad_order_amend(uuid, text, text, text);
drop function if exists public.audit_ad_order_change();
drop function if exists public.enforce_ad_order_paid_lockdown();
drop function if exists public.enforce_ad_order_update_guard();

-- View --------------------------------------------------------------------
drop view if exists public.ad_orders_status;

-- whrb_semester is only used by ad_orders today; safe to drop.
drop function if exists public.whrb_semester(date);

-- Indexes are dropped automatically with the tables.

-- Policies ----------------------------------------------------------------
-- (Dropped automatically when the table is dropped, but list them for
-- documentation + so a partial rollback could replay this section.)
drop policy if exists p_ad_order_amend_no_delete on public.ad_order_amendments;
drop policy if exists p_ad_order_amend_no_update on public.ad_order_amendments;
drop policy if exists p_ad_order_amend_insert    on public.ad_order_amendments;
drop policy if exists p_ad_order_amend_read      on public.ad_order_amendments;

drop policy if exists p_ad_orders_no_delete on public.ad_orders;
drop policy if exists p_ad_orders_update    on public.ad_orders;
drop policy if exists p_ad_orders_insert    on public.ad_orders;
drop policy if exists p_ad_orders_read      on public.ad_orders;

drop policy if exists p_orgsettings_no_delete on public.org_settings;
drop policy if exists p_orgsettings_no_insert on public.org_settings;
drop policy if exists p_orgsettings_update    on public.org_settings;
drop policy if exists p_orgsettings_read      on public.org_settings;

-- Tables ------------------------------------------------------------------
drop table if exists public.ad_order_amendments;
drop table if exists public.ad_orders;
drop table if exists public.org_settings;

-- =========================================================================
-- End of 018_rollback.sql
-- =========================================================================

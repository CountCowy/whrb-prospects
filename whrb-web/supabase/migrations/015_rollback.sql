-- 015_rollback.sql — Roll back peer_stations table + RLS + seed.
-- Mirror of 015_peer_stations.sql. Drops everything that migration created.

drop trigger if exists t_peer_stations_updated_at on public.peer_stations;

drop policy if exists p_peer_stations_admin_write on public.peer_stations;
drop policy if exists p_peer_stations_read on public.peer_stations;

drop table if exists public.peer_stations;

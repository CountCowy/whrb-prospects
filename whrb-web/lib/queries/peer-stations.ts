import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Peer-station whitelist consumed by the Stage T5 competitor_stations
 * scraper. When a scraped sponsor name matches an active peer (substring
 * containment on the normalized form), the row is tagged
 * `history:peer_public_radio` AND suppressed from the prospect set.
 *
 * Admin-editable via /admin/peer-stations so a station rebrand or new
 * peer entrant doesn't require a code change. Pipeline loads
 * `status='active'` rows at startup.
 *
 * Schema: migration `015_peer_stations.sql`.
 */

export type PeerStationStatus = 'active' | 'deprecated';

export type PeerStationRow = {
  id: string;
  normalized_name: string;
  display_name: string;
  status: PeerStationStatus;
  added_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function listPeerStations(): Promise<PeerStationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('peer_stations')
    .select(
      'id, normalized_name, display_name, status, added_by, notes, created_at, updated_at',
    )
    .order('status', { ascending: true })
    .order('display_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PeerStationRow[];
}

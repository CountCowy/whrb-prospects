import { listPeerStations } from '@/lib/queries/peer-stations';
import { PeerStationsManager } from '@/components/admin/PeerStationsManager';

export const dynamic = 'force-dynamic';

export default async function AdminPeerStationsPage() {
  const rows = await listPeerStations();
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Peer stations
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          The whitelist of peer public-radio entities (and the five
          competitor_stations scrape targets themselves). Any sponsor
          name scraped by{' '}
          <code>sources/competitor_stations.py</code> whose normalized
          form contains an active row&rsquo;s normalized name is tagged{' '}
          <code>history:peer_public_radio</code> and suppressed from the
          prospect set. Pipeline reloads this list at startup; no code
          change needed for a station rebrand.
        </p>
      </div>
      <PeerStationsManager initialRows={rows} />
    </div>
  );
}

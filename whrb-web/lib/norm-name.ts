/**
 * Mirror of `whrb-prospects/enrich/dedupe.py::_norm_name`. The Python pipeline
 * normalizes scraped sponsor names with this exact recipe before matching
 * against `peer_stations.normalized_name` (substring + token-containment in
 * `sources/competitor_stations.py::_is_peer_station`). Any divergence between
 * the two implementations silently breaks the peer-station whitelist for
 * names containing non-ASCII letters or underscores — e.g. an admin entry
 * for `Café Müller` would never match the scraped `café müller` if the JS
 * side stripped the accented letters.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

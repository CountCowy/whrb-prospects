import 'server-only';

/**
 * Defense-in-depth validation for admin-supplied ICS feed URLs.
 *
 * The Python sync worker (`whrb-prospects/scripts/sync_external_calendars.py`)
 * is the authoritative SSRF gate (DNS-resolved IP allowlist, manual redirect
 * walking, byte cap). This validator runs at the API write boundary so we
 * never persist a URL the worker would later refuse.
 *
 * Rejects:
 *   - non-HTTPS schemes (file://, http://, gopher://, etc.)
 *   - hostnames that obviously target localhost or RFC1918 ranges
 *
 * Note: this is a HOSTNAME-level lexical check; it does not resolve DNS.
 * The worker re-validates with a real socket lookup.
 */
export function validateFeedUrl(raw: string): { ok: true } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'feed_url is not a valid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'feed_url must use https://' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]'
  ) {
    return { ok: false, error: 'feed_url cannot target localhost' };
  }
  // Lexical RFC1918 / link-local IPv4 check; the worker handles edge cases.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map((n) => Number(n));
    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224
    ) {
      return { ok: false, error: 'feed_url cannot target a private/reserved IP' };
    }
  }
  return { ok: true };
}

import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FEATURED_CLIENTS, type FeaturedClient } from '@/config/rate-card';

/**
 * Featured-client logo grid (`/media-kit` Section 6).
 *
 * Server component — at render time, looks up each client name in
 * `prospects.company_name` (case-insensitive, whitespace-collapsed) and
 * resolves the logo anchor to either:
 *   - `/prospects/<id>` if the prospect exists in the corpus, OR
 *   - `client.fallbackUrl` (an external website) otherwise.
 *
 * The match logic is deliberately simpler than `_norm_name` from the
 * pipeline's dedupe — just lower-case + collapse whitespace — because we
 * want exact-name signal here and we accept fall-through to the fallback
 * URL when the row isn't in the corpus yet.
 */
export async function FeaturedClients() {
  const matches = await resolveClientMatches(FEATURED_CLIENTS);

  return (
    <section
      data-testid="featured-clients"
      aria-labelledby="featured-clients-heading"
      className="space-y-4"
    >
      <h2
        id="featured-clients-heading"
        className="text-xl font-semibold tracking-tight"
      >
        Featured clients
      </h2>
      <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
        Boston cultural anchors and trusted local brands who already
        underwrite WHRB programming.
      </p>
      <ul
        data-testid="featured-clients-grid"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3"
      >
        {FEATURED_CLIENTS.map((client) => {
          const matched = matches.get(client.name);
          const href = matched
            ? `/prospects/${matched}`
            : client.fallbackUrl;
          const internal = Boolean(matched);
          return (
            <li
              key={client.name}
              data-testid="featured-client"
              data-client={client.name}
              data-resolution={internal ? 'prospect' : 'fallback'}
              className="group flex aspect-[3/2] items-center justify-center rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4 transition-shadow hover:shadow-[var(--shadow-md)]"
            >
              {internal ? (
                <Link
                  href={href}
                  className="flex h-full w-full items-center justify-center"
                >
                  <ClientLogo client={client} />
                </Link>
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full w-full items-center justify-center"
                >
                  <ClientLogo client={client} />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ClientLogo({ client }: { client: FeaturedClient }) {
  return (
    <Image
      src={client.logo}
      alt={client.name}
      width={240}
      height={120}
      className="h-auto max-h-20 w-auto max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
      data-testid="featured-client-logo"
    />
  );
}

/** Case-insensitive whitespace-collapsed normalize — distinct from the
 *  pipeline's `_norm_name` (which strips punctuation and is tuned for
 *  fuzzy dedupe). */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function resolveClientMatches(
  clients: readonly FeaturedClient[],
): Promise<Map<string, string>> {
  const supabase = await createClient();
  // Build a single OR query covering every client name's normalized form.
  // Postgres-side ilike with full names — small N (9) so simple is fine.
  const { data, error } = await supabase
    .from('prospects')
    .select('id, company_name')
    .in(
      'company_name',
      clients.map((c) => c.name),
    );
  const exactById = new Map<string, string>();
  if (!error && data) {
    for (const row of data as Array<{ id: string; company_name: string }>) {
      exactById.set(normalize(row.company_name), row.id);
    }
  }

  // Fallback: for any client we didn't get an exact match on, try ilike.
  const out = new Map<string, string>();
  for (const client of clients) {
    const direct = exactById.get(normalize(client.name));
    if (direct) {
      out.set(client.name, direct);
      continue;
    }
    const { data: row } = await supabase
      .from('prospects')
      .select('id')
      .ilike('company_name', client.name)
      .limit(1)
      .maybeSingle();
    if (row?.id) {
      out.set(client.name, row.id as string);
    }
  }
  return out;
}

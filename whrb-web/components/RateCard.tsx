import Link from 'next/link';
import { RATE_CARD } from '@/config/rate-card';

/**
 * Rate-card table — `/media-kit` Section 4. Renders four sub-blocks:
 *   1. Regular per-spot rates (Classical / Jazz / Blues / Other).
 *   2. Special spots (Met Opera, Hillbilly, SNATO, Sports).
 *   3. Print guide ad pricing.
 *   4. Web banner + sidebar pricing.
 *
 * All numbers come from `whrb-web/config/rate-card.ts`; do not duplicate.
 *
 * Mobile (<md): the regular-rates table horizontal-scrolls inside its
 * container with the program column kept sticky-left for orientation.
 */
export function RateCard() {
  const dollar = (n: number) => `$${n.toLocaleString()}`;

  return (
    <section
      data-testid="rate-card"
      aria-labelledby="rate-card-heading"
      className="space-y-6"
    >
      <h2
        id="rate-card-heading"
        className="text-xl font-semibold tracking-tight"
      >
        Rate card
      </h2>

      {/* 1) Regular spot rates */}
      <div
        data-testid="rate-card-regular"
        className="overflow-x-auto rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]"
      >
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-[hsl(var(--muted))]/50 px-4 py-3"
              >
                Program
              </th>
              <th scope="col" className="px-4 py-3">
                Airtimes
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                30&quot;
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                60&quot;
              </th>
            </tr>
          </thead>
          <tbody>
            {RATE_CARD.regular.map((row) => {
              const dayparts = row.dayparts.map(
                (d) => d.replace(/^daypart_/, ''),
              );
              const href = `/prospects?daypart=${dayparts.join(',')}`;
              return (
                <tr
                  key={row.program}
                  data-testid="rate-card-regular-row"
                  data-program={row.program}
                  className="border-t border-[hsl(var(--border-subtle))]"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-[hsl(var(--surface))] px-4 py-3 text-left font-medium"
                  >
                    <Link
                      href={href}
                      className="text-[hsl(var(--primary))] underline underline-offset-2 hover:decoration-2"
                      data-testid="rate-card-program-link"
                    >
                      {row.program}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {row.airTimes.join(' · ')}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {dollar(row.thirty)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {dollar(row.sixty)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 2) Special spots */}
      <div data-testid="rate-card-special" className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
          Special spots
        </h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {RATE_CARD.special.map((row) => {
            const inner = (
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{row.name}</span>
                <span className="tabular-nums text-[hsl(var(--primary))]">
                  {dollar(row.price)}/{row.unit}
                  {row.season ? (
                    <span className="ml-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                      ({row.season})
                    </span>
                  ) : null}
                </span>
              </span>
            );
            return (
              <li
                key={row.name}
                data-testid="rate-card-special-row"
                data-name={row.name}
                className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] px-4 py-3 text-sm transition-colors hover:bg-[hsl(var(--muted))]/30"
              >
                {row.href ? (
                  <Link href={row.href} className="block">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 3) Print + 4) Web */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div
          data-testid="rate-card-print"
          className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4 text-sm"
        >
          <h3 className="font-semibold">Print ads</h3>
          <p className="mt-2 text-[hsl(var(--muted-foreground))]">
            Half-page {RATE_CARD.print.color}, {RATE_CARD.print.dimensions}.
          </p>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">
            {dollar(RATE_CARD.print.pricePerGuide)}/guide
            {' · '}
            {RATE_CARD.print.guidesPerYear} guides/yr to{' '}
            {RATE_CARD.print.subscribers.toLocaleString()}+ subscribers.
          </p>
        </div>
        <div
          data-testid="rate-card-web"
          className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4 text-sm"
        >
          <h3 className="font-semibold">Website ads</h3>
          <p className="mt-2 text-[hsl(var(--muted-foreground))]">
            <span className="font-medium">Banner</span>{' '}
            {RATE_CARD.web.banner.dimensions} —{' '}
            {dollar(RATE_CARD.web.banner.pricePerMonth)}/mo
          </p>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">
            <span className="font-medium">Sidebar</span>{' '}
            {RATE_CARD.web.sidebar.dimensions} —{' '}
            {dollar(RATE_CARD.web.sidebar.pricePerMonth)}/mo
          </p>
        </div>
      </div>

      {/* Corporate Underwriting Philanthropy blurb + footer note */}
      <div
        data-testid="rate-card-corporate-underwriting"
        className="rounded-xl border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] p-4 text-sm"
      >
        <h3 className="font-semibold text-[hsl(var(--primary))]">
          Corporate Underwriting Philanthropy
        </h3>
        <p className="mt-2 text-foreground">
          In addition to advertising your own business, you may purchase
          advertising for an organization of your choosing — a performing
          arts group or local non-profit. Contact{' '}
          <a
            href="mailto:sales@whrb.org?subject=Corporate%20Underwriting%20Philanthropy"
            className="font-medium underline underline-offset-2"
          >
            sales@whrb.org
          </a>{' '}
          for details.
        </p>
      </div>
      <p className="text-xs italic text-[hsl(var(--muted-foreground))]">
        Non-profit, season/year-long, and first-time discounts available.
        Customize packages — contact{' '}
        <a
          href="mailto:sales@whrb.org"
          className="font-medium underline underline-offset-2"
        >
          sales@whrb.org
        </a>
        .
      </p>
    </section>
  );
}

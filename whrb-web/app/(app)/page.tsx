import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getHomeStats } from '@/lib/queries/prospects';
import { listRecentActivity } from '@/lib/queries/notes';
import { listMyFeedback } from '@/lib/queries/feedback';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { FeedbackHistory } from '@/components/FeedbackHistory';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatInTz, formatRelative, TIMEZONE } from '@/lib/time';

export const dynamic = 'force-dynamic';

type Tile = {
  label: string;
  value: number;
  href?: string;
  hint: string;
  testid: string;
  /** Hero-scale tile — rendered larger and tinted crimson.
   *  Foundation plan: "Total prospects" is the sole hero. */
  hero?: boolean;
  /** Optional native tooltip rendered via `title=`. Used by the T4
   *  week-to-date delta tile to flag the Monday reset. */
  tooltip?: string;
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;
  const firstName = user?.email?.split('@')[0] ?? 'there';

  const [stats, activity, feedback] = await Promise.all([
    getHomeStats(userId),
    listRecentActivity(10),
    listMyFeedback(),
  ]);

  const now = formatInTz(new Date(), 'EEEE, MMMM d · h:mm a zzz');

  const tiles: Tile[] = [
    {
      label: 'Total prospects',
      value: stats.total,
      hint: 'Pipeline corpus',
      testid: 'tile-total',
      href: '/prospects',
      hero: true,
    },
    { label: 'Tier A', value: stats.tierA, hint: 'Anchor sponsors', testid: 'tile-tier-a', href: '/prospects?tier=A' },
    { label: 'Unassigned', value: stats.unassigned, hint: 'No rep yet', testid: 'tile-unassigned', href: '/prospects?assigned=false' },
    { label: 'Nonprofit', value: stats.nonprofit, hint: 'IRS / manual tagged', testid: 'tile-nonprofit', href: '/prospects?is_nonprofit=true' },
    { label: 'Assigned to me', value: stats.myAssigned, hint: 'Your queue', testid: 'tile-my-assigned', href: '/my' },
    { label: 'With email', value: stats.withEmail, hint: 'Company email on file', testid: 'tile-with-email' },
    {
      label: 'Added this week',
      value: stats.recent7d,
      hint: 'Last 7 days',
      testid: 'tile-recent-7d',
    },
    // --- T4 delta tiles (appended; hero stays "Total prospects") ---
    {
      label: 'New since last run',
      value: stats.newSinceLastRun,
      hint: 'Pipeline diff',
      testid: 'tile-delta-new',
      href: '/admin/runs',
    },
    {
      label: 'Tag changes this week',
      value: stats.tagChangesThisWeek,
      hint: 'Resets Monday 00:00 UTC',
      testid: 'tile-delta-tag-changes',
      tooltip:
        'Week-to-date count of prospect_tags rows created since Monday 00:00 UTC. Resets on the Monday boundary.',
    },
    {
      label: 'Prospects gone quiet',
      value: stats.goneQuiet,
      hint: 'Active client + 90d idle',
      testid: 'tile-delta-gone-quiet',
      href: '/prospects?state=ongoing_contact',
    },
  ];

  return (
    <div className="space-y-8">
      <section className="accent-gradient -mx-4 -mt-6 rounded-none px-4 pt-12 pb-10 sm:-mx-6 sm:rounded-b-3xl sm:px-6">
        <div className="mx-auto max-w-7xl">
          <Badge
            variant="outline"
            className="gap-2 rounded-full border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-medium tracking-[0.14em] text-[hsl(var(--primary))] uppercase"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
            WHRB 95.3 FM · Sales
          </Badge>
          <h1 className="mt-5 text-[2rem] leading-[1.05] font-semibold tracking-[-0.02em] sm:text-[2.75rem]">
            Welcome, <span className="text-[hsl(var(--primary))]">{firstName}</span>
            <span className="text-muted-foreground">.</span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">{now}</p>
        </div>
      </section>

      <section
        data-testid="home-tiles"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {tiles.map(({ label, value, hint, href, testid, hero, tooltip }) => {
          // Hero-only secondary content: tier distribution bar + legend.
          // Fills the otherwise-empty bottom of the 2×2 hero cell and
          // contextualises "3,266 total" with the A/B/C split that drives
          // the sales workflow.
          const heroExtras =
            hero && testid === 'tile-total' ? (
              <TierBreakdown
                total={stats.total}
                a={stats.tierA}
                b={stats.tierB}
                c={stats.tierC}
              />
            ) : null;
          const content = (
            <Card
              data-testid={testid}
              data-hero={hero ? 'true' : 'false'}
              className={cn(
                'group relative h-full overflow-hidden transition-all',
                hero
                  ? [
                      'border-[hsl(var(--primary-soft-border))]',
                      // NB: use the raw --primary channel triple + alpha here.
                      // `--primary-soft` already bakes in its own alpha, so
                      // `hsl(var(--primary-soft)/0.4)` would emit a malformed
                      // `hsl(H S L / α / 0.4)` and the gradient stop is
                      // dropped silently by every browser.
                      'bg-gradient-to-br from-[hsl(var(--surface))] to-[hsl(var(--primary)/0.12)]',
                      'hover:shadow-[var(--shadow-md)]',
                    ]
                  : [
                      'border-[hsl(var(--border-subtle))]',
                      'shadow-[var(--shadow-sm)]',
                      'hover:-translate-y-[1px] hover:border-[hsl(var(--border))] hover:shadow-[var(--shadow-md)]',
                    ],
              )}
            >
              {hero ? null : (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[hsl(var(--primary))] to-transparent opacity-30 transition-opacity group-hover:opacity-80"
                />
              )}
              <CardContent className={cn('p-5', hero && 'sm:p-7')}>
                <div className="flex items-start justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {label}
                  </div>
                  {href ? (
                    <ArrowUpRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  ) : null}
                </div>
                <div className="mt-3 font-semibold tabular-nums text-foreground">
                  <span
                    className={cn(
                      hero
                        ? 'text-[3.5rem] leading-none tracking-[-0.02em]'
                        : 'text-3xl',
                    )}
                    data-testid={`${testid}-value`}
                  >
                    {value.toLocaleString()}
                  </span>
                </div>
                <div
                  className={cn(
                    'mt-3 flex items-center gap-1.5 text-[11px]',
                    hero
                      ? 'text-[hsl(var(--primary))]'
                      : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-1 w-1 rounded-full',
                      hero
                        ? 'bg-[hsl(var(--primary))]'
                        : 'bg-[hsl(var(--muted-foreground))]/50',
                    )}
                  />
                  {hint}
                </div>
                {heroExtras}
              </CardContent>
            </Card>
          );
          // Grid child carries the row/col span — putting the span classes
          // on the inner Card is a no-op because Card is not a direct grid
          // item. Link (or the fallback div) IS the direct child.
          const spanClass = hero ? 'sm:col-span-2 sm:row-span-2 lg:col-span-2' : '';
          return href ? (
            <Link
              key={label}
              href={href}
              title={tooltip}
              className={cn(
                'block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]',
                spanClass,
              )}
            >
              {content}
            </Link>
          ) : (
            <div key={label} title={tooltip} className={spanClass}>
              {content}
            </div>
          );
        })}
      </section>

      <section
        data-testid="recent-activity"
        className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent activity</h2>
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Last 10 notes · {TIMEZONE.split('/')[1].replace('_', ' ')}
          </span>
        </div>
        {activity.length === 0 ? (
          <p
            data-testid="recent-activity-empty"
            className="mt-4 text-sm text-muted-foreground"
          >
            No notes yet — prospect notes land here as the team starts working rows.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[hsl(var(--border-subtle))]">
            {activity.map((a) => (
              <li
                key={a.id}
                data-testid="recent-activity-item"
                data-prospect-id={a.prospect_id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/prospects/${a.prospect_id}`}
                    className="font-medium text-foreground hover:text-[hsl(var(--primary))] hover:underline"
                  >
                    {a.prospect?.company_name ?? 'Unknown prospect'}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {a.body}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                  <div>{a.author?.display_name || a.author?.email?.split('@')[0] || '—'}</div>
                  <div className="tabular-nums">{formatRelative(a.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FeedbackWidget variant="inline" />

      <section
        data-testid="feedback-history-section"
        className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Your feedback</h2>
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Last 25 items
          </span>
        </div>
        <FeedbackHistory rows={feedback} />
      </section>
    </div>
  );
}

/**
 * Tier distribution strip — renders inside the hero tile below the
 * "Pipeline corpus" hint. A horizontal stacked bar whose three segments
 * are proportional to the A / B / C tier counts, followed by a
 * count legend with colored dots matching each segment.
 *
 * Degrades gracefully when data is thin:
 *   - `total === 0`       → render nothing
 *   - individual count 0  → segment width is 0%, legend entry hidden
 *   - A+B+C < total       → the delta is "untiered"; bar shows a
 *                            --muted trailing gutter via the bar's
 *                            container bg, labels show the three
 *                            tiers only (intentional — untiered
 *                            isn't an actionable category).
 */
function TierBreakdown({
  total,
  a,
  b,
  c,
}: {
  total: number;
  a: number;
  b: number;
  c: number;
}) {
  if (total <= 0) return null;
  const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
  return (
    <div
      data-testid="hero-tier-breakdown"
      className="mt-6 space-y-3 border-t border-[hsl(var(--primary-soft-border))] pt-4"
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        By tier
      </div>
      <div
        role="img"
        aria-label={`Tier distribution: A ${a}, B ${b}, C ${c}, total ${total}`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]"
      >
        {a > 0 ? (
          <div
            className="bg-[hsl(var(--tier-a))]"
            style={{ width: pct(a) }}
          />
        ) : null}
        {b > 0 ? (
          <div
            className="bg-[hsl(var(--tier-b))]"
            style={{ width: pct(b) }}
          />
        ) : null}
        {c > 0 ? (
          <div
            className="bg-[hsl(var(--tier-c))]"
            style={{ width: pct(c) }}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
        <TierLegend tone="a" count={a} label="A" />
        <TierLegend tone="b" count={b} label="B" />
        <TierLegend tone="c" count={c} label="C" />
      </div>
    </div>
  );
}

function TierLegend({
  tone,
  count,
  label,
}: {
  tone: 'a' | 'b' | 'c';
  count: number;
  label: string;
}) {
  const dotClass =
    tone === 'a'
      ? 'bg-[hsl(var(--tier-a))]'
      : tone === 'b'
        ? 'bg-[hsl(var(--tier-b))]'
        : 'bg-[hsl(var(--tier-c))]';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn('inline-block h-1.5 w-1.5 rounded-full', dotClass)}
      />
      <span className="font-medium text-foreground">{label}</span>
      <span>{count.toLocaleString()}</span>
    </span>
  );
}

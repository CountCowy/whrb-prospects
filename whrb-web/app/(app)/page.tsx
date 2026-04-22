import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getHomeStats } from '@/lib/queries/prospects';
import { listRecentActivity } from '@/lib/queries/notes';
import { listMyFeedback } from '@/lib/queries/feedback';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { FeedbackHistory } from '@/components/FeedbackHistory';
import { formatInTz, formatRelative, TIMEZONE } from '@/lib/time';

export const dynamic = 'force-dynamic';

type Tile = {
  label: string;
  value: number;
  href?: string;
  hint: string;
  testid: string;
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
    { label: 'Total prospects', value: stats.total, hint: 'Pipeline corpus', testid: 'tile-total', href: '/prospects' },
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
  ];

  return (
    <div className="space-y-8">
      <section className="accent-gradient -mx-4 -mt-6 rounded-none px-4 pb-8 pt-10 sm:-mx-6 sm:rounded-b-3xl sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
            WHRB 95.3 FM · Sales
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome, <span className="text-[hsl(var(--primary))]">{firstName}</span>
            <span className="text-[hsl(var(--muted-foreground))]">.</span>
          </h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{now}</p>
        </div>
      </section>

      <section
        data-testid="home-tiles"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {tiles.map(({ label, value, hint, href, testid }) => {
          const content = (
            <div
              data-testid={testid}
              className="group relative h-full overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
            >
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[hsl(var(--primary))] to-transparent opacity-40 transition-opacity group-hover:opacity-80"
              />
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                {label}
              </div>
              <div className="mt-3 font-semibold tabular-nums text-[hsl(var(--foreground))]">
                <span
                  className="text-3xl"
                  data-testid={`${testid}-value`}
                >
                  {value.toLocaleString()}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="inline-block h-1 w-1 rounded-full bg-[hsl(var(--muted-foreground))]/50" />
                {hint}
              </div>
            </div>
          );
          return href ? (
            <Link key={label} href={href} className="block">
              {content}
            </Link>
          ) : (
            <div key={label}>{content}</div>
          );
        })}
      </section>

      <section
        data-testid="recent-activity"
        className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent activity</h2>
          <span className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Last 10 notes · {TIMEZONE.split('/')[1].replace('_', ' ')}
          </span>
        </div>
        {activity.length === 0 ? (
          <p
            data-testid="recent-activity-empty"
            className="mt-4 text-sm text-[hsl(var(--muted-foreground))]"
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
                    className="font-medium text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] hover:underline"
                  >
                    {a.prospect?.company_name ?? 'Unknown prospect'}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-[hsl(var(--muted-foreground))]">
                    {a.body}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-[hsl(var(--muted-foreground))]">
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
          <span className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Last 25 items
          </span>
        </div>
        <FeedbackHistory rows={feedback} />
      </section>
    </div>
  );
}

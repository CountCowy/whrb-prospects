import Link from 'next/link';
import {
  ArrowUpRight,
  Building2,
  Mail,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  UserX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getHomeStats } from '@/lib/queries/prospects';
import { listRecentActivity } from '@/lib/queries/notes';
import { listMyFeedback } from '@/lib/queries/feedback';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { FeedbackHistory } from '@/components/FeedbackHistory';
import { formatInTz, formatRelative, TIMEZONE } from '@/lib/time';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Tile = {
  label: string;
  value: number;
  href?: string;
  hint: string;
  testid: string;
  icon: LucideIcon;
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
      icon: Building2,
    },
    {
      label: 'Tier A',
      value: stats.tierA,
      hint: 'Anchor sponsors',
      testid: 'tile-tier-a',
      href: '/prospects?tier=A',
      icon: Sparkles,
    },
    {
      label: 'Unassigned',
      value: stats.unassigned,
      hint: 'No rep yet',
      testid: 'tile-unassigned',
      href: '/prospects?assigned=false',
      icon: UserX,
    },
    {
      label: 'Nonprofit',
      value: stats.nonprofit,
      hint: 'IRS / manual tagged',
      testid: 'tile-nonprofit',
      href: '/prospects?is_nonprofit=true',
      icon: Target,
    },
    {
      label: 'Assigned to me',
      value: stats.myAssigned,
      hint: 'Your queue',
      testid: 'tile-my-assigned',
      href: '/my',
      icon: UserCheck,
    },
    {
      label: 'With email',
      value: stats.withEmail,
      hint: 'Company email on file',
      testid: 'tile-with-email',
      icon: Mail,
    },
    {
      label: 'Added this week',
      value: stats.recent7d,
      hint: 'Last 7 days',
      testid: 'tile-recent-7d',
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-10">
      <section className="accent-gradient relative -mx-4 -mt-6 overflow-hidden rounded-none border-b border-border-subtle px-4 pb-10 pt-12 sm:-mx-6 sm:rounded-b-3xl sm:border-x sm:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        />
        <div className="mx-auto max-w-7xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-primary shadow-sm">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            WHRB 95.3 FM · Sales
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Welcome, <span className="text-primary">{firstName}</span>
            <span className="text-muted-foreground">.</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">{now}</p>
        </div>
      </section>

      <section
        data-testid="home-tiles"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {tiles.map(({ label, value, hint, href, testid, icon: Icon }) => {
          const content = (
            <Card
              data-testid={testid}
              className={cn(
                'group relative h-full overflow-hidden rounded-xl border-border-subtle bg-card transition-all',
                href
                  ? 'shadow-sm hover:-translate-y-0.5 hover:border-[hsl(var(--primary-soft-border))] hover:shadow-lg'
                  : 'shadow-sm',
              )}
            >
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent opacity-40 transition-opacity group-hover:opacity-90"
              />
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary-soft))] text-primary">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </div>
                  {href ? (
                    <ArrowUpRight
                      className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-1.5 font-semibold tabular-nums text-foreground">
                    <span className="text-3xl" data-testid={`${testid}-value`}>
                      {value.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-block h-1 w-1 rounded-full bg-muted-foreground/50" />
                  {hint}
                </div>
              </CardContent>
            </Card>
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

      <Card
        data-testid="recent-activity"
        className="rounded-xl border-border-subtle shadow-sm"
      >
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">
              Recent activity
            </h2>
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Last 10 notes · {TIMEZONE.split('/')[1].replace('_', ' ')}
            </span>
          </div>
          {activity.length === 0 ? (
            <p
              data-testid="recent-activity-empty"
              className="mt-4 text-sm text-muted-foreground"
            >
              No notes yet — prospect notes land here as the team starts
              working rows.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border-subtle">
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
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {a.prospect?.company_name ?? 'Unknown prospect'}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {a.body}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    <div>
                      {a.author?.display_name ||
                        a.author?.email?.split('@')[0] ||
                        '—'}
                    </div>
                    <div className="tabular-nums">
                      {formatRelative(a.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <FeedbackWidget variant="inline" />

      <Card
        data-testid="feedback-history-section"
        className="rounded-xl border-border-subtle shadow-sm"
      >
        <CardContent className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">
              Your feedback
            </h2>
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Last 25 items
            </span>
          </div>
          <FeedbackHistory rows={feedback} />
        </CardContent>
      </Card>
    </div>
  );
}

import { MEDIA_KIT_PDF_FILENAME, MEDIA_KIT_STATS } from '@/config/rate-card';
import { Badge } from '@/components/ui/badge';

/**
 * Media-kit hero — title, year badge, listener-stats strip, and the
 * "Download print PDF" primary CTA.
 *
 * Stats are sourced from `MEDIA_KIT_STATS`; do not hard-code numbers in
 * this component.
 */
export function MediaKitHero() {
  return (
    <section
      data-testid="media-kit-hero"
      className="space-y-6 border-b border-[hsl(var(--border-subtle))] pb-8"
    >
      <div className="space-y-3">
        <Badge
          variant="outline"
          className="gap-2 rounded-full border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-[hsl(var(--primary))]"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
          WHRB 95.3 FM
        </Badge>
        <h1 className="text-[2rem] leading-[1.05] font-semibold tracking-[-0.02em] sm:text-[2.75rem]">
          Media Kit{' '}
          <span className="text-[hsl(var(--primary))]">2025</span>
        </h1>
        <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          Boston&apos;s Harvard-affiliated non-profit station — Classical,
          Jazz, Blues, Underground Rock, Sports, and signature seasonal
          programming. Sponsorship is FCC underwriting (brand association,
          not direct response).
        </p>
      </div>

      <dl
        data-testid="media-kit-stats"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <Stat
          label="FM listeners"
          value={MEDIA_KIT_STATS.fmListeners}
          testid="stat-listeners"
        />
        <Stat
          label="Monthly site visits"
          value={MEDIA_KIT_STATS.monthlySiteVisits}
          testid="stat-site-visits"
        />
        <Stat
          label="Quarterly guide subscribers"
          value={MEDIA_KIT_STATS.printGuideSubscribers}
          testid="stat-guide-subs"
        />
      </dl>

      <div>
        <a
          href={`/${MEDIA_KIT_PDF_FILENAME}`}
          download
          data-testid="media-kit-download"
          className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download print PDF
        </a>
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          Updated {MEDIA_KIT_STATS.lastUpdated}.
        </p>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  testid,
}: {
  label: string;
  value: string;
  testid: string;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] px-4 py-3"
    >
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

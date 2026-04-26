import Link from 'next/link';

// Stays dynamic — the parent (app) layout reads auth cookies; force-static
// here would disable that and route /guide back to /.
export const dynamic = 'force-dynamic';

/**
 * `/guide` — sales-rep onboarding. Body word target ~500 words; hard cap
 * 650. Hard-coded MDX-ish JSX; admin-editable CMS is out of scope per
 * epic plan §14 (deferred).
 *
 * The 10 sections match the plan §6.4 outline: What this app does, Tiers,
 * Tags, Preset filters, Advanced filters, Adding a prospect, Locking +
 * clearing tags, Terminology, FAQ, About.
 */
export default function GuidePage() {
  return (
    <article
      data-testid="guide-page"
      data-guide-version="t4"
      className="mx-auto max-w-3xl space-y-8 py-8"
    >
      <header>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Onboarding
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Sales rep guide
        </h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Read once on day one. Bookmark for the FAQ.
        </p>
      </header>

      <Section id="what-this-app-does" title="1. What this app does">
        <p>
          WHRB Prospects is the sales team&apos;s shared CRM and prospecting
          surface. It pulls Boston-area businesses from open data sources,
          deduplicates them, scores them against our ICP, and lets you
          claim, tag, and work each one to close.
        </p>
      </Section>

      <Section id="tiers" title="2. Tiers (price, not quality)">
        <p>
          <strong>A / B / C</strong> indicate the package range a prospect
          can usually afford, not their importance. A = $1,500–$3,000
          flights, B = $300–$1,500, C = $100–$500. Per-spot rates live on
          the{' '}
          <Link
            href="/media-kit"
            className="text-[hsl(var(--primary))] underline-offset-2 hover:underline"
          >
            Media Kit
          </Link>
          .
        </p>
      </Section>

      <Section id="tags" title="3. Tags (the real signal)">
        <p>
          Every prospect carries multi-axis tags. The eight axes are:
          sector, operating_model, genre, affiliation, cadence, daypart_fit,
          history, and compliance. Plus a free-form &ldquo;other&rdquo; axis
          for anything new. A Harvard chamber ensemble might be tagged
          <em> sector:arts</em>, <em>operating_model:ensemble</em>,{' '}
          <em>genre:classical</em>, <em>affiliation:harvard_affiliated</em>,{' '}
          <em>cadence:term_driven</em>.
        </p>
      </Section>

      <Section id="preset-filters" title="4. Preset filters">
        <p>
          Five named presets sit above the prospects table:{' '}
          <strong>Ready to call today</strong> (assigned to you, not
          contacted in 7 days), <strong>Classical anchors</strong> (Tier A +
          genre:classical), <strong>Harvard-adjacent</strong>{' '}
          (affiliation:harvard_affiliated or mit_affiliated),{' '}
          <strong>Prior clients gone quiet</strong> (state:previous_client +
          updated &gt; 90d), <strong>Seasonal — call this month</strong>{' '}
          (cadence matches the current month). Use these first.
        </p>
      </Section>

      <Section id="advanced-filters" title="5. Advanced filters">
        <p>
          Click <strong>Advanced</strong> on the filter bar to compose
          across axes. Multiple values within an axis combine as OR; values
          across axes combine as AND. On mobile, advanced is replaced with a
          flat tag-search; type the start of any tag value to add it.
        </p>
      </Section>

      <Section id="add-a-prospect" title="6. Adding a prospect">
        <p>
          Admin-only. Open <code>/prospects</code> and click{' '}
          <strong>+ Add prospect</strong>. The pipeline normally seeds new
          rows automatically; manual adds exist for the rare case where you
          spot a target the scrapers missed.
        </p>
      </Section>

      <Section id="lock-and-clear" title="7. Locking and clearing tags">
        <p>
          Click the X on any chip to clear it; a 30-second toast lets you
          undo. Click the padlock on a chip to lock it — the next pipeline
          run will leave it alone and not re-overwrite. Locks are per-tag
          and per-user. Compliance tags soft-clear so the audit trail
          stays intact; everything else hard-deletes.
        </p>
      </Section>

      <Section
        id="terminology"
        title="8. Terminology — say this, not that"
      >
        <p>
          We say <strong>advertiser</strong> or <strong>sponsor</strong> for
          the buyer; <strong>ads</strong> / <strong>advertising</strong>{' '}
          for the offering; <strong>spots</strong> (30s/60s) for the
          broadcast unit. We do <em>not</em> say &ldquo;underwriter&rdquo;
          (legal-only term) or use &ldquo;daypart&rdquo; in rep-facing copy
          — reference programs directly (Classical, Jazz, Blues, Hillbilly
          at Harvard, Met Opera, etc.).
        </p>
      </Section>

      <Section id="seasonal-programs" title="9. FAQ">
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold">
              Why did my tag suddenly go yellow?
            </dt>
            <dd className="text-[hsl(var(--muted-foreground))]">
              You added a vocab value that didn&apos;t exist yet. An admin
              has been notified to approve, reject, or merge it.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">
              Why isn&apos;t my preset matching anything?
            </dt>
            <dd className="text-[hsl(var(--muted-foreground))]">
              Most likely the dataset hasn&apos;t been re-run since the
              relevant tag landed. Check{' '}
              <Link
                href="/admin/runs"
                className="text-[hsl(var(--primary))] underline-offset-2 hover:underline"
              >
                /admin/runs
              </Link>{' '}
              for the last successful run.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">What happens when I unlock a tag?</dt>
            <dd className="text-[hsl(var(--muted-foreground))]">
              Nothing immediate. The next pipeline run is allowed to
              overwrite or remove it.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">
              What about Met Opera, Hillbilly Intermissions, SNATO, Orgy
              Season?
            </dt>
            <dd className="text-[hsl(var(--muted-foreground))]">
              Seasonal premium spots. The Met runs December through May;
              Hillbilly intermissions run year-round; SNATO is Sunday
              evening; &ldquo;Orgy Season&rdquo; is reading + exam period
              themed marathons (Dec, May). All sell at premium rates and
              fill fast.
            </dd>
          </div>
        </dl>
      </Section>

      <Section id="about" title="10. About">
        <p>
          WHRB Prospects is the sales team&apos;s prospecting and CRM app
          for WHRB 95.3 FM. Developed by Yareh Constant. See the{' '}
          <Link
            href="/changelog"
            className="text-[hsl(var(--primary))] underline-offset-2 hover:underline"
          >
            changelog
          </Link>{' '}
          for what&apos;s new and the{' '}
          <Link
            href="/media-kit"
            className="text-[hsl(var(--primary))] underline-offset-2 hover:underline"
          >
            media kit
          </Link>{' '}
          for the full rate card and audience profile.
        </p>
      </Section>
    </article>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid="guide-section"
      data-section-id={id}
      aria-labelledby={`${id}-heading`}
      className="space-y-2"
    >
      <h2
        id={`${id}-heading`}
        className="text-lg font-semibold tracking-tight"
      >
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

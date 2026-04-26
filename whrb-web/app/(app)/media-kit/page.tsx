import Link from 'next/link';
import { Suspense } from 'react';
import { MediaKitHero } from '@/components/MediaKitHero';
import { RateCard } from '@/components/RateCard';
import { SignalMap } from '@/components/SignalMap';
import { FeaturedClients } from '@/components/FeaturedClients';
import { PROGRAM_CARDS } from '@/config/rate-card';

// Stays dynamic — the parent (app) layout reads auth cookies; force-static
// here would disable that and route /media-kit back to /.
export const dynamic = 'force-dynamic';

export default function MediaKitPage() {
  return (
    <div
      className="mx-auto max-w-4xl space-y-12 py-8"
      data-testid="media-kit-page"
    >
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-[hsl(var(--muted-foreground))]"
      >
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Media Kit</span>
      </nav>

      {/* Section 1: Hero */}
      <MediaKitHero />

      {/* Section 2: About WHRB */}
      <section
        data-testid="about-whrb"
        aria-labelledby="about-whrb-heading"
        className="space-y-4"
      >
        <h2
          id="about-whrb-heading"
          className="text-xl font-semibold tracking-tight"
        >
          About WHRB
        </h2>
        <div className="space-y-3 text-sm leading-relaxed text-foreground">
          <p>
            WHRB 95.3 FM is the Harvard Radio Broadcasting Company — a
            Harvard-affiliated, FCC-licensed non-commercial educational
            station broadcasting at ~3,000 W from Cambridge with strong
            signal across Cambridge, Boston, Brookline, Somerville, and the
            inner-ring suburbs. The station streams globally at{' '}
            <a
              href="https://whrb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[hsl(var(--primary))] underline underline-offset-2 hover:decoration-2"
            >
              whrb.org
            </a>
            .
          </p>
          <p>
            WHRB is one of the few non-commercial U.S. stations carrying a
            full Classical daypart alongside Jazz, Blues, Underground Rock,
            Met Opera broadcasts, the Sudbury Savoyards, Hillbilly at
            Harvard, Sports, and signature seasonal &ldquo;Orgy&rdquo;
            marathons during Harvard reading and exam periods. Listeners
            skew educated, affluent, donor-class, and culturally engaged.
          </p>
          <blockquote className="border-l-2 border-[hsl(var(--primary))] pl-4 italic text-[hsl(var(--muted-foreground))]">
            &ldquo;WHRB has been my classical companion for thirty years.
            There&apos;s nothing like it on the dial.&rdquo;
          </blockquote>
        </div>
      </section>

      {/* Section 3: Programs */}
      <section
        data-testid="programs"
        aria-labelledby="programs-heading"
        className="space-y-4"
      >
        <h2
          id="programs-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Programs
        </h2>
        <div
          data-testid="programs-grid"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {PROGRAM_CARDS.map((program) => (
            <article
              key={program.title}
              data-testid="program-card"
              data-title={program.title}
              className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4 text-sm transition-shadow hover:shadow-[var(--shadow-md)]"
            >
              <h3 className="font-semibold">{program.title}</h3>
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                {program.airtimes}
              </p>
              <p className="mt-2 text-[hsl(var(--muted-foreground))]">
                {program.blurb}
              </p>
              <Link
                href={program.href}
                className="mt-3 inline-block text-[hsl(var(--primary))] underline-offset-2 hover:underline"
              >
                See matching prospects &rarr;
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* Section 4: Rate card */}
      <RateCard />

      {/* Section 5: Signal area */}
      <SignalMap />

      {/* Section 6: Featured clients */}
      <Suspense
        fallback={
          <div
            className="h-32 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 text-sm text-[hsl(var(--muted-foreground))]"
            data-testid="featured-clients-loading"
          >
            Loading featured clients...
          </div>
        }
      >
        <FeaturedClients />
      </Suspense>

      {/* Section 7: Contact */}
      <section
        data-testid="media-kit-contact"
        aria-labelledby="contact-heading"
        className="space-y-4 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6"
      >
        <h2
          id="contact-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Contact
        </h2>
        <address className="not-italic text-sm">
          <div className="font-medium">WHRB 95.3 FM</div>
          <div className="text-[hsl(var(--muted-foreground))]">
            Harvard Radio Broadcasting Co., Inc.
          </div>
          <div className="text-[hsl(var(--muted-foreground))]">
            389 Harvard Street · Cambridge, MA 02138
          </div>
          <div className="mt-2">
            <a
              href="mailto:sales@whrb.org"
              className="font-medium text-[hsl(var(--primary))] underline-offset-2 hover:underline"
              data-testid="contact-email"
            >
              sales@whrb.org
            </a>
          </div>
        </address>
      </section>
    </div>
  );
}

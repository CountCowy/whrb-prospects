import Link from 'next/link';

// Stays dynamic — the parent (app) layout reads auth cookies; force-static
// here would disable that and route /media-kit back to /.
export const dynamic = 'force-dynamic';

// The PDF filename is intentionally hard-coded as a sibling of `/public/`.
// On the annual swap, rename the file in `whrb-web/public/` and update this
// constant in the same PR. T4 will move this to a shared rate-card config.
const MEDIA_KIT_PDF_FILENAME = '/media-kit-2026.pdf';

export default function MediaKitPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8" data-testid="media-kit-page">
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
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Sales collateral
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          WHRB 95.3 FM — 2026 Media Kit
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          The print media kit covers WHRB&apos;s audience profile, signal area,
          rate card, and the FCC underwriting framework that shapes how
          sponsors can be acknowledged on-air.
        </p>
      </div>
      <a
        href={MEDIA_KIT_PDF_FILENAME}
        download
        className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90"
        data-testid="media-kit-download"
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
      <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Content coming in T4 — interactive rate-card view, audience-by-daypart
          breakdown, and program-spotlight callouts. The print PDF above is the
          authoritative source today.
        </p>
      </div>
    </div>
  );
}

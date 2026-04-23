// Stays dynamic — the parent (app) layout reads auth cookies; force-static
// here would disable that and route /guide back to /.
export const dynamic = 'force-dynamic';

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8" data-testid="guide-page">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Onboarding
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Sales rep guide
        </h1>
      </div>
      <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Coming soon. Content lands in stage T4 once the rep-facing tag UI
          (chips, filters, lock, clear) is live to document.
        </p>
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
          For tag management today, see{' '}
          <a
            href="/admin/vocab"
            className="text-[hsl(var(--primary))] underline-offset-2 hover:underline"
          >
            /admin/vocab
          </a>{' '}
          (admin-only).
        </p>
      </div>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TagChip } from '@/components/TagChip';
import { AXES, type Axis } from '@/styles/tag-colors';

export const dynamic = 'force-dynamic';

const FAKE_PROSPECT_ID = '00000000-0000-0000-0000-000000000000';
const FAKE_TAG_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_USER = '00000000-0000-0000-0000-000000000002';

/**
 * Dev-only chip palette gallery (Stage T3, plan §5.4).
 *
 * Renders one chip per axis × four states (default / pending /
 * locked / interactive) so designers can review WCAG contrast and
 * colorblind safety in light + dark themes. The route is gated
 * NODE_ENV !== 'production' AND admin role; in prod it 404s.
 *
 * The chips here use the same `TagChip` component the rest of the
 * app uses, so a regression in `tag-colors.ts` shows up immediately.
 */
export default async function AdminPalettePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  // Admin gating is inherited from app/(app)/admin/layout.tsx.

  return (
    // Inner TooltipProvider tightens the delay from the root layout's
    // 200 ms to 150 ms so designers can hover-scan chips faster while
    // reviewing the palette gallery. The root provider is left intact
    // for the rest of the app.
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6" data-testid="admin-palette">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Dev tooling
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Tag chip palette
          </h1>
          <p className="mt-1 max-w-prose text-sm text-[hsl(var(--muted-foreground))]">
            One chip per axis × state. Toggle the theme via Command
            Palette (⌘K) → Theme to verify both light and dark. Run
            Deuteranopia / Protanopia / Tritanopia simulation against
            this page when changing <code>styles/tag-colors.ts</code>.
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Default chips</h2>
          <div className="flex flex-wrap gap-2 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4">
            {AXES.map((axis) => (
              <ChipDemo key={axis} axis={axis} status="active" lockedBy={null} interactive={false} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Pending admin review</h2>
          <div className="flex flex-wrap gap-2 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4">
            {AXES.map((axis) => (
              <ChipDemo key={axis} axis={axis} status="pending_admin_review" lockedBy={null} interactive={false} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Locked</h2>
          <div className="flex flex-wrap gap-2 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4">
            {AXES.map((axis) => (
              <ChipDemo key={axis} axis={axis} status="active" lockedBy={FAKE_USER} interactive={false} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Interactive (clear + lock toggle)</h2>
          <div className="flex flex-wrap gap-2 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4">
            {AXES.map((axis) => (
              <ChipDemo key={axis} axis={axis} status="active" lockedBy={null} interactive />
            ))}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}

function ChipDemo({
  axis,
  status,
  lockedBy,
  interactive,
}: {
  axis: Axis;
  status: 'active' | 'pending_admin_review';
  lockedBy: string | null;
  interactive: boolean;
}) {
  return (
    <TagChip
      tagRowId={`${FAKE_PROSPECT_ID}-${axis}`}
      tagId={FAKE_TAG_ID}
      prospectId={FAKE_PROSPECT_ID}
      axis={axis}
      value={`${axis}_demo`}
      status={status}
      lockedBy={lockedBy}
      currentUserId={FAKE_USER}
      isAdmin
      interactive={interactive}
    />
  );
}

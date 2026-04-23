import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Tier chips render the full-saturation tier colour as text on a
// translucent tier-tinted bg (see --tier-*-bg / --tier-*-border in
// globals.css). Shadcn Badge's `variant="outline"` already provides the
// pill geometry and border structure; we override the color channels
// via className so each tier picks up its own --tier-* tokens.
const TONE: Record<string, string> = {
  A: 'border-[hsl(var(--tier-a)/0.3)] bg-[hsl(var(--tier-a)/0.12)] text-[hsl(var(--tier-a))]',
  B: 'border-[hsl(var(--tier-b)/0.3)] bg-[hsl(var(--tier-b)/0.12)] text-[hsl(var(--tier-b))]',
  C: 'border-[hsl(var(--tier-c)/0.3)] bg-[hsl(var(--tier-c)/0.1)] text-[hsl(var(--tier-c))]',
};

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const t = tier ?? '—';
  const tone =
    TONE[t] ?? 'border-border bg-muted text-muted-foreground';
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2 py-[2px] text-[11px] font-semibold uppercase tracking-wider',
        tone,
      )}
    >
      {t}
    </Badge>
  );
}

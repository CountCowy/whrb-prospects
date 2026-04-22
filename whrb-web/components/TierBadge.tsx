import { cn } from '@/lib/utils';

const TONE: Record<string, string> = {
  A: 'bg-[hsl(var(--tier-a)/0.15)] text-[hsl(var(--tier-a))] border-[hsl(var(--tier-a)/0.3)]',
  B: 'bg-[hsl(var(--tier-b)/0.15)] text-[hsl(var(--tier-b))] border-[hsl(var(--tier-b)/0.3)]',
  C: 'bg-[hsl(var(--tier-c)/0.15)] text-[hsl(var(--tier-c))] border-[hsl(var(--tier-c)/0.3)]',
};

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const t = tier ?? '—';
  const tone =
    TONE[t] ??
    'bg-muted text-muted-foreground border-border';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-[2px] text-[11px] font-semibold uppercase tracking-wider',
        tone,
      )}
    >
      {t}
    </span>
  );
}

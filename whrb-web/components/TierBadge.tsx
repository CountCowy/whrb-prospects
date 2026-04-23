import { Badge, type BadgeProps } from '@/components/ui/Badge';

const TIER_TONE: Record<string, BadgeProps['tone']> = {
  A: 'tierA',
  B: 'tierB',
  C: 'tierC',
};

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const t = tier ?? '—';
  const tone = TIER_TONE[t] ?? 'neutral';
  return (
    <Badge tone={tone} emphasis="strong">
      {t}
    </Badge>
  );
}

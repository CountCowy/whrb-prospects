import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral:
          'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
        primary:
          'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] border-[hsl(var(--primary-soft-border))]',
        tierA:
          'bg-[hsl(var(--tier-a-bg))] text-[hsl(var(--tier-a))] border-[hsl(var(--tier-a-border))]',
        tierB:
          'bg-[hsl(var(--tier-b-bg))] text-[hsl(var(--tier-b))] border-[hsl(var(--tier-b-border))]',
        tierC:
          'bg-[hsl(var(--tier-c-bg))] text-[hsl(var(--tier-c))] border-[hsl(var(--tier-c-border))]',
        stateResearching:
          'bg-[hsl(var(--state-researching-bg))] text-[hsl(var(--state-researching))] border-[hsl(var(--state-researching-border))]',
        stateWaiting:
          'bg-[hsl(var(--state-waiting-bg))] text-[hsl(var(--state-waiting))] border-[hsl(var(--state-waiting-border))]',
        stateInitial:
          'bg-[hsl(var(--state-initial-bg))] text-[hsl(var(--state-initial))] border-[hsl(var(--state-initial-border))]',
        stateOngoing:
          'bg-[hsl(var(--state-ongoing-bg))] text-[hsl(var(--state-ongoing))] border-[hsl(var(--state-ongoing-border))]',
        stateSold:
          'bg-[hsl(var(--state-sold-bg))] text-[hsl(var(--state-sold))] border-[hsl(var(--state-sold-border))]',
        statePrevious:
          'bg-[hsl(var(--state-previous-client-bg))] text-[hsl(var(--state-previous-client))] border-[hsl(var(--state-previous-client-border))]',
        stateDead:
          'bg-[hsl(var(--state-dead-bg))] text-[hsl(var(--state-dead))] border-[hsl(var(--state-dead-border))]',
      },
      emphasis: {
        default: '',
        strong: 'font-semibold uppercase tracking-wider',
      },
    },
    defaultVariants: { tone: 'neutral', emphasis: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, emphasis, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, emphasis }), className)} {...props} />;
}

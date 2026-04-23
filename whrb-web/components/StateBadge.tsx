import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Canonical pipeline states (matches 000_init.sql check constraint):
//   researching → waiting_response → initial_contact → ongoing_contact →
//   sold → previous_client → dead
//
// Chip colours source from --state-*-bg / --state-*-border / --state-*
// CSS vars (defined in app/globals.css). Text = full-sat --state-*;
// background = ~10-14% translucent; border = ~24-32% translucent.
const TONE: Record<string, string> = {
  researching:
    'border-[hsl(var(--state-researching-border))] bg-[hsl(var(--state-researching-bg))] text-[hsl(var(--state-researching))]',
  waiting_response:
    'border-[hsl(var(--state-waiting-border))] bg-[hsl(var(--state-waiting-bg))] text-[hsl(var(--state-waiting))]',
  initial_contact:
    'border-[hsl(var(--state-initial-border))] bg-[hsl(var(--state-initial-bg))] text-[hsl(var(--state-initial))]',
  ongoing_contact:
    'border-[hsl(var(--state-ongoing-border))] bg-[hsl(var(--state-ongoing-bg))] text-[hsl(var(--state-ongoing))]',
  sold: 'border-[hsl(var(--state-sold-border))] bg-[hsl(var(--state-sold-bg))] text-[hsl(var(--state-sold))]',
  previous_client:
    'border-[hsl(var(--state-previous-client-border))] bg-[hsl(var(--state-previous-client-bg))] text-[hsl(var(--state-previous-client))]',
  dead: 'border-[hsl(var(--state-dead-border))] bg-[hsl(var(--state-dead-bg))] text-[hsl(var(--state-dead))]',
};

const LABEL: Record<string, string> = {
  researching: 'Researching',
  waiting_response: 'Waiting response',
  initial_contact: 'Initial contact',
  ongoing_contact: 'Ongoing contact',
  sold: 'Sold',
  previous_client: 'Previous client',
  dead: 'Dead',
};

export const STATE_ORDER: readonly string[] = [
  'researching',
  'waiting_response',
  'initial_contact',
  'ongoing_contact',
  'sold',
  'previous_client',
  'dead',
];

export function StateBadge({ state }: { state: string | null | undefined }) {
  const s = state ?? 'researching';
  return (
    <Badge
      data-testid="state-badge"
      variant="outline"
      className={cn(
        'rounded-full px-2 py-[2px] text-[11px] font-medium',
        TONE[s] ?? TONE.researching,
      )}
    >
      {LABEL[s] ?? s}
    </Badge>
  );
}

import { Badge, type BadgeProps } from '@/components/ui/Badge';

// Canonical pipeline states (matches 000_init.sql check constraint):
//   researching → waiting_response → initial_contact → ongoing_contact →
//   sold → previous_client → dead
const STATE_TONE: Record<string, BadgeProps['tone']> = {
  researching: 'stateResearching',
  waiting_response: 'stateWaiting',
  initial_contact: 'stateInitial',
  ongoing_contact: 'stateOngoing',
  sold: 'stateSold',
  previous_client: 'statePrevious',
  dead: 'stateDead',
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
  const tone = STATE_TONE[s] ?? 'stateResearching';
  return (
    <Badge data-testid="state-badge" tone={tone}>
      {LABEL[s] ?? s}
    </Badge>
  );
}

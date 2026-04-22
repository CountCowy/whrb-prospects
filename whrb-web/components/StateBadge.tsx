import { cn } from '@/lib/utils';

// Canonical pipeline states (matches 000_init.sql check constraint):
//   researching → waiting_response → initial_contact → ongoing_contact →
//   sold → previous_client → dead
const TONE: Record<string, string> = {
  researching:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  waiting_response:
    'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-700',
  initial_contact:
    'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700',
  ongoing_contact:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700',
  sold: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700',
  previous_client:
    'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/40 dark:text-teal-200 dark:border-teal-700',
  dead: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700',
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
    <span
      data-testid="state-badge"
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-[2px] text-[11px] font-medium',
        TONE[s] ?? TONE.researching,
      )}
    >
      {LABEL[s] ?? s}
    </span>
  );
}

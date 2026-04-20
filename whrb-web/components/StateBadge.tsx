const TONE: Record<string, string> = {
  researching: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  initial_contact: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700',
  pitched: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700',
  waiting: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-700',
  sold: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700',
  dead: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700',
  not_a_fit: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700',
};

const LABEL: Record<string, string> = {
  researching: 'Researching',
  initial_contact: 'Initial contact',
  pitched: 'Pitched',
  waiting: 'Waiting',
  sold: 'Sold',
  dead: 'Dead',
  not_a_fit: 'Not a fit',
};

export function StateBadge({ state }: { state: string | null | undefined }) {
  const s = state ?? 'researching';
  return (
    <span
      data-testid="state-badge"
      className={`inline-flex items-center rounded-full border px-2 py-[2px] text-[11px] font-medium ${TONE[s] ?? TONE.researching}`}
    >
      {LABEL[s] ?? s}
    </span>
  );
}

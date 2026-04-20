import { formatDate } from '@/lib/time';
import type { FeedbackRow } from '@/lib/queries/feedback';

const STATUS_LABEL: Record<FeedbackRow['status'], string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  in_progress: 'In progress',
  closed: 'Closed',
};

const STATUS_TONE: Record<FeedbackRow['status'], string> = {
  new: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  acknowledged: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
};

export function FeedbackHistory({ rows }: { rows: FeedbackRow[] }) {
  if (rows.length === 0) {
    return (
      <div data-testid="feedback-history-empty" className="text-sm text-[hsl(var(--muted-foreground))]">
        You haven&apos;t sent any feedback yet.
      </div>
    );
  }
  return (
    <ul data-testid="feedback-history" className="space-y-3">
      {rows.map((f) => (
        <li
          key={f.id}
          data-testid="feedback-history-item"
          data-status={f.status}
          className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                {f.category.replace('_', ' ')}
              </span>
              <span className={`rounded-full px-2 py-[2px] text-[10px] font-medium ${STATUS_TONE[f.status]}`}>
                {STATUS_LABEL[f.status]}
              </span>
            </div>
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {formatDate(f.created_at)}
            </span>
          </div>
          <p className="mt-2 text-sm">{f.body}</p>
          {f.admin_response && (
            <div className="mt-2 rounded-md border-l-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary-soft))] p-2 text-xs text-[hsl(var(--foreground))]">
              <span className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
                Admin
              </span>
              <p className="mt-1">{f.admin_response}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

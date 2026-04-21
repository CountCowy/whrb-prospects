'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { AdminFeedbackRow } from '@/lib/queries/admin';
import { formatDateTime } from '@/lib/time';

const STATUSES: Array<AdminFeedbackRow['status']> = [
  'new',
  'acknowledged',
  'in_progress',
  'closed',
];

const STATUS_TONE: Record<string, string> = {
  new: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  acknowledged: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
};

export function FeedbackTriageList({ rows }: { rows: AdminFeedbackRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftById, setDraftById] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, r.admin_response ?? ''])),
  );

  async function changeStatus(id: string, status: AdminFeedbackRow['status']) {
    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }));
      toast.error(`Status change failed: ${body.error ?? res.statusText}`);
      return;
    }
    toast.success(`Status → ${status}`);
    startTransition(() => router.refresh());
  }

  async function saveResponse(id: string) {
    const body = draftById[id] ?? '';
    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_response: body.trim() || null }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'unknown' }));
      toast.error(`Save failed: ${err.error ?? res.statusText}`);
      return;
    }
    toast.success('Response saved');
    startTransition(() => router.refresh());
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="feedback-empty"
        className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-10 text-center text-sm text-[hsl(var(--muted-foreground))]"
      >
        No feedback submitted yet.
      </div>
    );
  }

  return (
    <ul data-testid="feedback-triage" className="space-y-3">
      {rows.map((r) => (
        <li
          key={r.id}
          data-testid="feedback-row"
          data-feedback-id={r.id}
          data-status={r.status}
          className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              {r.category.replace('_', ' ')}
            </span>
            <span
              className={`rounded-full px-2 py-[2px] text-[10px] font-medium ${STATUS_TONE[r.status]}`}
              data-testid={`feedback-status-${r.id}`}
            >
              {r.status}
            </span>
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {r.author_email ?? '(deleted user)'}
            </span>
            <span className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))]">
              {formatDateTime(r.created_at)}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm">{r.body}</p>
          {r.page_url && (
            <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              on{' '}
              <a
                href={r.page_url}
                className="underline hover:text-[hsl(var(--foreground))]"
                target="_blank"
                rel="noreferrer"
              >
                {r.page_url}
              </a>
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium">
              Status
              <select
                data-testid={`feedback-status-select-${r.id}`}
                value={r.status}
                disabled={pending}
                onChange={(e) =>
                  changeStatus(r.id, e.target.value as AdminFeedbackRow['status'])
                }
                className="ml-2 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 space-y-2">
            <label
              htmlFor={`resp-${r.id}`}
              className="text-xs font-medium text-[hsl(var(--muted-foreground))]"
            >
              Admin response (visible to the user on Home)
            </label>
            <textarea
              id={`resp-${r.id}`}
              data-testid={`feedback-response-${r.id}`}
              value={draftById[r.id] ?? ''}
              maxLength={2000}
              rows={2}
              onChange={(e) =>
                setDraftById((prev) => ({ ...prev, [r.id]: e.target.value }))
              }
              className="block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
            <div className="flex justify-end">
              <button
                type="button"
                data-testid={`feedback-save-${r.id}`}
                disabled={pending}
                onClick={() => saveResponse(r.id)}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-60"
              >
                Save response
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

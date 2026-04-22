'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

type Prefs = {
  notify_assignment_toast: boolean;
  notify_assignment_email: boolean;
  notify_mention_toast: boolean;
  notify_mention_email: boolean;
  notify_run_complete_email: boolean;
  notify_feedback_status_email: boolean;
};

type Section = {
  title: string;
  description: string;
  rows: Array<{ key: keyof Prefs; label: string; kind: 'toast' | 'email' }>;
};

const SECTIONS: Section[] = [
  {
    title: 'Assignments',
    description:
      'When someone assigns a prospect to you, or hands one off — includes self pick-ups.',
    rows: [
      { key: 'notify_assignment_toast', label: 'In-app toast', kind: 'toast' },
      { key: 'notify_assignment_email', label: 'Email', kind: 'email' },
    ],
  },
  {
    title: 'Note mentions',
    description: 'When a teammate writes @you-prefix in a note body.',
    rows: [
      { key: 'notify_mention_toast', label: 'In-app toast', kind: 'toast' },
      { key: 'notify_mention_email', label: 'Email', kind: 'email' },
    ],
  },
  {
    title: 'Pipeline run complete',
    description:
      'When a pipeline run finishes (scheduled or manually triggered). Admin-only; reps see run activity on the admin console if they have access.',
    rows: [{ key: 'notify_run_complete_email', label: 'Email', kind: 'email' }],
  },
  {
    title: 'Feedback status updates',
    description:
      'When an admin responds to or changes the status on feedback you submitted.',
    rows: [{ key: 'notify_feedback_status_email', label: 'Email', kind: 'email' }],
  },
];

export function NotificationPreferencesForm({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [pending, startTransition] = useTransition();

  async function save(patch: Partial<Prefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    startTransition(async () => {
      const res = await fetch('/api/user-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setPrefs((p) => ({ ...p, ...initial }));
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Failed to save preference.');
        return;
      }
      toast.success('Saved.');
    });
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => (
        <section
          key={section.title}
          className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-sm"
        >
          <div>
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {section.description}
            </p>
          </div>
          <div className="mt-4 space-y-3">
            {section.rows.map((row) => (
              <label
                key={row.key}
                className="flex items-center justify-between gap-4"
                data-testid={`pref-${row.key}`}
              >
                <span className="text-sm text-[hsl(var(--foreground))]">{row.label}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 cursor-pointer rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]"
                  checked={prefs[row.key]}
                  disabled={pending}
                  onChange={(e) => save({ [row.key]: e.target.checked } as Partial<Prefs>)}
                />
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

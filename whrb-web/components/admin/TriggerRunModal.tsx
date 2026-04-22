'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

// Stage 10c: tightly-scoped argv whitelist (server also validates).
const FLAGS = [
  { value: '--dry', label: '--dry', desc: '5-row smoke; skips expensive enrichment.' },
  { value: '--with-hic', label: '--with-hic', desc: 'Include MA Home Improvement Contractors.' },
  { value: '--with-bbb', label: '--with-bbb', desc: 'Include BBB (Playwright; flaky).' },
  { value: '--fresh', label: '--fresh', desc: 'Clear phase / source checkpoints.' },
  { value: '--no-supabase', label: '--no-supabase', desc: 'Skip 08_supabase_sync phase.' },
] as const;

type FlagValue = (typeof FLAGS)[number]['value'];

export function TriggerRunModal() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<FlagValue>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const argvPreview = useMemo(() => {
    const picked = FLAGS.filter((f) => selected.has(f.value)).map((f) => f.value);
    return picked.join(' ');
  }, [selected]);

  function toggle(v: FlagValue) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(argvPreview ? { args: argvPreview } : {}),
      });
      if (!res.ok) {
        const msg = await res.text();
        toast.error(`Trigger failed: ${msg || res.statusText}`);
        return;
      }
      const { pipeline_run_id } = (await res.json()) as {
        pipeline_run_id: string;
      };
      toast.success(`Queued run ${pipeline_run_id.slice(0, 8)}${argvPreview ? ` (${argvPreview})` : ''}`);
      setOpen(false);
      setSelected(new Set());
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(`Trigger failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="trigger-run-button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Trigger new run
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            data-testid="trigger-run-modal"
          >
            <h2 className="text-lg font-semibold">Trigger pipeline run</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Pick the flags the worker should pass to <code className="font-mono text-xs">pipeline.py</code>. Unknown tokens are rejected server-side.
            </p>

            <div className="mt-4 space-y-2">
              {FLAGS.map((f) => {
                const on = selected.has(f.value);
                return (
                  <label
                    key={f.value}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] p-3 transition-colors hover:bg-[hsl(var(--muted))]"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(f.value)}
                      data-testid={`trigger-run-flag-${f.value.replace(/^--/, '')}`}
                      className="mt-0.5 h-4 w-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                    />
                    <span>
                      <span className="block font-mono text-sm">{f.label}</span>
                      <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                        {f.desc}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 rounded-md bg-[hsl(var(--muted))] px-3 py-2 font-mono text-xs">
              <span className="text-[hsl(var(--muted-foreground))]">argv:</span>{' '}
              <span data-testid="trigger-run-argv">
                {argvPreview || <span className="italic opacity-60">(none — legacy behaviour)</span>}
              </span>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                data-testid="trigger-run-cancel"
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                data-testid="trigger-run-submit"
                className="rounded-md bg-[hsl(var(--primary))] px-4 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? 'Queuing…' : 'Start run'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

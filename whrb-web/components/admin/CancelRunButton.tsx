'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function CancelRunButton({
  runId,
  status,
}: {
  runId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (status !== 'queued' && status !== 'running') return null;

  async function submit() {
    if (confirm !== 'CANCEL') {
      toast.error('Type CANCEL to confirm.');
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/pipeline/run/${runId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? `Cancel failed (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { ok: boolean; mode?: string };
      toast.success(`Run cancelled (${body.mode ?? 'ok'})`);
      setOpen(false);
      setConfirm('');
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(`Cancel failed: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid={`cancel-run-button-${runId}`}
        onClick={() => setOpen(true)}
        className="rounded-md border border-[hsl(var(--destructive))] px-2 py-1 text-xs font-medium text-[hsl(var(--destructive))] transition-colors hover:bg-[hsl(var(--destructive))]/10"
      >
        Cancel
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            data-testid={`cancel-run-modal-${runId}`}
          >
            <h2 className="text-lg font-semibold">
              Cancel pipeline run {runId.slice(0, 8)}?
            </h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Current status: <span className="font-mono text-xs">{status}</span>. Cancelling a
              running workflow issues a cancel request to GitHub Actions; queued rows are flipped
              to failed before the worker picks them up.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Type <span className="font-mono text-[hsl(var(--destructive))]">CANCEL</span> to confirm
              </label>
              <input
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-testid={`cancel-run-confirm-${runId}`}
                placeholder="CANCEL"
                className="mt-1 w-full rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--background))] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--destructive))]/60"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || confirm !== 'CANCEL'}
                data-testid={`cancel-run-submit-${runId}`}
                className="rounded-md bg-[hsl(var(--destructive))] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {pending ? 'Cancelling…' : 'Cancel run'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

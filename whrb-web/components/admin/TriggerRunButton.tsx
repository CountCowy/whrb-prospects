'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function TriggerRunButton() {
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function onClick() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const msg = await res.text();
        toast.error(`Trigger failed: ${msg || res.statusText}`);
        return;
      }
      const { pipeline_run_id } = (await res.json()) as {
        pipeline_run_id: string;
      };
      toast.success(`Queued run ${pipeline_run_id.slice(0, 8)}`);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(`Trigger failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="trigger-run-button"
      onClick={onClick}
      disabled={submitting}
      className="rounded-lg border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? 'Queuing…' : 'Trigger new run'}
    </button>
  );
}

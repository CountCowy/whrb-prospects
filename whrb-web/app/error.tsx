'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { logClient } from '@/lib/logging/client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Dual sink: Supabase event_log (audit trail) + Sentry (stack-grouped
    // alerting). React render errors don't bubble to `window.error`, so the
    // explicit captureException is required — Sentry's auto-instrumentation
    // can't see this code path.
    Sentry.captureException(error, { tags: { category: 'ui_exception' } });
    void logClient({
      level: 'error',
      category: 'ui_exception',
      message: error.message,
      context: { stack: error.stack, digest: error.digest },
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm text-[hsl(var(--primary-foreground))] hover:opacity-90"
      >
        Retry
      </button>
    </div>
  );
}

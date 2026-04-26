'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

/**
 * First-login changelog toast — fires once per `last_changelog_ack` reset.
 *
 * Server-side rendering of `app/(app)/layout.tsx` resolves whether there's
 * a pending entry the current user hasn't ack'd; if so, it passes
 * `pendingEntry` and we fire a Sonner toast on mount. Click or dismiss
 * both POST to `/api/changelog/ack` to bump `profiles.last_changelog_ack`
 * to now() — the same toast won't fire again in this session or after a
 * reload until a newer entry lands.
 *
 * Fires at most once per page load via a ref guard so React strict-mode
 * double-renders don't double-toast.
 */
export function ChangelogToast({
  pendingEntry,
}: {
  pendingEntry: {
    slug: string;
    title: string;
    released_at: string;
  } | null;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (!pendingEntry) return;
    if (fired.current) return;
    fired.current = true;

    const ack = () => {
      fetch('/api/changelog/ack', { method: 'POST' }).catch(() => {});
    };

    // Defer the toast call by one frame so the parent <Toaster /> has
    // a chance to subscribe before we enqueue. Without this, the toast
    // queue can race the Toaster mount in React 18 strict-mode dev and
    // the toast is silently dropped.
    const t = window.requestAnimationFrame(() => {
      const id = toast(
        <div data-testid="changelog-toast" className="space-y-1">
          <div className="font-medium">What&apos;s new</div>
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            {pendingEntry.title}
          </div>
          <div className="pt-1">
            <Link
              href="/changelog"
              data-testid="changelog-toast-link"
              onClick={() => {
                ack();
                toast.dismiss(id);
              }}
              className="text-xs font-medium underline underline-offset-2"
            >
              See changelog &rarr;
            </Link>
          </div>
        </div>,
        {
          duration: 8000,
          onDismiss: ack,
          onAutoClose: ack,
        },
      );
    });
    return () => window.cancelAnimationFrame(t);
  }, [pendingEntry]);

  // Expose the SSR-derived pending state to the e2e harness via a
  // zero-pixel marker. Pure debug — never displayed.
  return (
    <span
      data-testid="changelog-toast-marker"
      data-pending={pendingEntry ? 'true' : 'false'}
      data-slug={pendingEntry?.slug ?? ''}
      style={{ display: 'none' }}
      aria-hidden="true"
    />
  );
}

'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Top-level App Router error boundary.
 *
 * `app/error.tsx` catches errors thrown inside the route segment but not
 * those thrown by the root layout itself. `global-error.tsx` is the
 * outermost net — it replaces the entire HTML shell when it fires, which
 * is why we render our own `<html>` / `<body>` tags here.
 *
 * The component itself runs on the client (Next requires the
 * `'use client'` directive). The matching server-side capture for route
 * handlers / server actions / middleware lives in
 * `instrumentation.ts::onRequestError`.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: '4rem 1rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#111',
          background: '#fafafa',
        }}
      >
        <main style={{ maxWidth: '38rem', margin: '0 auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            We&apos;ve been notified and are looking into it.
            {error.digest ? (
              <>
                {' '}
                Reference: <code>{error.digest}</code>
              </>
            ) : null}
          </p>
          {/* Plain anchor (not next/link) by design: global-error replaces
              the entire HTML shell when the root layout itself errors, so
              the Next router context isn't guaranteed. A hard navigation is
              the safer fallback. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              background: '#A51C30',
              color: '#fff',
              borderRadius: '0.375rem',
              textDecoration: 'none',
            }}
          >
            Return home
          </a>
        </main>
      </body>
    </html>
  );
}

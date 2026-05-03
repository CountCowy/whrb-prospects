import * as Sentry from '@sentry/nextjs';

/**
 * Browser-runtime Sentry init (Sentry SDK v10 pattern).
 *
 * `instrumentation-client.ts` replaces the legacy `sentry.client.config.ts`
 * file in Sentry SDK v9+. Next.js auto-discovers it at the project root
 * and runs it once before any client code executes.
 *
 * Gated on `NEXT_PUBLIC_SENTRY_DSN` — distinct from the server `SENTRY_DSN`
 * because Next inlines `NEXT_PUBLIC_*` vars into the browser bundle. Both
 * DSNs typically point at the same Sentry project; we keep them as
 * separate env vars so an operator can flip the kill switch independently
 * for server vs. client.
 *
 * No `beforeSend` hook here — the browser doesn't see request headers /
 * cookies the same way the server does. Default integrations (window
 * error, unhandled rejection, fetch instrumentation) handle the common
 * cases. Replay is intentionally off; we'll enable it in a follow-up
 * once we've watched real traffic for a week.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    'development',
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.05,

  // Replay deferred — see module-level note above.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  sendDefaultPii: false,
});

/**
 * Capture client-side router transitions for tracing. Required export —
 * Next.js looks it up by name when `instrumentation-client.ts` is present.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
